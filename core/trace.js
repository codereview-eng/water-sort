/* core/trace.js —— 客户端埋点环形缓冲（手机上无 devtools，这是唯一能回放现场的通道）。
   用户实报（2026-09-01）：「胜利结束时多次出现没弹出胜利 UI，直接返回首页」，此前几轮修复
   都没定位到，原因就是手机端没有任何可回放的记录：日志打在 console 里，玩家看不到也传不回来。

   设计判据（本机纪律第 5 条「降级分支必须可观测」的同源要求）：
   - 事件必须持久化：崩溃/刷新/回首页之后仍能查（localStorage 环形缓冲，超出上限丢最旧）；
   - 必须能在手机上「看得到 + 复制得走」：text() 出人可读纯文本，页面提供复制按钮；
   - 写入失败（隐私模式、配额满）不许把游戏带崩：全部 try/catch，降级为纯内存缓冲并计数；
   - 不采集任何身份信息，只记游戏内事件与时序。

   用法：
     var Trace = TraceCore.create({ key: 'mine_trace_v1', cap: 240 });
     Trace.log('dialog_open', { kind: 'win', lv: 7 });
     Trace.text();     // 人可读文本（复制给开发者）
     Trace.list();     // 结构化数组（自动化断言用）
     Trace.clear(); */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TraceCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULTS = { key: 'trace_v1', cap: 200, valueCap: 120 };

  function safeStore(store) {
    if (store) return store;
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
  }

  /* 值一律压成短字符串：手机上要复制走，一条事件不能几百字节；
     对象只取一层，长字符串截断（截断本身留 … 标记，别假装完整）。 */
  function fmtValue(v, cap) {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
    if (typeof v === 'boolean') return v ? '1' : '0';
    var s = String(v);
    return s.length > cap ? s.slice(0, cap) + '…' : s;
  }

  function create(opts) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var store = safeStore(cfg.store);
    var now = cfg.clock || function () { return Date.now(); };
    var buf = [];
    var seq = 0;
    var dropped = 0;         // 因超出上限被丢掉的最旧事件数（说明窗口不够长）
    var writeFails = 0;      // 持久化失败次数（隐私模式/配额满：降级为纯内存）

    try {
      var raw = store && store.getItem(cfg.key);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.e)) {
          buf = parsed.e.slice(-cfg.cap);
          seq = Number(parsed.s) || buf.length;
          dropped = Number(parsed.d) || 0;
        }
      }
    } catch (e) { /* 存档坏了就从空开始，不影响游戏 */ }

    function persist() {
      if (!store) return;
      try { store.setItem(cfg.key, JSON.stringify({ e: buf, s: seq, d: dropped })); }
      catch (e) { writeFails++; }
    }

    function log(evt, data) {
      var row = { n: seq++, ts: now(), e: String(evt) };
      if (data) {
        var kv = [];
        for (var k in data) {
          if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
          if (data[k] === undefined) continue;
          kv.push(k + '=' + fmtValue(data[k], cfg.valueCap));
        }
        if (kv.length) row.d = kv.join(' ');
      }
      buf.push(row);
      while (buf.length > cfg.cap) { buf.shift(); dropped++; }
      persist();
      return row;
    }

    function list() { return buf.slice(); }

    /* 人可读文本：第一列是「距上一条多少毫秒」——定位「弹窗刚出现就被关掉」这类
       时序问题时，间隔比绝对时间有用得多。 */
    function text(limit) {
      var rows = typeof limit === 'number' ? buf.slice(-limit) : buf;
      if (!rows.length) return '(no events)';
      var out = [];
      var head = 'trace ' + cfg.key + ' events=' + rows.length + '/' + buf.length
        + (dropped ? ' dropped=' + dropped : '') + (writeFails ? ' writeFails=' + writeFails : '');
      out.push(head);
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var gap = i === 0 ? 0 : (r.ts - rows[i - 1].ts);
        var d = new Date(r.ts);
        var hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
          + ':' + String(d.getSeconds()).padStart(2, '0');
        out.push('#' + r.n + ' ' + hh + ' +' + gap + 'ms ' + r.e + (r.d ? ' ' + r.d : ''));
      }
      return out.join('\n');
    }

    function clear() {
      buf = []; dropped = 0;
      try { if (store) store.removeItem(cfg.key); } catch (e) { writeFails++; }
    }

    function stats() { return { count: buf.length, dropped: dropped, writeFails: writeFails, cap: cfg.cap }; }

    /* 找最近一条某事件（页面里判「这次 dismiss 距离 open 多久」用） */
    function last(evt) {
      for (var i = buf.length - 1; i >= 0; i--) if (buf[i].e === evt) return buf[i];
      return null;
    }

    return { log: log, list: list, text: text, clear: clear, stats: stats, last: last, key: cfg.key };
  }

  return { create: create };
});
