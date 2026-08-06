/* S22 连胜计数规则差异（issue #1 场景清单 · J 连胜系统）
   验收：A 失败即清零；B 每日首败豁免；C 广告续命（streak freeze）——
   core 只提供 win/lose/freeze 三个事件入口，策略全配置；宽恕消耗顺序
   core 定死（先首败豁免、再广告续命，不做成配置防组合爆炸）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../../core/streak.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const DAY = 86400000;

const winN = (s, n) => {
  let st = s.init();
  for (let i = 0; i < n; i++) st = s.win(st).state;
  return st;
};

test('S22: A 失败即清零', () => {
  const s = K.create(FIX.water);
  const l = s.lose(winN(s, 4), 0);
  assert.equal(l.outcome, 'reset');
  assert.equal(l.state.current, 0);
});

test('S22: B 每日首败豁免——同日第二败清零，次日额度恢复', () => {
  const s = K.create(FIX.sudoku);
  const l1 = s.lose(winN(s, 4), 1000);
  assert.equal(l1.outcome, 'forgiven');
  assert.equal(l1.state.current, 4, '豁免保连胜');
  const l2 = s.lose(l1.state, 2000);
  assert.equal(l2.outcome, 'reset', '同日第二败清零');
  const l3 = s.lose({ ...l1.state, current: 7 }, DAY + 1);
  assert.equal(l3.outcome, 'forgiven', '次日豁免额度恢复');
});

test('S22: mock 游戏 C 广告续命——freeze 保连胜、每段连胜限 1 次', () => {
  const s = K.create(FIX.mockc);
  const l1 = s.lose(winN(s, 3), 0);
  assert.equal(l1.outcome, 'revivable', '进入待续命态（广告播放走 ads core，本 core 不认识广告）');
  const revived = s.freeze(l1.state);
  assert.equal(revived.current, 3, '续命保连胜');
  const l2 = s.lose(revived, 0);
  assert.equal(l2.outcome, 'reset', '本段连胜续命次数用尽');
  const fresh = s.win(l2.state).state;
  assert.equal(s.lose(fresh, 0).outcome, 'revivable', '清零后新连胜续命额度恢复');
});

test('S22: 宽恕顺序 core 定死——首败豁免优先于广告续命', () => {
  const s = K.create({
    enabled: true, claimMode: 'direct',
    policy: { dailyFirstLossForgiven: true, adRevive: { enabled: true, maxPerStreak: 9 } },
    tiers: []
  });
  assert.equal(s.lose(winN(s, 2), 0).outcome, 'forgiven', '同日首败先走豁免，不消耗续命');
});
