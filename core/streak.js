/* 连胜系统 core：状态机 + 里程碑发奖描述符（issue #1 · S21/S22/S24）
   纪律：core 只提供连胜状态机（win/lose/freeze 三个事件入口）与「数到 N」；
   阈值、领取方式（ad/direct/整体关闭）、清零/豁免/续命策略全 config；
   宽恕消耗顺序 core 定死（先每日首败豁免、再广告续命，防组合爆炸）；
   奖励只发描述符（type/id/amount 按 id 引用目录），streak core 不认识
   「广告」也不认识奖励内容；enabled:false = 无此系统（入口不渲染、API
   调用即拒）。非法配置一律加载期抛错。浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StreakCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var CLAIMS = ['direct', 'ad'];
  var REWARD_TYPES = ['coins', 'item', 'cosmetic'];
  var CFG_KEYS = ['enabled', 'claimMode', 'policy', 'tiers'];
  var POLICY_KEYS = ['resetOnLoss', 'dailyFirstLossForgiven', 'adRevive'];
  var REVIVE_KEYS = ['enabled', 'maxPerStreak'];
  var TIER_KEYS = ['streak', 'reward'];
  var REWARD_KEYS = ['type', 'id', 'amount'];

  function fail(msg) { throw new Error('streak config: ' + msg); }

  function validateReward(r, at) {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) fail('tier@' + at + ' reward 必须是对象');
    for (var k in r) if (REWARD_KEYS.indexOf(k) === -1) fail('tier@' + at + ' reward 未知键 "' + k + '"');
    if (REWARD_TYPES.indexOf(r.type) === -1) fail('tier@' + at + ' 未知 reward.type "' + r.type + '"（合法：' + REWARD_TYPES.join('、') + '）');
    if (r.type === 'coins') {
      if (!Number.isInteger(r.amount) || r.amount <= 0) fail('tier@' + at + ' coins.amount 必须是 >0 整数');
      if (r.id !== undefined) fail('tier@' + at + ' coins 不接受 id');
    } else {
      if (typeof r.id !== 'string' || !r.id) fail('tier@' + at + ' ' + r.type + ' 必须按 id 引用目录');
      if (r.amount !== undefined && (!Number.isInteger(r.amount) || r.amount <= 0)) fail('tier@' + at + ' amount 必须是 >0 整数');
    }
  }

  function create(cfg) {
    if (cfg == null) cfg = { enabled: false };
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('必须是对象');
    for (var k in cfg) if (CFG_KEYS.indexOf(k) === -1) fail('未知键 "' + k + '"（合法键：' + CFG_KEYS.join('、') + '）');
    if (typeof cfg.enabled !== 'boolean') fail('enabled 必须是 boolean');
    if (!cfg.enabled) {
      var off = function () { throw new Error('streak: 未开启（enabled:false，入口不应存在）'); };
      return { enabled: false, visible: function () { return false; }, init: off, win: off, lose: off, freeze: off, confirmLoss: off, tiers: function () { return []; } };
    }
    if (CLAIMS.indexOf(cfg.claimMode) === -1) fail('未知 claimMode "' + cfg.claimMode + '"（合法：' + CLAIMS.join('、') + '）');
    var p = { resetOnLoss: true, dailyFirstLossForgiven: false, adRevive: null };
    if (cfg.policy != null) {
      if (typeof cfg.policy !== 'object' || Array.isArray(cfg.policy)) fail('policy 必须是对象');
      for (var pk in cfg.policy) {
        if (POLICY_KEYS.indexOf(pk) === -1) fail('policy 未知键 "' + pk + '"（合法键：' + POLICY_KEYS.join('、') + '）');
        p[pk] = cfg.policy[pk];
      }
    }
    if (typeof p.resetOnLoss !== 'boolean') fail('policy.resetOnLoss 必须是 boolean');
    if (typeof p.dailyFirstLossForgiven !== 'boolean') fail('policy.dailyFirstLossForgiven 必须是 boolean');
    if (p.adRevive != null) {
      if (typeof p.adRevive !== 'object' || Array.isArray(p.adRevive)) fail('policy.adRevive 必须是对象');
      for (var rk in p.adRevive) if (REVIVE_KEYS.indexOf(rk) === -1) fail('adRevive 未知键 "' + rk + '"');
      if (typeof p.adRevive.enabled !== 'boolean') fail('adRevive.enabled 必须是 boolean');
      if (!Number.isInteger(p.adRevive.maxPerStreak) || p.adRevive.maxPerStreak <= 0) fail('adRevive.maxPerStreak 必须是 >0 整数');
    }
    var tiers = cfg.tiers === undefined ? [] : cfg.tiers;
    if (!Array.isArray(tiers)) fail('tiers 必须是数组');
    var lastAt = 0;
    tiers.forEach(function (t) {
      if (typeof t !== 'object' || t === null || Array.isArray(t)) fail('tier 必须是对象');
      for (var tk in t) if (TIER_KEYS.indexOf(tk) === -1) fail('tier 未知键 "' + tk + '"');
      if (!Number.isInteger(t.streak) || t.streak <= 0) fail('tier.streak 必须是 >0 整数');
      if (t.streak <= lastAt) fail('tiers 必须严格递增（' + t.streak + ' <= ' + lastAt + '）');
      validateReward(t.reward, t.streak);
      lastAt = t.streak;
    });

    var canRevive = function (state) {
      return p.adRevive && p.adRevive.enabled && state.revives < p.adRevive.maxPerStreak;
    };

    return {
      enabled: true,
      visible: function () { return true; },
      tiers: function () { return tiers.slice(); },
      init: function () { return { current: 0, best: 0, forgivenDay: null, revives: 0, pendingLoss: false }; },
      // 胜利：+1 并结算命中的里程碑（发奖描述符，领取方式随 config）
      win: function (state) {
        if (state.pendingLoss) throw new Error('streak: 存在未决的失败（先 freeze 或 confirmLoss）');
        var current = state.current + 1;
        var rewards = tiers.filter(function (t) { return t.streak === current; })
          .map(function (t) { return { streak: t.streak, reward: t.reward, claim: cfg.claimMode }; });
        return {
          state: { current: current, best: Math.max(state.best, current), forgivenDay: state.forgivenDay, revives: state.revives, pendingLoss: false },
          rewards: rewards
        };
      },
      // 失败：宽恕顺序 core 定死——①每日首败豁免 ②广告续命 ③清零
      lose: function (state, now) {
        if (typeof now !== 'number' || !isFinite(now) || now < 0) throw new Error('streak: lose 需要 now 时间戳');
        var day = Math.floor(now / DAY);
        if (p.dailyFirstLossForgiven && state.forgivenDay !== day) {
          return { state: Object.assign({}, state, { forgivenDay: day }), outcome: 'forgiven' };
        }
        if (canRevive(state)) {
          return { state: Object.assign({}, state, { pendingLoss: true }), outcome: 'revivable' };
        }
        return {
          state: Object.assign({}, state, { current: p.resetOnLoss ? 0 : state.current, revives: 0, pendingLoss: false }),
          outcome: p.resetOnLoss ? 'reset' : 'kept'
        };
      },
      // 续命确认（广告播完/道具已扣——由调用方走 ads/powerups 链路，core 不认识广告）
      freeze: function (state) {
        if (!state.pendingLoss) throw new Error('streak: 无待续命的失败');
        return Object.assign({}, state, { revives: state.revives + 1, pendingLoss: false });
      },
      // 放弃续命：按清零策略落地
      confirmLoss: function (state) {
        if (!state.pendingLoss) throw new Error('streak: 无待确认的失败');
        return Object.assign({}, state, { current: p.resetOnLoss ? 0 : state.current, revives: 0, pendingLoss: false });
      }
    };
  }

  return { create: create, CLAIMS: CLAIMS, REWARD_TYPES: REWARD_TYPES };
});
