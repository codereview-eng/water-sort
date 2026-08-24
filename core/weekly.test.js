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
  // 配置未声明的奖励类型一律不发（默认池只有 energy/hints，coins 不在其中）
  assert.throws(() => WC.claim(st, 1, () => ({ type: 'coins', n: 1 })), /不在 rewardPool 里/);
  assert.throws(() => WC.claim(st, 1, () => ({ type: 'energy', n: 0 })), /正整数/);
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

/* ---- 配置驱动（2026-08-21）：所有游戏共用同一套机制，奖励内容各自配 ----
   目的：彩雷想发「金币 + 自己的道具」，倒水想发「体力 + 提示」，
   两边跑同一份 core，只是 config 不同。 */
const WCore = require('./weekly.js');

test('weekly-core: 整段不配 = 沿用既有数值（向后兼容，老游戏行为不变）', () => {
  const w = WCore.create(null);
  assert.deepStrictEqual(w.thresholds, [100, 200, 300, 400, 500, 600]);
  assert.strictEqual(w.goal, 600);
  assert.deepStrictEqual(w.grand, { energy: 60, hints: 5 });
  assert.strictEqual(w.frags.win, 10);
  assert.strictEqual(w.count, 6);
  // 顶层函数（老调用路径）仍可用，且与默认实例一致
  assert.strictEqual(WCore.GOAL, 600);
  assert.strictEqual(WCore.THRESHOLDS.length, 6);
});

test('weekly-core: 每个游戏可配自己的奖励内容与阈值', () => {
  const mine = WCore.create({
    thresholds: [50, 150, 300],                       // 张数由数组长度决定，不再写死 6
    grand: { coins: 500, toolMine: 3 },               // 彩雷发金币和自己的道具
    frags: { win: 20, ad: 15 },
    rewardPool: [
      { type: 'coins', min: 50, max: 200, weight: 3 },
      { type: 'toolMine', min: 1, max: 2, weight: 1 }
    ]
  });
  assert.strictEqual(mine.count, 3);
  assert.strictEqual(mine.goal, 300, 'goal 缺省 = 最后一个 threshold');
  assert.deepStrictEqual(mine.grand, { coins: 500, toolMine: 3 });
  assert.strictEqual(mine.frags.win, 20);
  // 领取用的是自己配的奖励类型
  const st = mine.blank(1); st.frags = 60;
  const r = mine.claim(st, 0, () => ({ type: 'coins', n: 100 }));
  assert.deepStrictEqual(r.reward, { type: 'coins', n: 100 });
  // 别的游戏的奖励类型在这里不认（防止配置漂移）
  assert.throws(() => mine.claim(st, 0, () => ({ type: 'hints', n: 1 })), /不在 rewardPool 里/);
  // 大奖发的是配置里的内容
  const big = mine.blank(1); big.frags = 300;
  assert.deepStrictEqual(mine.claimGrand(big).reward, { coins: 500, toolMine: 3 });
});

test('weekly-core: 三张图配置下的状态机与解锁进度', () => {
  const w = WCore.create({ thresholds: [10, 20, 30], grand: { coins: 99 }, rewardPool: [{ type: 'coins', min: 1, max: 1 }] });
  const st = w.blank(1); st.frags = 20;
  assert.strictEqual(w.picStatus(st, 0), 'claimable');
  assert.strictEqual(w.picStatus(st, 2), 'locked');
  assert.deepStrictEqual(w.claimable(st), [0, 1]);
  assert.strictEqual(w.unlockedCount(20), 2);
  assert.deepStrictEqual(w.newlyUnlocked(9, 25), [0, 1]);
  assert.strictEqual(w.grandStatus(st), 'locked');
  st.frags = 30;
  assert.strictEqual(w.grandStatus(st), 'claimable');
  assert.strictEqual(w.claimableCount(st), 4, '3 张图 + 大奖');
  assert.throws(() => w.picStatus(st, 3), /0\.\.2/, '索引范围随配置收窄');
});

