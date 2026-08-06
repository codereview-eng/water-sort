/* S8 活动奖励梯度（issue #1 场景清单 · C 每周活动）
   验收：top10 排名制 vs 达标阈值制（milestone）——发奖策略由 config 声明，
   同一结算入口。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../../core/event.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S8: top10 排名制——按名次取档、超出梯度为 0', () => {
  const t = E.create(FIX.top10);
  assert.equal(t.settleRewards({ rank: 1 }), 100);
  assert.equal(t.settleRewards({ rank: 3 }), 25);
  assert.equal(t.settleRewards({ rank: 4 }), 0);
});

test('S8: 达标阈值制——人人可拿、取最高达标档', () => {
  const m = E.create(FIX.milestone);
  assert.equal(m.settleRewards({ points: 9 }), 0);
  assert.equal(m.settleRewards({ points: 10 }), 5);
  assert.equal(m.settleRewards({ points: 99 }), 30);
});

test('S8: mock 游戏 C 达标制纯 config 生效（同一 settleRewards 入口）', () => {
  const c = E.create(FIX.mockc);
  assert.equal(c.settleRewards({ points: 5 }), 10);
  assert.equal(c.settleRewards({ points: 4 }), 0);
});

test('S8: 真实游戏 config 两种梯度落地（water=top10 / sudoku=milestone）', () => {
  assert.equal(gameCfg('water').weeklyEvent.rewards.kind, 'top10');
  assert.equal(gameCfg('sudoku').weeklyEvent.rewards.kind, 'milestone');
  assert.equal(E.create(gameCfg('water').weeklyEvent).settleRewards({ rank: 2 }), 50);
  assert.equal(E.create(gameCfg('sudoku').weeklyEvent).settleRewards({ points: 50 }), 30);
});
