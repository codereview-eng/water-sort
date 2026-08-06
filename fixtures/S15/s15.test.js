/* S15 首页/结算页模块开关声明式（issue #1 场景清单 · G UI 骨架）
   验收：A 有周活动入口+排行+档案；B 只有关卡选择——页面展示元素由
   config 列表声明，shell 不认识具体游戏。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Shell = require('../../core/shell.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

// 同一份注册表承载三款游戏——shell 对「谁在用」零认知
const registry = () => new Map([
  ['weekly-event-entry', () => 'event'],
  ['leaderboard-entry', (p) => 'lb:' + p.boardId],
  ['archive-panel', () => 'archive'],
  ['level-select', () => 'levels'],
  ['settle-summary', () => 'settle'],
  ['ad-double-button', () => 'ad2x'],
  ['tap-button', (p) => 'tap:' + (p.label || '')]
]);

test('S15: A 首页 = 周活动入口 + 排行 + 档案（开关与顺序全由数组声明）', () => {
  const sh = Shell.create(registry(), FIX.water);
  assert.deepEqual(sh.render('home'), ['event', 'lb:fastest', 'archive']);
  assert.deepEqual(sh.render('result'), ['settle', 'ad2x']);
});

test('S15: B 首页只有关卡选择——同一 shell，模块组合纯配置', () => {
  const sh = Shell.create(registry(), FIX.sudoku);
  assert.deepEqual(sh.render('home'), ['levels']);
  assert.deepEqual(sh.render('result'), ['settle']);
});

test('S15: mock 游戏 C 只声明自己的模块；未声明 screen 即不存在', () => {
  const sh = Shell.create(registry(), FIX.mockc);
  assert.deepEqual(sh.render('home'), ['tap:GO']);
  assert.throws(() => sh.render('result'), /未声明 screen/);
});

test('S15: 引用未注册模块 type → 加载期拒绝（无静默跳过）', () => {
  assert.throws(
    () => Shell.create(registry(), { home: { modules: [{ type: 'iap-shop' }] } }),
    /未注册模块 type/
  );
});

test('S15: 真实游戏 config screens 落地且组合互不相同', () => {
  const w = Shell.create(registry(), gameCfg('water').screens);
  const s = Shell.create(registry(), gameCfg('sudoku').screens);
  const c = Shell.create(registry(), gameCfg('mockc').screens);
  assert.deepEqual(w.modules('home'), ['weekly-event-entry', 'leaderboard-entry', 'archive-panel']);
  assert.deepEqual(s.modules('home'), ['level-select']);
  assert.deepEqual(c.modules('home'), ['tap-button']);
});
