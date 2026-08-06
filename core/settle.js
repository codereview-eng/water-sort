/* 通关结算 core：奖励模型 + 看视频翻倍 + 首通/重复衰减（issue #1 · S1/S2/S3）
   纪律：core 只认「难度/连胜/已通次数」这几个数字；策略枚举与全部参数在 game
   config；未知模式/未知键/非法值一律加载期抛错（防静默吞错、防 soft-coding：
   曲线只接受受限参数，不接受表达式字符串）。浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SettleCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MODES = ['fixed', 'difficulty', 'streakRamp'];
  var DEFAULTS = Object.freeze({
    mode: 'fixed',        // S1 奖励模型：fixed | difficulty | streakRamp
    base: 10,             // 基础金额
    coeff: 1,             // 曲线系数（difficulty/streakRamp 用）
    cap: 999,             // 单次结算上限截断
    firstClearMult: 1,    // S3 首通放大倍数
    decay: null,          // S3 重复通关衰减 {rate:(0,1), floor:>=0}
    adBonus: null         // S2 看视频翻倍 {enabled, multiplier, dailyCap, cooldownMs}
  });
  var AD_DEFAULTS = Object.freeze({ enabled: false, multiplier: 2, dailyCap: 5, cooldownMs: 60000 });

  function fail(msg) { throw new Error('settle config: ' + msg); }

  function validateAdBonus(ab) {
    if (ab == null) return Object.assign({}, AD_DEFAULTS);
    if (typeof ab !== 'object' || Array.isArray(ab)) fail('adBonus 必须是对象');
    var KEYS = Object.keys(AD_DEFAULTS);
    for (var k in ab) if (KEYS.indexOf(k) === -1) fail('adBonus 未知键 "' + k + '"（合法键：' + KEYS.join('、') + '）');
    var c = Object.assign({}, AD_DEFAULTS, ab);
    if (typeof c.enabled !== 'boolean') fail('adBonus.enabled 必须是 boolean');
    if (c.enabled) {
      if (!Number.isInteger(c.multiplier) || c.multiplier < 2) fail('adBonus.multiplier 必须是 >=2 的整数，得到 ' + JSON.stringify(c.multiplier));
      if (!Number.isInteger(c.dailyCap) || c.dailyCap <= 0) fail('adBonus.dailyCap 必须是 >0 的整数，得到 ' + JSON.stringify(c.dailyCap));
      if (typeof c.cooldownMs !== 'number' || !isFinite(c.cooldownMs) || c.cooldownMs < 0) fail('adBonus.cooldownMs 必须是 >=0 的有限数');
    }
    return c;
  }

  function validate(cfg) {
    if (cfg == null) cfg = {};
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('必须是对象，得到 ' + Object.prototype.toString.call(cfg));
    var KEYS = Object.keys(DEFAULTS);
    for (var k in cfg) if (KEYS.indexOf(k) === -1) fail('未知键 "' + k + '"（合法键：' + KEYS.join('、') + '）');
    var c = Object.assign({}, DEFAULTS, cfg);
    if (MODES.indexOf(c.mode) === -1) fail('未知 mode "' + c.mode + '"（合法：' + MODES.join('、') + '）');
    ['base', 'coeff', 'cap', 'firstClearMult'].forEach(function (key) {
      if (typeof c[key] !== 'number' || !isFinite(c[key]) || c[key] <= 0) fail('"' + key + '" 必须是 >0 的有限数，得到 ' + JSON.stringify(c[key]));
    });
    if (c.decay !== null) {
      if (typeof c.decay !== 'object' || Array.isArray(c.decay)) fail('decay 必须是对象');
      for (var dk in c.decay) if (dk !== 'rate' && dk !== 'floor') fail('decay 未知键 "' + dk + '"');
      if (typeof c.decay.rate !== 'number' || !(c.decay.rate > 0 && c.decay.rate < 1)) fail('decay.rate 必须在 (0,1)，得到 ' + JSON.stringify(c.decay.rate));
      if (typeof c.decay.floor !== 'number' || !isFinite(c.decay.floor) || c.decay.floor < 0) fail('decay.floor 必须是 >=0 的有限数');
      c.decay = { rate: c.decay.rate, floor: c.decay.floor };
    }
    c.adBonus = validateAdBonus(cfg.adBonus == null ? null : cfg.adBonus);
    return c;
  }

  function nonNegInt(v, name) {
    if (v == null) return 0;
    if (!Number.isInteger(v) || v < 0) throw new Error('settle: "' + name + '" 必须是 >=0 的整数，得到 ' + JSON.stringify(v));
    return v;
  }

  function utcDay(now) { return Math.floor(now / 86400000); }

  function create(cfg) {
    var C = validate(cfg);

    // S1/S3：结算纯函数。输入只有三个数字，历史（clearCount）由调用方状态层提供。
    function settle(ev) {
      ev = ev || {};
      var diff = nonNegInt(ev.diff, 'diff');
      var streak = nonNegInt(ev.streak, 'streak');
      var clears = nonNegInt(ev.clearCount, 'clearCount');
      var v = C.base;
      if (C.mode === 'difficulty') v = C.base * (1 + C.coeff * diff);
      if (C.mode === 'streakRamp') v = C.base * (1 + C.coeff * streak);
      if (clears === 0) v *= C.firstClearMult;                 // S3 首通放大
      else if (C.decay) v = Math.max(C.decay.floor, v * Math.pow(1 - C.decay.rate, clears)); // S3 衰减到下限
      return Math.min(C.cap, Math.floor(v));
    }

    // S2：看视频翻倍。state = {day, used, lastAt}（由调用方持久化），UTC 日归零。
    function adVisible() { return C.adBonus.enabled; }
    function adAvailable(state, now) {
      if (!C.adBonus.enabled) return false;
      state = state || {};
      var used = state.day === utcDay(now) ? (state.used || 0) : 0;
      return used < C.adBonus.dailyCap && now - (state.lastAt || 0) >= C.adBonus.cooldownMs;
    }
    function adApply(coins, state, now) {
      if (!adAvailable(state, now)) throw new Error('settle: adBonus 当前不可用（关闭/到上限/冷却中）');
      state = state || {};
      var day = utcDay(now);
      return {
        coins: coins * C.adBonus.multiplier,
        state: { day: day, used: (state.day === day ? (state.used || 0) : 0) + 1, lastAt: now }
      };
    }

    return { settle: settle, adVisible: adVisible, adAvailable: adAvailable, adApply: adApply, config: C };
  }

  return { create: create, validate: validate, DEFAULTS: DEFAULTS, MODES: MODES };
});
