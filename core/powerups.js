/* 道具框架 core：注册表 + 库存 + 消费事务 + 获取渠道 + 解锁谓词（issue #1 · S4/S5/S6）
   纪律：core 对具体道具零认知——道具 id 由 game config 声明、效果 handler 由
   game 运行时注册（handler 本身计入 game 层玩法代码）；获取渠道与解锁条件全部
   声明式；未声明 id/未知渠道/未知谓词/非法数量一律加载期抛错。
   出入账一套代码（S5）：四种渠道只是 grantOn 触发点差异，全走同一 grant 账链。
   浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PowerupCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GRANT_TRIGGERS = ['levelClear', 'purchase', 'event', 'dailyLogin'];
  var PRED_TYPES = ['level', 'ad', 'currency'];

  function fail(msg) { throw new Error('powerups config: ' + msg); }

  // S6：解锁谓词（AND 列表）。与 lockedBottleSlots 雏形同一套词汇，供全仓复用。
  function validateUnlock(preds) {
    if (preds == null) return [];
    if (!Array.isArray(preds)) fail('unlock 必须是谓词数组（AND 语义）');
    return preds.map(function (p) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) fail('unlock 谓词必须是对象');
      if (PRED_TYPES.indexOf(p.type) === -1) fail('unlock 未知谓词类型 "' + (p && p.type) + '"（合法：' + PRED_TYPES.join('、') + '）');
      for (var k in p) if (k !== 'type' && k !== 'n') fail('unlock 谓词未知键 "' + k + '"');
      if (p.type === 'level' || p.type === 'currency') {
        if (!Number.isInteger(p.n) || p.n <= 0) fail('unlock ' + p.type + ' 谓词的 n 必须是 >0 的整数');
        return { type: p.type, n: p.n };
      }
      return { type: p.type };
    });
  }

  function evaluateUnlock(preds, state) {
    state = state || {};
    return preds.every(function (p) {
      if (p.type === 'level') return (state.level || 0) >= p.n;
      if (p.type === 'ad') return !!state.adWatched;
      if (p.type === 'currency') return (state.coins || 0) >= p.n;
      throw new Error('powerups: 未知谓词类型 "' + p.type + '"');
    });
  }

  function create(declared) {
    if (declared == null) declared = [];
    if (!Array.isArray(declared)) fail('powerups 必须是数组');
    var reg = Object.create(null);
    var order = [];
    declared.forEach(function (d) {
      if (!d || typeof d !== 'object' || Array.isArray(d)) fail('道具声明必须是对象');
      if (typeof d.id !== 'string' || !d.id) fail('道具声明缺 id');
      if (reg[d.id]) fail('道具 id 重复 "' + d.id + '"');
      for (var k in d) if (['id', 'grantOn', 'unlock'].indexOf(k) === -1) fail('道具 "' + d.id + '" 未知键 "' + k + '"');
      var grantOn = d.grantOn == null ? [] : d.grantOn;
      if (!Array.isArray(grantOn)) fail('道具 "' + d.id + '" 的 grantOn 必须是数组');
      grantOn = grantOn.map(function (g) {
        if (!g || typeof g !== 'object') fail('道具 "' + d.id + '" 的 grantOn 项必须是对象');
        if (GRANT_TRIGGERS.indexOf(g.trigger) === -1) fail('道具 "' + d.id + '" 未知获取渠道 "' + g.trigger + '"（合法：' + GRANT_TRIGGERS.join('、') + '）');
        if (!Number.isInteger(g.qty) || g.qty <= 0) fail('道具 "' + d.id + '" 渠道 ' + g.trigger + ' 的 qty 必须是 >0 的整数');
        for (var gk in g) if (gk !== 'trigger' && gk !== 'qty') fail('道具 "' + d.id + '" grantOn 未知键 "' + gk + '"');
        return { trigger: g.trigger, qty: g.qty };
      });
      reg[d.id] = { grantOn: grantOn, unlock: validateUnlock(d.unlock), handler: null, count: 0 };
      order.push(d.id);
    });

    var ledger = []; // {id, n, source}，sum(n) 恒等于库存总量（账实一致）

    function mustGet(id, verb) {
      var r = reg[id];
      if (!r) throw new Error('powerups: ' + verb + '未声明道具 "' + id + '"');
      return r;
    }

    return {
      ids: function () { return order.slice(); },
      // 效果 handler 由 game 注册；core 不认识 id 的语义（S4）
      register: function (id, handler) {
        var r = mustGet(id, '注册');
        if (typeof handler !== 'function') throw new Error('powerups: "' + id + '" 的 handler 必须是函数');
        r.handler = handler;
      },
      // S5：唯一入账口。四渠道与手工发放都走这里，账目可对。
      grant: function (id, n, source) {
        var r = mustGet(id, '入账');
        if (!Number.isInteger(n) || n <= 0) throw new Error('powerups: 入账数量必须是 >0 的整数，得到 ' + JSON.stringify(n));
        r.count += n;
        ledger.push({ id: id, n: n, source: String(source || 'manual') });
      },
      // S5：渠道触发点。config 声明了哪个渠道，哪个渠道就发放。
      fire: function (trigger) {
        if (GRANT_TRIGGERS.indexOf(trigger) === -1) throw new Error('powerups: 未知渠道触发 "' + trigger + '"');
        var self = this;
        order.forEach(function (id) {
          reg[id].grantOn.forEach(function (g) { if (g.trigger === trigger) self.grant(id, g.qty, trigger); });
        });
      },
      // S4：消费事务——先执行效果后扣账，效果失败不扣库存。
      consume: function (id, ctx) {
        var r = mustGet(id, '消费');
        if (typeof r.handler !== 'function') throw new Error('powerups: "' + id + '" 未注册效果 handler');
        if (r.count <= 0) return { ok: false, reason: 'empty' };
        var out = r.handler(ctx);
        if (out === false) return { ok: false, reason: 'handler' };
        r.count -= 1;
        ledger.push({ id: id, n: -1, source: 'consume' });
        return { ok: true };
      },
      count: function (id) { return mustGet(id, '查询').count; },
      // S6：解锁判定（谓词在 config 声明，这里只求值）
      unlocked: function (id, state) { return evaluateUnlock(mustGet(id, '判定').unlock, state); },
      ledger: function () { return ledger.slice(); }
    };
  }

  return {
    create: create,
    validateUnlock: validateUnlock,
    evaluateUnlock: evaluateUnlock,
    GRANT_TRIGGERS: GRANT_TRIGGERS,
    PRED_TYPES: PRED_TYPES
  };
});
