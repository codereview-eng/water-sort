/* S27 背景随进度演进（issue #1 场景清单 · K 皮肤系统）
   验收：A 每 10 关换一档；B 按章节切换；C 固定不变——演进曲线全 config，
   背景切换是纯函数查档，不触发玩法重载/状态丢失。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../core/cosmetics.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S27: A 分档演进——10/20 两个断点三档背景', () => {
  const c = C.create(FIX.water);
  assert.equal(c.themeByProgress(9), 'default');
  assert.equal(c.themeByProgress(10), 'sea');
  assert.equal(c.themeByProgress(19), 'sea');
  assert.equal(c.themeByProgress(20), 'deep');
});

test('S27: B 章节切换——只是另一张断点表', () => {
  const c = C.create(FIX.sudoku);
  assert.equal(c.themeByProgress(50), 'default');
  assert.equal(c.themeByProgress(51), 'chapter2');
});

test('S27: mock 游戏 C 固定不变——空断点表即恒为默认', () => {
  const c = C.create(FIX.mockc);
  assert.equal(c.themeByProgress(0), 'default');
  assert.equal(c.themeByProgress(999), 'default');
});

test('S27: 纯函数查档——同输入同输出，无隐藏状态（不触发重载）', () => {
  const c = C.create(FIX.water);
  const a = c.themeByProgress(15);
  c.themeByProgress(25); c.themeByProgress(0);
  assert.equal(c.themeByProgress(15), a, '查档顺序不影响结果');
});

test('S27: 真实游戏 config 演进曲线落地且形态各异', () => {
  const w = gameCfg('water').cosmetics;
  const s = gameCfg('sudoku').cosmetics;
  const m = gameCfg('mockc').cosmetics;
  assert.ok(w.progressBackgrounds.length >= 2, 'water 多档演进');
  assert.ok(s.progressBackgrounds.length >= 1, 'sudoku 章节切换');
  assert.ok(!m.progressBackgrounds || m.progressBackgrounds.length === 0, 'mockc 固定');
});
