/* S4 三款游戏三套道具集（issue #1 场景清单 · B 道具框架）
   验收：A undo/addBottle；B hint/eraser；C（假想）shuffle/bomb；core 只提供
   注册/消费/库存框架，道具 id 与 handler 由 game 注册（🟡 handler 本身是
   玩法效果，计入 game 层代码）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../core/powerups.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S4: 三份 fixture 三套道具集，同一 core 框架承载', () => {
  assert.deepEqual(P.create(FIX.water).ids(), ['undo', 'addBottle']);
  assert.deepEqual(P.create(FIX.sudoku).ids(), ['hint', 'eraser']);
  assert.deepEqual(P.create(FIX.mockc).ids(), ['shuffle', 'bomb']);
});

test('S4: mock 游戏 C 假想道具全流程——注册 handler、入账、消费事务', () => {
  const pu = P.create(FIX.mockc);
  const used = [];
  pu.register('shuffle', (ctx) => { used.push(['shuffle', ctx]); return true; });
  pu.register('bomb', () => true);
  pu.grant('shuffle', 2, 'purchase');
  assert.deepEqual(pu.consume('shuffle', { level: 7 }), { ok: true });
  assert.deepEqual(used, [['shuffle', { level: 7 }]], '效果执行发生在 game 注册的 handler 里');
  assert.equal(pu.count('shuffle'), 1);
  assert.deepEqual(pu.consume('bomb'), { ok: false, reason: 'empty' }, '零库存不可消费');
});

test('S4: core 对道具 id 零认知——未声明 id 一律 fail-fast', () => {
  const pu = P.create(FIX.water);
  assert.throws(() => pu.consume('shuffle'), /未声明/);
  assert.throws(() => pu.grant('hint', 1, 'manual'), /未声明/);
});

test('S4: 真实游戏 config 三套道具集落地且可加载', () => {
  assert.deepEqual(P.create(gameCfg('water').powerups).ids(), ['undo', 'addBottle']);
  assert.deepEqual(P.create(gameCfg('sudoku').powerups).ids(), ['hint', 'eraser']);
  assert.deepEqual(P.create(gameCfg('mockc').powerups).ids(), ['shuffle', 'bomb']);
});
