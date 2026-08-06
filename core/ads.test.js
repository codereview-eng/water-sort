/* 广告策略 core 单元测试：插屏频控 + geo 开关矩阵 + fail-fast
   （issue #1 · S9/S10 机制面；场景级断言见 fixtures/S9–S10） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('./ads.js');

test('默认配置 = 无插屏、广告全开（附加式，不改既有行为）', () => {
  assert.equal(A.createInterstitial(null).shouldShow({ levelsSinceAd: 99 }, 1e12), false);
  const gate = A.createGeoGate(null);
  assert.equal(gate('US', 'rewarded'), true);
  assert.equal(gate('US', 'interstitial'), true);
});

test('插屏频控：everyN / minGapSec 单用与叠加（AND）', () => {
  const n = A.createInterstitial({ enabled: true, everyN: 3 });
  assert.equal(n.shouldShow({ levelsSinceAd: 2 }, 0), false);
  assert.equal(n.shouldShow({ levelsSinceAd: 3 }, 0), true);
  const g = A.createInterstitial({ enabled: true, minGapSec: 60 });
  assert.equal(g.shouldShow({ lastAdAt: 0 }, 59000), false);
  assert.equal(g.shouldShow({ lastAdAt: 0 }, 60000), true);
  const both = A.createInterstitial({ enabled: true, everyN: 5, minGapSec: 60 });
  assert.equal(both.shouldShow({ levelsSinceAd: 5, lastAdAt: 0 }, 30000), false, '关数够但间隔不够');
  assert.equal(both.shouldShow({ levelsSinceAd: 4, lastAdAt: 0 }, 90000), false, '间隔够但关数不够');
  assert.equal(both.shouldShow({ levelsSinceAd: 5, lastAdAt: 0 }, 90000), true);
});

test('geo 开关矩阵：按国关型、通配符、默认开', () => {
  const gate = A.createGeoGate({ DE: { rewarded: false }, CN: { rewarded: false, interstitial: false }, '*': { interstitial: true } });
  assert.equal(gate('DE', 'rewarded'), false);
  assert.equal(gate('DE', 'interstitial'), true);
  assert.equal(gate('CN', 'interstitial'), false);
  assert.equal(gate('BR', 'rewarded'), true);
});

test('fail-fast：未知键/模式缺参/非法值/未知广告类型 全部加载期抛错', () => {
  assert.throws(() => A.createInterstitial({ enabled: true }), /至少一项/);
  assert.throws(() => A.createInterstitial({ enabled: true, everyN: 0 }), /everyN/);
  assert.throws(() => A.createInterstitial({ enabled: true, minGapSec: -1 }), /minGapSec/);
  assert.throws(() => A.createInterstitial({ mode: 'random' }), /未知键/);
  assert.throws(() => A.createGeoGate({ US: { banner: true } }), /未知广告类型/);
  assert.throws(() => A.createGeoGate({ US: { rewarded: 'no' } }), /boolean/);
  assert.throws(() => A.createGeoGate({})('US', 'banner'), /未知广告类型/);
});
