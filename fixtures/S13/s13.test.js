/* S13 语言集与缺 key 回退（issue #1 场景清单 · F 身份/地区/语言）
   验收：A 带 zh/en；B 带 8 语言——字典文件即配置，缺 key 回退策略一致
   （具体 locale → 基础语言 → 默认语言，回退可观测）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../../core/locale.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S13: 语言集纯配置——A 2 语言、B 8 语言、mock C 1 语言，同一 core', () => {
  assert.equal(L.createI18n(FIX.water).locales().length, 2);
  assert.equal(L.createI18n(FIX.sudoku).locales().length, 8);
  assert.equal(L.createI18n(FIX.mockc).locales().length, 1);
});

test('S13: 缺 key 回退策略一致——zh 缺 undo 回退 en，区域变体截断，回退记 telemetry', () => {
  const w = L.createI18n(FIX.water);
  assert.equal(w.t('zh', 'play'), '开始', '命中不回退');
  assert.equal(w.t('zh', 'undo'), 'Undo', 'zh 缺 undo → 默认语言');
  assert.equal(w.t('zh-CN', 'settings'), '设置', 'zh-CN → zh 基础语言');
  assert.deepEqual(w.misses().map((m) => m.usedFallback), ['en', 'zh']);
  const s = L.createI18n(FIX.sudoku);
  assert.equal(s.t('es', 'hint'), 'Hint', 'es 只有 override 差异 key，其余回默认');
  assert.equal(s.t('pt-BR', 'play'), 'Jogar', 'pt-BR → pt');
});

test('S13: mock 游戏 C 单语言也走同一回退链（任何 locale 都落到 en）', () => {
  const c = L.createI18n(FIX.mockc);
  assert.equal(c.t('zh', 'tap'), 'Tap!');
  assert.equal(c.t('ja-JP', 'tap'), 'Tap!');
});

test('S13: 默认语言必须全量——非默认语言私有 key 加载期拒绝', () => {
  assert.throws(
    () => L.createI18n({ default: 'en', locales: { en: { a: 'A' }, zh: { a: '甲', extra: '私有' } } }),
    /默认语言必须全量/
  );
});

test('S13: 真实游戏 config 字典落地——语言集不同、回退行为一致', () => {
  const w = L.createI18n(gameCfg('water').i18n);
  const s = L.createI18n(gameCfg('sudoku').i18n);
  assert.equal(w.locales().length, 2, 'A 带 zh/en');
  assert.equal(s.locales().length, 8, 'B 带 8 语言');
  assert.equal(typeof w.t('fr', w === null ? '' : 'play'), 'string', '缺语言不炸、回默认');
});
