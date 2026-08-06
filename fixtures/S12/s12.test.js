/* S12 终身档案统计项声明式（issue #1 场景清单 · E 排行与档案）
   验收：每款游戏声明自己的统计字段集合（A 记「倒了多少瓶」，B 记
   「填了多少格」），archive core 不硬编码任何字段。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../core/stats.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S12: 三款游戏三套统计字段集，同一 archive core 承载', () => {
  assert.deepEqual(S.createArchive(FIX.water).keys(), ['bottles_poured', 'total_clears', 'best_time_ms']);
  assert.deepEqual(S.createArchive(FIX.sudoku).keys(), ['cells_filled', 'total_stars']);
  assert.deepEqual(S.createArchive(FIX.mockc).keys(), ['clicks', 'best_combo']);
});

test('S12: A「倒了多少瓶」——事件流按声明聚合，core 对字段语义零认知', () => {
  const ar = S.createArchive(FIX.water);
  ar.onEvent('pour'); ar.onEvent('pour');
  ar.onEvent('level_cleared', { timeMs: 90000 });
  ar.onEvent('level_cleared', { timeMs: 120000 });
  assert.deepEqual(ar.all(), { bottles_poured: 2, total_clears: 2, best_time_ms: 90000 });
});

test('S12: mock 游戏 C 声明 2 个统计项即完成验收（count + max）', () => {
  const ar = S.createArchive(FIX.mockc);
  ar.onEvent('click', { combo: 3 }); ar.onEvent('click', { combo: 9 }); ar.onEvent('click', { combo: 1 });
  assert.equal(ar.get('clicks'), 3);
  assert.equal(ar.get('best_combo'), 9);
  assert.throws(() => ar.get('bottles_poured'), /未声明 statKey/, '别家字段不存在');
});

test('S12: 真实游戏 config 统计字段集落地且互不相同', () => {
  const w = S.createArchive(gameCfg('water').lifetimeStats).keys();
  const s = S.createArchive(gameCfg('sudoku').lifetimeStats).keys();
  const c = S.createArchive(gameCfg('mockc').lifetimeStats).keys();
  assert.ok(w.includes('bottles_poured'), 'A 记倒瓶');
  assert.ok(s.includes('cells_filled'), 'B 记填格');
  const gameplayKeys = (keys) => keys.filter((k) => !k.endsWith('_streak'));
  assert.ok(gameplayKeys(c).every((k) => !w.includes(k)), 'mock C 玩法字段集独立（连胜维度是跨游戏共享口径，S23）');
});
