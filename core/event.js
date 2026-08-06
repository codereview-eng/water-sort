/* 每周活动 core：活动积分口径 + 奖励梯度（issue #1 · S7/S8）
   纪律：core 只提供「事件→积分→周期→发奖」机制；积分口径（metric）、周期
   （period）、奖励梯度（rewards）全部 config 声明；不开活动 = enabled:false，
   活动入口整体不渲染；未知口径/周期/梯度类型/非法梯度一律加载期抛错。
   浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var METRICS = ['clears', 'stars'];
  var PERIODS = ['weekly', 'biweekly'];
  var REWARD_KINDS = ['milestone', 'top10'];
  var DEFAULTS = Object.freeze({ enabled: false, metric: 'clears', period: 'weekly', rewards: null });
  var DAY = 86400000;

  function fail(msg) { throw new Error('event config: ' + msg); }

  function validate(cfg) {
    if (cfg == null) cfg = {};
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('必须是对象');
    var KEYS = Object.keys(DEFAULTS);
    for (var k in cfg) if (KEYS.indexOf(k) === -1) fail('未知键 "' + k + '"（合法键：' + KEYS.join('、') + '）');
    var c = Object.assign({}, DEFAULTS, cfg);
    if (typeof c.enabled !== 'boolean') fail('enabled 必须是 boolean');
    if (METRICS.indexOf(c.metric) === -1) fail('未知 metric "' + c.metric + '"（合法：' + METRICS.join('、') + '）');
    if (PERIODS.indexOf(c.period) === -1) fail('未知 period "' + c.period + '"（合法：' + PERIODS.join('、') + '）');
    if (c.rewards !== null) {
      if (typeof c.rewards !== 'object' || Array.isArray(c.rewards)) fail('rewards 必须是对象');
      for (var rk in c.rewards) if (rk !== 'kind' && rk !== 'tiers') fail('rewards 未知键 "' + rk + '"');
      if (REWARD_KINDS.indexOf(c.rewards.kind) === -1) fail('未知 rewards.kind "' + c.rewards.kind + '"（合法：' + REWARD_KINDS.join('、') + '）');
      if (!Array.isArray(c.rewards.tiers) || c.rewards.tiers.length === 0) fail('rewards.tiers 必须是非空数组');
      c.rewards.tiers.forEach(function (t, i) {
        if (!t || typeof t !== 'object') fail('rewards.tiers[' + i + '] 必须是对象');
        if (!Number.isInteger(t.coins) || t.coins < 0) fail('rewards.tiers[' + i + '].coins 必须是 >=0 的整数');
        if (c.rewards.kind === 'milestone') {
          if (!Number.isInteger(t.at) || t.at <= 0) fail('rewards.tiers[' + i + '].at 必须是 >0 的整数（达标阈值）');
          for (var tk in t) if (tk !== 'at' && tk !== 'coins') fail('rewards.tiers[' + i + '] 未知键 "' + tk + '"');
        } else {
          for (var tk2 in t) if (tk2 !== 'coins') fail('rewards.tiers[' + i + '] 未知键 "' + tk2 + '"（top10 梯度按数组序即名次）');
        }
      });
      if (c.rewards.kind === 'milestone') {
        for (var j = 1; j < c.rewards.tiers.length; j++)
          if (c.rewards.tiers[j].at <= c.rewards.tiers[j - 1].at) fail('milestone tiers 的 at 必须严格递增');
      }
    }
    return c;
  }

  function notActive() { throw new Error('event: 未开活动（enabled=false 时不应调用活动 API）'); }

  function create(cfg) {
    var C = validate(cfg);
    if (!C.enabled) {
      return { active: false, visible: function () { return false; }, periodIndex: notActive, score: notActive, settleRewards: notActive, config: C };
    }
    var periodMs = (C.period === 'weekly' ? 7 : 14) * DAY;

    // UTC 周期序号：与既有 weekly 纪律同口径（纯函数、UTC、可跨双周期）
    function periodIndex(now) {
      if (typeof now !== 'number' || !isFinite(now) || now < 0) throw new Error('event: now 必须是 >=0 的毫秒时间戳');
      return Math.floor(now / periodMs);
    }

    // 事件→积分：口径由 config.metric 决定，core 不认识具体玩法
    function score(ev) {
      ev = ev || {};
      if (C.metric === 'clears') return ev.cleared ? 1 : 0;
      var s = ev.stars == null ? 0 : ev.stars;
      if (!Number.isInteger(s) || s < 0) throw new Error('event: stars 必须是 >=0 的整数');
      return s;
    }

    // 发奖：milestone 人人可拿（取最高达标档）；top10 按名次（1-based，超出梯度 = 0）
    function settleRewards(ctx) {
      ctx = ctx || {};
      if (!C.rewards) return 0;
      if (C.rewards.kind === 'milestone') {
        var points = ctx.points == null ? 0 : ctx.points;
        if (!Number.isInteger(points) || points < 0) throw new Error('event: points 必须是 >=0 的整数');
        var got = 0;
        C.rewards.tiers.forEach(function (t) { if (points >= t.at) got = t.coins; });
        return got;
      }
      var rank = ctx.rank;
      if (!Number.isInteger(rank) || rank <= 0) throw new Error('event: rank 必须是 >0 的整数');
      var tier = C.rewards.tiers[rank - 1];
      return tier ? tier.coins : 0;
    }

    return { active: true, visible: function () { return true; }, periodIndex: periodIndex, score: score, settleRewards: settleRewards, config: C };
  }

  return { create: create, validate: validate, DEFAULTS: DEFAULTS, METRICS: METRICS, PERIODS: PERIODS, REWARD_KINDS: REWARD_KINDS };
});
