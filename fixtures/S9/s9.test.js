/* S9 插屏频控三模式（issue #1 场景清单 · D 广告频控）
   验收：每 N 关一次 / 每 N 关且间隔 ≥60s / 无插屏——频控引擎一份拷贝，
   节奏全配置。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../../core/ads.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S9: A 每 3 关一次', () => {
  const i = A.createInterstitial(FIX.water);
  assert.equal(i.shouldShow({ levelsSinceAd: 2 }, 0), false);
  assert.equal(i.shouldShow({ levelsSinceAd: 3 }, 0), true);
});

test('S9: B 每 5 关且间隔 ≥60s（AND 叠加）', () => {
  const i = A.createInterstitial(FIX.sudoku);
  assert.equal(i.shouldShow({ levelsSinceAd: 5, lastAdAt: 0 }, 30000), false, '间隔不够');
  assert.equal(i.shouldShow({ levelsSinceAd: 4, lastAdAt: 0 }, 90000), false, '关数不够');
  assert.equal(i.shouldShow({ levelsSinceAd: 5, lastAdAt: 0 }, 90000), true);
});

test('S9: mock 游戏 C 无插屏——任何状态都不出', () => {
  const i = A.createInterstitial(FIX.mockc);
  assert.equal(i.enabled, false);
  assert.equal(i.shouldShow({ levelsSinceAd: 999, lastAdAt: 0 }, 1e12), false);
});

test('S9: 真实游戏 config 三种节奏落地且行为一致', () => {
  assert.equal(A.createInterstitial(gameCfg('water').ads.interstitial).shouldShow({ levelsSinceAd: 3 }, 0), true);
  assert.equal(A.createInterstitial(gameCfg('sudoku').ads.interstitial).shouldShow({ levelsSinceAd: 5, lastAdAt: 0 }, 30000), false);
  assert.equal(A.createInterstitial(gameCfg('mockc').ads.interstitial).shouldShow({ levelsSinceAd: 999 }, 1e12), false);
});
