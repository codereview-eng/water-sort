/* S14 geo 合规开关（issue #1 场景清单 · F 身份/地区/语言）
   验收：不同游戏不同国家白名单——国家决策链一份代码不动，名单在配置。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../../core/locale.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S14: 三款游戏三种名单——all / allowlist / denylist 纯配置', () => {
  const w = L.createGeoAllow(FIX.water);
  const s = L.createGeoAllow(FIX.sudoku);
  const c = L.createGeoAllow(FIX.mockc);
  assert.equal(w('KP'), true, 'A 全放行');
  assert.equal(s('CN'), true);
  assert.equal(s('BR'), false, 'B 白名单外拒绝');
  assert.equal(c('KP'), false, 'C 黑名单命中拒绝');
  assert.equal(c('BR'), true);
});

test('S14: 决策链代码一份——同一输入喂不同游戏名单，结论只由 config 决定', () => {
  const country = L.resolveCountry({ tgLanguageCode: 'pt-BR' });
  assert.equal(country, 'BR');
  assert.equal(L.createGeoAllow(FIX.water)(country), true);
  assert.equal(L.createGeoAllow(FIX.sudoku)(country), false);
  assert.equal(L.createGeoAllow(FIX.mockc)(country), true);
});

test('S14: 未知国（ZZ）在白名单制下默认拒绝、黑名单制下默认放行', () => {
  const zz = L.resolveCountry({});
  assert.equal(zz, 'ZZ');
  assert.equal(L.createGeoAllow(FIX.sudoku)(zz), false, '白名单 = 合规保守');
  assert.equal(L.createGeoAllow(FIX.mockc)(zz), true);
});

test('S14: 真实游戏 config 名单落地且互不相同', () => {
  assert.equal(gameCfg('water').geoAccess.mode, 'all');
  assert.equal(gameCfg('sudoku').geoAccess.mode, 'allowlist');
  assert.equal(gameCfg('mockc').geoAccess.mode, 'denylist');
  for (const id of ['water', 'sudoku', 'mockc']) L.createGeoAllow(gameCfg(id).geoAccess);
});
