/* S3 首通奖励 vs 重复通关衰减（issue #1 场景清单 · A 奖励结算）
   验收：A 首通 ×3；B 重复通关按次数衰减到下限；历史感知逻辑在 core
   （clearCount 输入），参数全在 config。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../core/settle.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S3: A 首通 ×3，重复通关回到基础值（无衰减配置）', () => {
  const a = S.create(FIX.water);
  assert.equal(a.settle({ clearCount: 0 }), 30);
  assert.equal(a.settle({ clearCount: 1 }), 10);
  assert.equal(a.settle({ clearCount: 9 }), 10);
});

test('S3: B 重复通关按次数衰减到下限', () => {
  const b = S.create(FIX.sudoku);
  assert.equal(b.settle({ clearCount: 0 }), 10, 'B 无首通放大（firstClearMult 默认 1）');
  assert.equal(b.settle({ clearCount: 1 }), 5);
  assert.equal(b.settle({ clearCount: 2 }), 2, '衰减命中下限 floor=2');
  assert.equal(b.settle({ clearCount: 10 }), 2, '继续重复不再下降');
});

test('S3: mock 游戏 C 首通放大与衰减同时生效（纯 config 组合）', () => {
  const c = S.create(FIX.mockc);
  assert.equal(c.settle({ clearCount: 0 }), 20, '首通 ×2');
  assert.equal(c.settle({ clearCount: 1 }), 5);
  assert.equal(c.settle({ clearCount: 5 }), 3, '衰减命中下限 floor=3');
});

test('S3: 真实游戏 config 同口径（water 首通×3 / sudoku 带衰减）', () => {
  assert.equal(gameCfg('water').settle.firstClearMult, 3);
  assert.deepEqual(gameCfg('sudoku').settle.decay, { rate: 0.5, floor: 2 });
  const w = S.create(gameCfg('water').settle);
  assert.equal(w.settle({ clearCount: 0 }), w.settle({ clearCount: 1 }) * 3);
});
