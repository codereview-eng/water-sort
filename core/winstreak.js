/* 双连胜 core（2026-08-24 需求定案，与 core/streak.js 的里程碑连胜是两套系统）：
   A · 首页累计大连胜：只增不封顶；失败不立刻清零，挂 pend 标记，宿主在
       「下次点击开始」时弹「看广告保持」——keep() 保持原值 / drop() 清零；
       连胜 < keepMinPrompt 的小连胜断了静默清零，不打扰（用户拍板 ≥3 才弹）。
   B · 每 every 盘连胜出一张奖励票：看广告领取 rewards（体力/金币/周碎片），
       领取后周期从 0 重新累积；不领则票与 10/10 状态一直保留（后续失败也不丢，
       用户拍板：票不叠加，未领取期间周期冻结在 every/every）。
   纪律（与本仓 core 同构）：core 是纯状态机，不认识「广告」也不入账奖励——
   领取方式由宿主走 ads placements（streak-keep / streak-claim），奖励内容只按
   config 透传数值，体力/金币/碎片各自走 RewardCore/StockCore/WeeklyCore 入账。
   A、B 独立（用户拍板）：失败瞬间 B 周期清零，A 的广告只救大连胜数字。
   云同步纪律：earned/claimed 是只增计数（merge:max，票不会丢也不会复活，
   同 core/stock.js 的账本思路）；cur/pend/cyc 语义可增可减，merge:newest。
   非法配置一律加载期抛错。浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WinStreakCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CFG_KEYS = ['enabled', 'keepMinPrompt', 'every', 'rewards'];
  var REWARD_KEYS = ['energy', 'coins', 'frags'];
  var DEFAULTS = { keepMinPrompt: 3, every: 10, rewards: { energy: 60, coins: 10, frags: 10 } };

  function fail(msg) { throw new Error('winstreak config: ' + msg); }

  function intAt(v, name, min) {
    if (!Number.isInteger(v) || v < min) fail(name + ' 必须是 >= ' + min + ' 的整数，得到 ' + JSON.stringify(v));
    return v;
  }

  function n0(v) { return Number.isInteger(v) && v > 0 ? v : 0; }

  function create(cfg) {
    if (cfg == null) cfg = { enabled: false };
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('必须是对象');
    for (var k in cfg) if (CFG_KEYS.indexOf(k) === -1) fail('未知键 "' + k + '"（合法键：' + CFG_KEYS.join('、') + '）');
    if (typeof cfg.enabled !== 'boolean') fail('enabled 必须是 boolean');
    if (!cfg.enabled) {
      var off = function () { throw new Error('winstreak: 未开启（enabled:false，入口不应存在）'); };
      return {
        enabled: false, visible: function () { return false; },
        init: off, win: off, lose: off, keep: off, drop: off, claim: off,
        hasTicket: function () { return false; }, cycleShown: function () { return 0; },
        every: 0, keepMinPrompt: 0, rewards: function () { return {}; }
      };
    }
    var minPrompt = cfg.keepMinPrompt === undefined ? DEFAULTS.keepMinPrompt : intAt(cfg.keepMinPrompt, 'keepMinPrompt', 1);
    var every = cfg.every === undefined ? DEFAULTS.every : intAt(cfg.every, 'every', 2);
    var rw = { energy: DEFAULTS.rewards.energy, coins: DEFAULTS.rewards.coins, frags: DEFAULTS.rewards.frags };
    if (cfg.rewards !== undefined) {
      if (typeof cfg.rewards !== 'object' || cfg.rewards === null || Array.isArray(cfg.rewards)) fail('rewards 必须是对象');
      for (var rk in cfg.rewards) if (REWARD_KEYS.indexOf(rk) === -1) fail('rewards 未知键 "' + rk + '"（合法键：' + REWARD_KEYS.join('、') + '）');
      REWARD_KEYS.forEach(function (key) {
        if (cfg.rewards[key] !== undefined) rw[key] = intAt(cfg.rewards[key], 'rewards.' + key, 0);
      });
    }
    if (rw.energy + rw.coins + rw.frags === 0) fail('rewards 三项不能全为 0（那等于没有奖励票系统，应 enabled:false）');

    function ticketPending(st) { return st.earned > st.claimed; }

    /* 从持久化对象恢复：字段缺失/损坏一律回落为 0/false，只增对不允许倒挂 */
    function from(obj) {
      obj = (obj && typeof obj === 'object') ? obj : {};
      var earned = n0(obj.earned), claimed = n0(obj.claimed);
      if (claimed > earned) claimed = earned;
      var cyc = n0(obj.cyc);
      if (cyc > every) cyc = every;
      return { cur: n0(obj.cur), pend: obj.pend === true || obj.pend === 1, cyc: cyc, earned: earned, claimed: claimed };
    }

    return {
      enabled: true,
      visible: function () { return true; },
      every: every,
      keepMinPrompt: minPrompt,
      rewards: function () { return { energy: rw.energy, coins: rw.coins, frags: rw.frags }; },
      init: function () { return { cur: 0, pend: false, cyc: 0, earned: 0, claimed: 0 }; },
      from: from,
      hasTicket: ticketPending,
      /* 首页/结算页展示用：有未领取票时周期冻结显示 every/every */
      cycleShown: function (st) { return ticketPending(st) ? every : st.cyc; },
      /* 胜利：A +1；B 无票时 +1、数到 every 出票；有票时冻结不叠加（用户拍板） */
      win: function (st) {
        if (st.pend) throw new Error('winstreak: 存在未决的断链（先 keep 或 drop 再开局）');
        var next = { cur: st.cur + 1, pend: false, cyc: st.cyc, earned: st.earned, claimed: st.claimed };
        var ticket = false;
        if (!ticketPending(st)) {
          next.cyc = st.cyc + 1;
          if (next.cyc === every) { next.earned = st.earned + 1; ticket = true; }
        }
        return { state: next, ticket: ticket };
      },
      /* 失败：B 周期立即清零（票不受影响）；A 小连胜静默清零、大连胜挂 pend 等宿主弹窗 */
      lose: function (st) {
        if (st.pend) throw new Error('winstreak: 存在未决的断链（先 keep 或 drop 再开局）');
        var cyc = ticketPending(st) ? every : 0;
        if (st.cur >= minPrompt) {
          return { state: { cur: st.cur, pend: true, cyc: cyc, earned: st.earned, claimed: st.claimed }, outcome: 'prompt' };
        }
        return { state: { cur: 0, pend: false, cyc: cyc, earned: st.earned, claimed: st.claimed }, outcome: 'reset' };
      },
      /* 广告看完：保持大连胜原值（不救 B 周期——A、B 独立，用户拍板） */
      keep: function (st) {
        if (!st.pend) throw new Error('winstreak: 无待保持的断链');
        return { cur: st.cur, pend: false, cyc: st.cyc, earned: st.earned, claimed: st.claimed };
      },
      /* 拒绝/关窗：清零重新累积 */
      drop: function (st) {
        if (!st.pend) throw new Error('winstreak: 无待保持的断链');
        return { cur: 0, pend: false, cyc: st.cyc, earned: st.earned, claimed: st.claimed };
      },
      /* 领取（宿主已确认广告播完）：票核销、周期归零，奖励数值透传给宿主入账 */
      claim: function (st) {
        if (!ticketPending(st)) throw new Error('winstreak: 没有可领取的奖励票');
        return {
          state: { cur: st.cur, pend: st.pend, cyc: 0, earned: st.earned, claimed: st.claimed + 1 },
          rewards: { energy: rw.energy, coins: rw.coins, frags: rw.frags }
        };
      }
    };
  }

  return { create: create };
});