test('weekly-core: rollReward 按权重选池，随机数由宿主注入（可确定化）', () => {
  const w = WCore.create({ rewardPool: [
    { type: 'coins', min: 10, max: 10, weight: 3 },
    { type: 'gem', min: 5, max: 5, weight: 1 }
  ] });
  assert.strictEqual(w.rollReward(0, 0).type, 'coins', '权重 3/4 落在 coins');
  assert.strictEqual(w.rollReward(0.9, 0).type, 'gem', '尾部 1/4 落在 gem');
  assert.strictEqual(w.rollReward(0, 0.99).n, 10, 'min==max 时数量固定');
  const span = WCore.create({ rewardPool: [{ type: 'x', min: 10, max: 60 }] });
  assert.strictEqual(span.rollReward(0, 0).n, 10, '取值下界');
  assert.strictEqual(span.rollReward(0, 0.999).n, 60, '取值上界');
});

test('weekly-core: 配置 fail-fast（宁可加载期炸，不要线上发错奖）', () => {
  assert.throws(() => WCore.create([]), /必须是对象/);
  assert.throws(() => WCore.create({ thresholds: [] }), /非空数组/);
  assert.throws(() => WCore.create({ thresholds: [10, 10] }), /严格升序/);
  assert.throws(() => WCore.create({ thresholds: [0] }), /正整数/);
  assert.throws(() => WCore.create({ goal: 5, thresholds: [10] }), /不能小于最后一个 threshold/);
  assert.throws(() => WCore.create({ grand: {} }), /至少要有一项奖励/);
  assert.throws(() => WCore.create({ grand: { coins: -1 } }), /必须是正整数/);
  assert.throws(() => WCore.create({ rewardPool: [] }), /非空数组/);
  assert.throws(() => WCore.create({ rewardPool: [{ type: '', min: 1, max: 1 }] }), /type 必须是非空字符串/);
  assert.throws(() => WCore.create({ rewardPool: [{ type: 'a', min: 5, max: 1 }] }), /max 必须是/);
  assert.throws(() => WCore.create({ frags: { win: 0 } }), /frags\.win/);
});

test('weekly-core: 周界不可配 —— 所有游戏必须同一个「本周」', () => {
  const a = WCore.create({ thresholds: [1] });
  const b = WCore.create({ thresholds: [999] });
  const now = Date.UTC(2026, 7, 21, 12, 0, 0);
  assert.strictEqual(a.weekIndex(now), b.weekIndex(now), '两个游戏的周序号必须一致');
  assert.strictEqual(a.weekKey(now), b.weekKey(now));
  assert.strictEqual(a.weekEnd(now), b.weekEnd(now));
  // 周一 00:00 UTC 为界
  const mon = Date.UTC(2026, 7, 17, 0, 0, 0);
  assert.strictEqual(a.weekIndex(mon - 1) + 1, a.weekIndex(mon), '周一零点跨周');
});

test('weekly-core: 换周结转 —— 超出大奖阈值的碎片带到下周', () => {
  const w = WCore.create({ thresholds: [10, 20], goal: 20, grand: { coins: 1 }, rewardPool: [{ type: 'coins', min: 1, max: 1 }] });
  const old = { week: 5, frags: 35, carried: 0, claimed: [true, true], grand: true };
  const next = w.normalize(old, 6);
  assert.strictEqual(next.week, 6);
  assert.strictEqual(next.carried, 15, '35-20=15 结转');
  assert.strictEqual(next.frags, 15);
  assert.deepStrictEqual(next.claimed, [false, false], '新一周重新开始');
  assert.strictEqual(next.grand, false);
  // 同一周内不重置
  assert.strictEqual(w.normalize(next, 6), next);
  // 改了配置张数后，老存档安全重置而不是崩
  const w3 = WCore.create({ thresholds: [10, 20, 30], grand: { coins: 1 }, rewardPool: [{ type: 'coins', min: 1, max: 1 }] });
  assert.strictEqual(w3.normalize(old, 5).claimed.length, 3);
});
