/* 广告策略 core：插屏频控 + geo×广告联动开关（issue #1 · S9/S10）
   纪律：频控引擎一份拷贝，节奏（每 N 关/最小间隔秒/开关）全 config；
   geo 决策链输出（country）喂给声明式开关矩阵，某国关某类广告纯配置；
   未知模式/未知广告类型/非法参数一律加载期抛错。浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var AD_TYPES = ['interstitial', 'rewarded'];
  var INT_DEFAULTS = Object.freeze({ enabled: false, everyN: null, minGapSec: null });

  function fail(msg) { throw new Error('ads config: ' + msg); }

  // ---- S9 插屏频控：everyN 与 minGapSec 可单用可叠加（AND），enabled=false 整体关 ----
  function validateInterstitial(cfg) {
    if (cfg == null) cfg = {};
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('interstitial 必须是对象');
    var KEYS = Object.keys(INT_DEFAULTS);
    for (var k in cfg) if (KEYS.indexOf(k) === -1) fail('interstitial 未知键 "' + k + '"（合法键：' + KEYS.join('、') + '）');
    var c = Object.assign({}, INT_DEFAULTS, cfg);
    if (typeof c.enabled !== 'boolean') fail('interstitial.enabled 必须是 boolean');
    if (c.enabled) {
      if (c.everyN === null && c.minGapSec === null) fail('interstitial 开启时必须声明 everyN 或 minGapSec 至少一项');
      if (c.everyN !== null && (!Number.isInteger(c.everyN) || c.everyN <= 0)) fail('interstitial.everyN 必须是 >0 的整数');
      if (c.minGapSec !== null && (typeof c.minGapSec !== 'number' || !isFinite(c.minGapSec) || c.minGapSec <= 0)) fail('interstitial.minGapSec 必须是 >0 的数');
    }
    return c;
  }

  function createInterstitial(cfg) {
    var C = validateInterstitial(cfg);
    return {
      enabled: C.enabled,
      // state = {levelsSinceAd, lastAdAt}（由调用方持久化）；声明的条件全部满足才出
      shouldShow: function (state, now) {
        if (!C.enabled) return false;
        state = state || {};
        if (C.everyN !== null && (state.levelsSinceAd || 0) < C.everyN) return false;
        if (C.minGapSec !== null && now - (state.lastAdAt || 0) < C.minGapSec * 1000) return false;
        return true;
      },
      config: C
    };
  }

  // ---- S10 geo×广告开关矩阵：{ "<country>|*": { interstitial?: bool, rewarded?: bool } } ----
  function validateGeo(cfg) {
    if (cfg == null) return {};
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('geo 必须是对象（country → 开关矩阵）');
    for (var country in cfg) {
      var sw = cfg[country];
      if (typeof sw !== 'object' || sw === null || Array.isArray(sw)) fail('geo["' + country + '"] 必须是开关对象');
      for (var t in sw) {
        if (AD_TYPES.indexOf(t) === -1) fail('geo["' + country + '"] 未知广告类型 "' + t + '"（合法：' + AD_TYPES.join('、') + '）');
        if (typeof sw[t] !== 'boolean') fail('geo["' + country + '"].' + t + ' 必须是 boolean');
      }
    }
    return cfg;
  }

  function createGeoGate(cfg) {
    var C = validateGeo(cfg);
    return function allowed(country, type) {
      if (AD_TYPES.indexOf(type) === -1) throw new Error('ads: 未知广告类型 "' + type + '"');
      var sw = C[country] || C['*'] || {};
      return sw[type] !== false; // 未声明 = 默认开，显式 false 才关
    };
  }

  return {
    createInterstitial: createInterstitial,
    validateInterstitial: validateInterstitial,
    createGeoGate: createGeoGate,
    validateGeo: validateGeo,
    AD_TYPES: AD_TYPES
  };
});
