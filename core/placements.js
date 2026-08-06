/* 广告位泛化 core：placement 声明式 + 各位独立频控（issue #1 · S29/S30）
   纪律：placement 全部 config 声明（format/onFail/capping），ads core 只有
   一条通用「播放 + 成功/失败回调」链，各 placement 无专属代码；频控是
   placement 的属性（minIntervalSec/maxPerSession/maxPerDay/startAfterLevel，
   复用 S9 的频控语义），不是代码分支；Provider 按宿主注入、与 placement
   表解耦；J/K 组按 id 引用（引用不存在 id、rewarded 缺 onFail、矛盾
   capping 一律加载期抛错）。浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlacementsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var FORMATS = ['interstitial', 'rewarded'];
  var ON_FAIL = ['grant', 'retry', 'deny'];
  var P_KEYS = ['format', 'onFail', 'capping'];
  var CAP_KEYS = ['minIntervalSec', 'maxPerSession', 'maxPerDay', 'startAfterLevel'];

  function fail(msg) { throw new Error('placements config: ' + msg); }

  function validateCapping(c, at) {
    if (c == null) return {};
    if (typeof c !== 'object' || Array.isArray(c)) fail('"' + at + '" capping 必须是对象');
    for (var k in c) {
      if (CAP_KEYS.indexOf(k) === -1) fail('"' + at + '" capping 未知键 "' + k + '"（合法键：' + CAP_KEYS.join('、') + '）');
      if (typeof c[k] !== 'number' || !isFinite(c[k]) || c[k] < 0) fail('"' + at + '" capping.' + k + ' 必须是 >=0 的数');
    }
    if (c.maxPerDay != null && c.maxPerSession != null && c.maxPerDay < c.maxPerSession) fail('"' + at + '" maxPerDay < maxPerSession 矛盾声明');
    return c;
  }

  // cfg: { '<placementId>': { format, onFail?, capping? } }；provider: function(id) -> boolean（成功/失败）
  function create(cfg, provider) {
    if (cfg == null) cfg = {};
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('placements 必须是对象');
    if (typeof provider !== 'function') fail('需要 provider（按宿主注入，与 placement 表解耦）');
    var table = new Map();
    Object.keys(cfg).forEach(function (id) {
      var p = cfg[id];
      if (typeof p !== 'object' || p === null || Array.isArray(p)) fail('"' + id + '" 必须是对象');
      for (var k in p) if (P_KEYS.indexOf(k) === -1) fail('"' + id + '" 未知键 "' + k + '"（合法键：' + P_KEYS.join('、') + '）');
      if (FORMATS.indexOf(p.format) === -1) fail('"' + id + '" 未知 format "' + p.format + '"（合法：' + FORMATS.join('、') + '）');
      if (p.format === 'rewarded') {
        if (ON_FAIL.indexOf(p.onFail) === -1) fail('"' + id + '" rewarded 缺 onFail（合法：' + ON_FAIL.join('、') + '）');
      } else if (p.onFail !== undefined) {
        fail('"' + id + '" interstitial 不接受 onFail');
      }
      table.set(id, { format: p.format, onFail: p.onFail, capping: validateCapping(p.capping, id) });
    });

    function mustGet(id) {
      var p = table.get(id);
      if (!p) throw new Error('placements: 引用不存在 placement "' + id + '"');
      return p;
    }

    // state（由调用方持久化，key 带 tgid+gameId+placementId 命名空间）：
    // { level, sessionN, day, dayN, lastAt }
    function canShow(id, state, now) {
      var p = mustGet(id);
      var c = p.capping;
      state = state || {};
      if (typeof now !== 'number' || !isFinite(now) || now < 0) throw new Error('placements: 需要 now 时间戳');
      if (c.startAfterLevel != null && (state.level || 0) < c.startAfterLevel) return false;
      if (c.maxPerSession != null && (state.sessionN || 0) >= c.maxPerSession) return false;
      if (c.maxPerDay != null && state.day === Math.floor(now / DAY) && (state.dayN || 0) >= c.maxPerDay) return false;
      if (c.minIntervalSec != null && state.lastAt != null && now - state.lastAt < c.minIntervalSec * 1000) return false;
      return true;
    }

    return {
      ids: function () { return Array.from(table.keys()); },
      has: function (id) { return table.has(id); },
      assertId: mustGet,
      canShow: canShow, // 供 UI 显隐：不可播 = 入口隐藏
      // 通用播放链：过闸 → provider → 计数 → 按 onFail 决定 rewarded 结果
      show: function (id, state, now) {
        var p = mustGet(id);
        state = state || {};
        if (!canShow(id, state, now)) return { shown: false, granted: false, state: state };
        var ok = !!provider(id);
        var day = Math.floor(now / DAY);
        var next = {
          level: state.level || 0,
          sessionN: (state.sessionN || 0) + 1,
          day: day,
          dayN: (state.day === day ? (state.dayN || 0) : 0) + 1,
          lastAt: now
        };
        if (p.format === 'interstitial') return { shown: true, granted: false, state: next };
        return { shown: true, granted: ok || p.onFail === 'grant', retry: !ok && p.onFail === 'retry', state: next };
      }
    };
  }

  return { create: create, FORMATS: FORMATS, ON_FAIL: ON_FAIL };
});
