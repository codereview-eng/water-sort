// weekly.js 单测(issue #30):周界、依次解锁、奖励边界、结转、幂等
const { test } = require('node:test');
const assert = require('node:assert');
const W = require('./weekly.js');

test('weekly: 周界 — UTC 周一 00:00 为界', () => {
  // 2026-07-27 是周一。周一 00:00 UTC 与周日 23:59:59 UTC 分属两周
  const mon = Date.UTC(2026, 6, 27, 0, 0, 0);
  const sunLate = Date.UTC(2026, 6, 26, 23, 59, 59);
  assert.notStrictEqual(W.weekKey(mon), W.weekKey(sunLate));
  // 同一周内任意两天同 key
  assert.strictEqual(W.weekKey(mon), W.weekKey(Date.UTC(2026, 7, 2, 23, 59, 59))); // 周日深夜
  // weekEnd 恰为下周一 00:00,且大于 now
  const end = W.weekEnd(mon);
  assert.strictEqual(end, Date.UTC(2026, 7, 3, 0, 0, 0));
  assert.ok(end > mon);
  assert.strictEqual(W.weekIndex(end), W.weekIndex(mon) + 1);
});

test('weekly: 主题按周确定性轮换', () => {
  const now = Date.UTC(2026, 6, 27);
  assert.strictEqual(W.themeFor(now), W.themeFor(now + 3 * W.DAY)); // 同周同主题
  const nextTheme = W.themeFor(now + W.WEEK);
  assert.notStrictEqual(W.themeFor(now), nextTheme);                 // 相邻周不同主题
  assert.strictEqual(W.themeFor(now), W.THEMES[W.weekIndex(now) % W.THEMES.length]);
  for (const th of W.THEMES) {
    assert.strictEqual(th.zh.pics.length, 6);
    assert.strictEqual(th.en.pics.length, 6);
  }
});

test('weekly: 100..600 依次解锁', () => {
  assert.strictEqual(W.unlockedCount(0), 0);
  assert.strictEqual(W.unlockedCount(99), 0);
  assert.strictEqual(W.unlockedCount(100), 1);
  assert.strictEqual(W.unlockedCount(599), 5);
  assert.strictEqual(W.unlockedCount(600), 6);
  assert.strictEqual(W.unlockedCount(1000), 6);
  assert.deepStrictEqual(W.newlyUnlocked(90, 100), [0]);
  assert.deepStrictEqual(W.newlyUnlocked(95, 310), [0, 1, 2]);   // 一次跨多档全部补发
  assert.deepStrictEqual(W.newlyUnlocked(100, 199), []);          // 未到下一档不重复
  assert.deepStrictEqual(W.newlyUnlocked(590, 600), [5]);
});

test('weekly: 奖励 roll 边界与类型', () => {
  // randType<0.5 → 体力 10..60
  assert.deepStrictEqual(W.rollReward(0, 0), { type: 'energy', n: 10 });
  assert.deepStrictEqual(W.rollReward(0.49, 0.999), { type: 'energy', n: 60 });
  // randType>=0.5 → 提示 1..3
  assert.deepStrictEqual(W.rollReward(0.5, 0), { type: 'hints', n: 1 });
  assert.deepStrictEqual(W.rollReward(0.99, 0.999), { type: 'hints', n: 3 });
  // 均匀抽样落界内
  for (let i = 0; i < 1000; i++) {
    const r = W.rollReward(Math.random(), Math.random());
    if (r.type === 'energy') assert.ok(r.n >= 10 && r.n <= 60);
    else assert.ok(r.n >= 1 && r.n <= 3);
  }
  // 非法输入安全回退
  assert.deepStrictEqual(W.rollReward(NaN, 2), { type: 'energy', n: 10 });
});

test('weekly: 结转与周对账', () => {
  assert.strictEqual(W.carry(600), 0);
  assert.strictEqual(W.carry(599), 0);
  assert.strictEqual(W.carry(620), 20);
  const wk1 = 'w100', wk2 = 'w101';
  // 同周:原样返回(幂等)
  const st = W.blank(wk1); st.frags = 260;
  assert.strictEqual(W.normalize(st, wk1), st);
  // 跨周:重置 + 超额结转一次
  st.frags = 620; st.claimed = [true, true, true, true, true, true]; st.grand = true;
  const n2 = W.normalize(st, wk2);
  assert.strictEqual(n2.week, wk2);
  assert.strictEqual(n2.frags, 20);
  assert.strictEqual(n2.carried, 20);
  assert.deepStrictEqual(n2.claimed, [false, false, false, false, false, false]);
  assert.strictEqual(n2.grand, false);
  // 跨周但未超额:归零、无结转
  const n3 = W.normalize({ week: wk1, frags: 480 }, wk2);
  assert.strictEqual(n3.frags, 0);
  assert.strictEqual(n3.carried, 0);
  // 空/坏状态 → 空白周
  assert.deepStrictEqual(W.normalize(null, wk1), W.blank(wk1));
  assert.deepStrictEqual(W.normalize({ week: wk1, frags: 5, claimed: [true] }, wk1), W.blank(wk1)); // claimed 结构坏 → 重置
});

test('weekly: 领取幂等 — claimed 标记后不重复发', () => {
  // 模拟控制器逻辑:发放序列由 newlyUnlocked + claimed 共同保证幂等
  const st = W.blank('w1');
  const grant = [];
  const add = (n) => {
    const before = st.frags;
    st.frags += n;
    for (const i of W.newlyUnlocked(before, st.frags)) {
      if (st.claimed[i]) continue;
      st.claimed[i] = true;
      grant.push(i);
    }
    if (st.frags >= W.GOAL && !st.grand) { st.grand = true; grant.push('grand'); }
  };
  add(100);            // 解锁 ①
  add(0); add(0);      // 幂等:不重发
  assert.deepStrictEqual(grant, [0]);
  add(500);            // 一次到 600:②-⑥ + 大奖
  assert.deepStrictEqual(grant, [0, 1, 2, 3, 4, 5, 'grand']);
  add(100);            // 超额只涨碎片,不再发
  assert.deepStrictEqual(grant, [0, 1, 2, 3, 4, 5, 'grand']);
  assert.strictEqual(W.carry(st.frags), 100);
});
