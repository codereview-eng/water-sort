// core/weekly.js 单测：手动领取状态机（locked→claimable→claimed）、大奖、ISO 周 key、周配置解析
const { test } = require('node:test');
const assert = require('node:assert');
const WC = require('./weekly.js');

function blank(frags) {
  return { week: 'w1', frags: frags || 0, carried: 0, claimed: [false, false, false, false, false, false], grand: false };
}

test('weekly-core: 解锁 ≠ 领取 — 达阈值只进 claimable，不自动 claimed', () => {
  const st = blank(0);
  assert.strictEqual(WC.picStatus(st, 0), 'locked');
  st.frags = 99;
  assert.strictEqual(WC.picStatus(st, 0), 'locked');
  st.frags = 100;
  assert.strictEqual(WC.picStatus(st, 0), 'claimable');   // 解锁后是可领取，不是已领取
  assert.deepStrictEqual(WC.claimable(st), [0]);
  assert.deepStrictEqual(st.claimed, [false, false, false, false, false, false]); // 状态未被自动改写
  st.frags = 310;
  assert.deepStrictEqual(WC.claimable(st), [0, 1, 2]);    // 一次跨多档全部进入可领取
  assert.strictEqual(WC.claimableCount(st), 3);
});

test('weekly-core: claim — 只有用户领取才落 claimed，且不可变/不重复', () => {
  const st = blank(200);
  const roll = () => ({ type: 'energy', n: 30 });
  const r1 = WC.claim(st, 0, roll);
  assert.deepStrictEqual(r1.reward, { type: 'energy', n: 30 });
  assert.strictEqual(r1.state.claimed[0], true);
  assert.deepStrictEqual(r1.state.r0, { type: 'energy', n: 30 }); // 展示用奖励记录
  assert.strictEqual(st.claimed[0], false);                        // 入参不被改动（不可变）
  assert.strictEqual(WC.picStatus(r1.state, 0), 'claimed');
  assert.throws(() => WC.claim(r1.state, 0, roll), /已领取/);      // 重复领取抛错
  assert.throws(() => WC.claim(st, 2, roll), /未解锁/);            // 未达阈值不可领
  assert.throws(() => WC.claim(st, 1, () => ({ type: 'coins', n: 1 })), /rollFn/); // 非法 roll 拒绝
  assert.throws(() => WC.claim(st, 6, roll), /图索引/);
});

test('weekly-core: 大奖 — 600 只进 claimable，点击领取才发放', () => {
  const st = blank(599);
  assert.strictEqual(WC.grandStatus(st), 'locked');
  assert.throws(() => WC.claimGrand(st), /未解锁/);
  st.frags = 600;
  assert.strictEqual(WC.grandStatus(st), 'claimable');
  assert.strictEqual(WC.claimableCount(st), 7);            // 6 图 + 大奖
  const g = WC.claimGrand(st);
  assert.deepStrictEqual(g.reward, { energy: 60, hints: 5 });
  assert.strictEqual(g.state.grand, true);
  assert.strictEqual(st.grand, false);                     // 不可变
  assert.strictEqual(WC.grandStatus(g.state), 'claimed');
  assert.throws(() => WC.claimGrand(g.state), /已领取/);
});

test('weekly-core: 坏状态防御', () => {
  assert.throws(() => WC.picStatus(null, 0), /state/);
  assert.throws(() => WC.picStatus({ frags: -1, claimed: [0, 0, 0, 0, 0, 0] }, 0), /frags/);
  assert.throws(() => WC.claimable({ frags: 10, claimed: [false] }), /claimed/);
});

test('weekly-core: ISO 周 key（UTC）', () => {
  assert.strictEqual(WC.isoWeekKey(Date.UTC(2026, 7, 17)), '2026-W34');      // 2026-08-17 周一
  assert.strictEqual(WC.isoWeekKey(Date.UTC(2026, 7, 23, 23, 59)), '2026-W34'); // 同周周日深夜
  assert.strictEqual(WC.isoWeekKey(Date.UTC(2026, 7, 24)), '2026-W35');      // 下周一
  assert.strictEqual(WC.isoWeekKey(Date.UTC(2026, 0, 1)), '2026-W01');       // 2026-01-01 周四
  assert.strictEqual(WC.isoWeekKey(Date.UTC(2027, 0, 1)), '2026-W53');       // 2027-01-01 周五 → 上一 ISO 年第 53 周
  assert.throws(() => WC.isoWeekKey('x'), /now/);
});

test('weekly-core: resolveWeek — 命中当周条目，未命中回 null（宿主回退轮换）', () => {
  const cfg = {
    _note: 'x',
    '2026-W34': { theme: 'starry', title: '星空周', titleEn: 'Starry Week', banner: 'assets/weekly/banners/2026-W34.webp' },
  };
  const now = Date.UTC(2026, 7, 19);
  assert.deepStrictEqual(WC.resolveWeek(cfg, now).theme, 'starry');
  assert.strictEqual(WC.resolveWeek(cfg, now + 7 * 86400000), null); // 下周无配置
  assert.strictEqual(WC.resolveWeek(null, now), null);
  assert.strictEqual(WC.resolveWeek({ '2026-W34': ['bad'] }, now), null);
});
