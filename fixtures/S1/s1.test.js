/* S1 三款游戏三种通关奖励模型（issue #1 场景清单 · A 奖励结算）
   验收：同一 reward 结算函数，config 决定模型，输出各自正确金额；
   mock 游戏 C（必须）+ water/sudoku 真实配置轮换断言。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../core/settle.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S1: 同一 settle 函数，三份 fixture 三种模型，金额各自正确', () => {
  const water = S.create(FIX.water);
  const sudoku = S.create(FIX.sudoku);
  const mockc = S.create(FIX.mockc);
  const ev = { diff: 4, streak: 3, clearCount: 1 };
  assert.equal(water.settle(ev), 10, 'A 固定值：与难度/连胜无关');
  assert.equal(sudoku.settle(ev), 30, 'B 难度曲线：10×(1+0.5×4)');
  assert.equal(mockc.settle(ev), 40, 'C 连胜递增：10×(1+1×3)');
  assert.equal(mockc.settle({ streak: 99, clearCount: 1 }), 60, 'C cap 截断');
});

test('S1: 真实游戏 config 落地同三种模型（water=fixed / sudoku=difficulty / mockc=streakRamp）', () => {
  assert.equal(gameCfg('water').settle.mode, 'fixed');
  assert.equal(gameCfg('sudoku').settle.mode, 'difficulty');
  assert.equal(gameCfg('mockc').settle.mode, 'streakRamp');
  for (const id of ['water', 'sudoku', 'mockc']) S.create(gameCfg(id).settle); // 全部可加载（fail-fast 不触发）
});
