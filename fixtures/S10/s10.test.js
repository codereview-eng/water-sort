/* S10 geo × 广告联动开关（issue #1 场景清单 · D 广告频控）
   验收：某国家关闭激励视频只留插屏；另一国家全关——geo 决策链输出（country）
   喂给声明式开关矩阵，均为配置。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../../core/ads.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S10: 一国关激励留插屏、一国全关、未声明国家默认全开', () => {
  const gate = A.createGeoGate(FIX.geo);
  assert.equal(gate('DE', 'rewarded'), false, 'DE 关激励视频');
  assert.equal(gate('DE', 'interstitial'), true, 'DE 保留插屏');
  assert.equal(gate('CN', 'rewarded'), false);
  assert.equal(gate('CN', 'interstitial'), false, 'CN 全关');
  assert.equal(gate('US', 'rewarded'), true);
  assert.equal(gate('US', 'interstitial'), true);
});

test('S10: mock 游戏 C 空矩阵 = 默认全开（geo 联动纯 config 差异）', () => {
  const gate = A.createGeoGate(gameCfg('mockc').ads.geo);
  assert.equal(gate('DE', 'rewarded'), true);
  assert.equal(gate('CN', 'interstitial'), true);
});

test('S10: 真实游戏 config 联动矩阵落地且判定一致', () => {
  const water = A.createGeoGate(gameCfg('water').ads.geo);
  assert.equal(water('DE', 'rewarded'), false);
  assert.equal(water('DE', 'interstitial'), true);
  const sudoku = A.createGeoGate(gameCfg('sudoku').ads.geo);
  assert.equal(sudoku('CN', 'rewarded'), false);
  assert.equal(sudoku('CN', 'interstitial'), false);
});
