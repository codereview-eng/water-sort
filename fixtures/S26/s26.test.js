/* S26 皮肤作用域差异（issue #1 场景清单 · K 皮肤系统）
   验收：A 全局主题；B 按关卡类型分套；C 成套主题（背景+贴图+音效）——
   渲染层按 theme token 换肤，玩法代码 diff = 0；皮肤只是资源清单+映射表。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../core/cosmetics.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));
const strip = (c) => ({ catalog: c.catalog, themes: c.themes });

test('S26: A 全局主题——一次 resolve，全部语义 token 换值', () => {
  const c = C.create(strip(FIX.water));
  const t = c.resolveTokens('night');
  assert.deepEqual(t, { bg: '#101020', piece: 'bottle-dark.png', sfx: 'pour-soft.mp3' });
});

test('S26: B 按关卡类型分套——levelType→themeId 只是映射表', () => {
  const c = C.create(strip(FIX.sudoku));
  const themeFor = (lt) => c.resolveTokens(FIX.sudoku.levelThemes[lt]);
  assert.equal(themeFor('normal').bg, '#f5ecd7');
  assert.equal(themeFor('normal').piece, 'digit.png', '未覆盖 token 级联回默认');
  assert.equal(themeFor('hard').piece, 'digit-red.png');
});

test('S26: mock 游戏 C 成套主题——背景+贴图+音效一把换，零 C 侧代码', () => {
  const c = C.create(strip(FIX.mockc));
  const t = c.resolveTokens('neon');
  assert.deepEqual(t, { bg: '#0ff', piece: 'dot-neon.png', sfx: 'zap.mp3' }, '成套 token 全量生效');
});

test('S26: 皮肤覆盖片段优先于主题——三层级联', () => {
  const c = C.create(strip(FIX.water));
  const t = c.resolveTokens('night', { piece: 'bottle-gold.png' });
  assert.equal(t.piece, 'bottle-gold.png');
  assert.equal(t.bg, '#101020', '其余 token 仍来自主题');
});

test('S26: 真实游戏 config themes 落地——default 全量、语义 token 一致', () => {
  for (const id of ['water', 'sudoku', 'mockc']) {
    const cfg = gameCfg(id).cosmetics;
    const c = C.create(cfg, { streakEnabled: gameCfg(id).streak.enabled });
    const t = c.resolveTokens('default');
    assert.deepEqual(Object.keys(t).sort(), ['bg', 'piece', 'sfx'], id + ' 语义 token 集一致');
  }
});
