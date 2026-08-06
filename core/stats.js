/* 排行与档案 core：终身档案声明式聚合 + 排行维度声明式（issue #1 · S11/S12）
   纪律：archive core 不硬编码任何统计字段——统计项 = config 声明的
   {key, event, agg, field?} 集合，聚合算子仅 count/sum/max/min/last；
   排行 = config 声明的 {id, metric, order, operator, period}，metric 必须
   引用已声明统计项，比较器由 order 生成、不写死；未知 agg/order/operator/
   period/metric 一律加载期抛错。浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StatsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var AGGS = ['count', 'sum', 'max', 'min', 'last'];
  var ORDERS = ['asc', 'desc'];
  var OPERATORS = ['best', 'increment'];
  var PERIODS = ['none', 'weekly', 'biweekly'];
  var DAY = 86400000;

  function fail(msg) { throw new Error('stats config: ' + msg); }

  // ---- S12 终身档案：声明式统计项 ----
  var STAT_KEYS = ['key', 'event', 'agg', 'field', 'label', 'unit'];

  function createArchive(decls) {
    if (decls == null) decls = [];
    if (!Array.isArray(decls)) fail('lifetimeStats 必须是数组');
    var map = new Map();
    decls.forEach(function (d) {
      if (typeof d !== 'object' || d === null || Array.isArray(d)) fail('统计项必须是对象');
      for (var k in d) if (STAT_KEYS.indexOf(k) === -1) fail('统计项未知键 "' + k + '"（合法键：' + STAT_KEYS.join('、') + '）');
      if (typeof d.key !== 'string' || !d.key) fail('统计项 key 缺失');
      if (map.has(d.key)) fail('统计项 key "' + d.key + '" 重复');
      if (typeof d.event !== 'string' || !d.event) fail('统计项 "' + d.key + '" 必须声明 event');
      if (AGGS.indexOf(d.agg) === -1) fail('统计项 "' + d.key + '" 未知 agg "' + d.agg + '"（合法：' + AGGS.join('、') + '）');
      if (d.agg !== 'count' && (typeof d.field !== 'string' || !d.field)) fail('统计项 "' + d.key + '" agg=' + d.agg + ' 必须声明 field');
      if (d.agg === 'count' && d.field !== undefined) fail('统计项 "' + d.key + '" agg=count 不接受 field');
      map.set(d.key, { decl: d, value: d.agg === 'count' || d.agg === 'sum' ? 0 : null });
    });
    return {
      keys: function () { return Array.from(map.keys()); },
      // 事件流入口：core 只按声明逐项聚合，对事件名/字段语义零认知
      onEvent: function (name, payload) {
        map.forEach(function (s) {
          var d = s.decl;
          if (d.event !== name) return;
          if (d.agg === 'count') { s.value += 1; return; }
          var v = (payload || {})[d.field];
          if (typeof v !== 'number' || !isFinite(v)) throw new Error('stats: 事件 "' + name + '" 字段 "' + d.field + '" 必须是有限数');
          if (d.agg === 'sum') s.value += v;
          else if (d.agg === 'max') s.value = s.value === null ? v : Math.max(s.value, v);
          else if (d.agg === 'min') s.value = s.value === null ? v : Math.min(s.value, v);
          else s.value = v; // last
        });
      },
      get: function (key) {
        if (!map.has(key)) throw new Error('stats: 未声明 statKey "' + key + '"');
        return map.get(key).value;
      },
      all: function () {
        var out = {};
        map.forEach(function (s, k) { out[k] = s.value; });
        return out;
      }
    };
  }

  // ---- S11 排行：维度/方向/写入语义/周期全声明 ----
  var LB_KEYS = ['id', 'metric', 'order', 'operator', 'period'];

  function periodMs(p) { return p === 'weekly' ? 7 * DAY : 14 * DAY; }

  function createRank(cfgs, statKeys) {
    if (cfgs == null) cfgs = [];
    if (!Array.isArray(cfgs)) fail('leaderboards 必须是数组');
    if (!Array.isArray(statKeys)) fail('createRank 需要已声明统计项集合');
    var boards = new Map();
    cfgs.forEach(function (c) {
      if (typeof c !== 'object' || c === null || Array.isArray(c)) fail('榜配置必须是对象');
      for (var k in c) if (LB_KEYS.indexOf(k) === -1) fail('榜配置未知键 "' + k + '"（合法键：' + LB_KEYS.join('、') + '）');
      if (typeof c.id !== 'string' || !c.id) fail('榜 id 缺失');
      if (boards.has(c.id)) fail('榜 id "' + c.id + '" 重复');
      if (statKeys.indexOf(c.metric) === -1) fail('榜 "' + c.id + '" metric "' + c.metric + '" 不在已声明统计项集合内（合法：' + statKeys.join('、') + '）');
      if (ORDERS.indexOf(c.order) === -1) fail('榜 "' + c.id + '" 未知 order "' + c.order + '"（合法：asc、desc）');
      if (OPERATORS.indexOf(c.operator) === -1) fail('榜 "' + c.id + '" 未知 operator "' + c.operator + '"（合法：best、increment）');
      var period = c.period === undefined ? 'none' : c.period;
      if (PERIODS.indexOf(period) === -1) fail('榜 "' + c.id + '" 未知 period "' + period + '"（合法：' + PERIODS.join('、') + '）');
      boards.set(c.id, { cfg: c, period: period, buckets: new Map() });
    });
    function bucketKey(b, now) {
      if (b.period === 'none') return 0;
      if (typeof now !== 'number' || !isFinite(now) || now < 0) throw new Error('stats: 周期榜需要 now 时间戳');
      return Math.floor(now / periodMs(b.period));
    }
    function mustGet(id) {
      var b = boards.get(id);
      if (!b) throw new Error('stats: 未知榜 "' + id + '"');
      return b;
    }
    return {
      ids: function () { return Array.from(boards.keys()); },
      submit: function (id, player, value, now) {
        var b = mustGet(id);
        if (typeof player !== 'string' || !player) throw new Error('stats: player 必须是非空字符串');
        if (typeof value !== 'number' || !isFinite(value)) throw new Error('stats: value 必须是有限数');
        var key = bucketKey(b, now || 0);
        if (!b.buckets.has(key)) b.buckets.set(key, new Map());
        var m = b.buckets.get(key);
        var prev = m.get(player);
        if (b.cfg.operator === 'increment') m.set(player, (prev || 0) + value);
        else if (prev === undefined || (b.cfg.order === 'asc' ? value < prev : value > prev)) m.set(player, value);
      },
      standings: function (id, now) {
        var b = mustGet(id);
        var m = b.buckets.get(bucketKey(b, now || 0)) || new Map();
        var dir = b.cfg.order === 'asc' ? 1 : -1;
        var rows = [];
        m.forEach(function (value, player) { rows.push({ player: player, value: value }); });
        rows.sort(function (x, y) { return dir * (x.value - y.value); });
        return rows;
      }
    };
  }

  return {
    createArchive: createArchive,
    createRank: createRank,
    AGGS: AGGS,
    ORDERS: ORDERS,
    OPERATORS: OPERATORS,
    PERIODS: PERIODS
  };
});
