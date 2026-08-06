/* S21 连胜奖励触发差异（issue #1 场景清单 · J 连胜系统）
   验收：A 连胜 10 盘看激励视频领奖；B 连胜 5 盘直接发放；C 整体关闭——
   阈值、领取方式（ad/direct/off）全 config；streak core 不认识「广告」，
   只在描述符上标 claim 方式，广告链路由调用方走 ads core。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../../core/streak.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

const winN = (s, n) => {
  let st = s.init();
  let rewards = [];
  for (let i = 0; i < n; i++) {
    const r = s.win(st);
    st = r.state;
    rewards = rewards.concat(r.rewards);
  }
  return { st, rewards };
};

test('S21: A 连胜 10 盘 → 里程碑标 claim=ad（看激励视频领奖）', () => {
  const s = K.create(FIX.water);
  const { rewards } = winN(s, 10);
  assert.deepEqual(rewards, [{ streak: 10, reward: { type: 'coins', amount: 100 }, claim: 'ad' }]);
  assert.deepEqual(winN(s, 9).rewards, [], '不到阈值零发放');
});

test('S21: B 连胜 5 盘 → claim=direct 直接发放，同一 core 纯配置差异', () => {
  const s = K.create(FIX.sudoku);
  const { rewards } = winN(s, 5);
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].claim, 'direct');
});

test('S21: mock 游戏 C 整体关闭 → 入口不渲染、API 调用即拒', () => {
  const s = K.create(FIX.mockc);
  assert.equal(s.visible(), false);
  assert.throws(() => s.win({}), /未开启/);
});

test('S21: 真实游戏 config 三种触发形态落地且可加载', () => {
  assert.equal(gameCfg('water').streak.claimMode, 'ad');
  assert.equal(gameCfg('sudoku').streak.claimMode, 'direct');
  for (const id of ['water', 'sudoku', 'mockc']) K.create(gameCfg(id).streak);
});
