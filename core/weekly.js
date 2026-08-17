/* 每周活动领取核心（core · issue #1）：解锁 ≠ 领取。
   状态机（每张主题图）：locked →(碎片达阈值) claimable →(用户点击领取) claimed；
   大奖同口径：frags>=GOAL 只进入 claimable，必须用户点击才发放。
   纪律：core 只做纯函数判定与领取转移（不可变：claim 返回新 state，不改入参）；
   碎片来源、奖励入账（体力/道具）、持久化全部由宿主负责；奖励随机 roll 由宿主注入。
   周图配置：assets/weekly/weekly-config.json 按 ISO 周 key（UTC）平铺，
   resolveWeek 命中返回当周条目（theme/title/titleEn/banner），未命中返回 null，
   宿主回退内置主题轮换。浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeeklyCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var THRESHOLDS = [100, 200, 300, 400, 500, 600];  // 6 张主题图解锁阈值
  var GOAL = 600;                                    // 大奖阈值
  var GRAND = { energy: 60, hints: 5 };              // 大奖内容（固定，不 roll）
  var STATUS = ['locked', 'claimable', 'claimed'];

  function fail(msg) { throw new Error('weekly-core: ' + msg); }

  function assertState(st) {
    if (!st || typeof st !== 'object') fail('state 必须是对象');
    if (typeof st.frags !== 'number' || !isFinite(st.frags) || st.frags < 0) fail('state.frags 必须是 >=0 的数');
    if (!Array.isArray(st.claimed) || st.claimed.length !== THRESHOLDS.length) fail('state.claimed 必须是长度 6 的数组');
  }
  function assertIdx(i) {
    if (!Number.isInteger(i) || i < 0 || i >= THRESHOLDS.length) fail('图索引必须是 0..' + (THRESHOLDS.length - 1) + ' 的整数');
  }

  // 单图状态：'locked' | 'claimable' | 'claimed'
  function picStatus(st, i) {
    assertState(st); assertIdx(i);
    if (st.claimed[i]) return 'claimed';
    return st.frags >= THRESHOLDS[i] ? 'claimable' : 'locked';
  }

  // 当前可领取的图索引列表（升序）
  function claimable(st) {
    assertState(st);
    var out = [];
    for (var i = 0; i < THRESHOLDS.length; i++) if (picStatus(st, i) === 'claimable') out.push(i);
    return out;
  }

  // 待领取总数（含大奖），入口角标用
  function claimableCount(st) {
    return claimable(st).length + (grandStatus(st) === 'claimable' ? 1 : 0);
  }

  // 领取第 i 张图：仅 claimable 可领；rollFn 由宿主注入，须返回 {type:'energy'|'hints', n>0}。
  // 不可变：返回 { state: 新状态, reward }；已领/未解锁一律抛错（宿主 UI 不应给出该入口）。
  function claim(st, i, rollFn) {
    var s = picStatus(st, i);
    if (s === 'claimed') fail('图 ' + (i + 1) + ' 已领取，不能重复领');
    if (s === 'locked') fail('图 ' + (i + 1) + ' 未解锁（碎片 ' + st.frags + '/' + THRESHOLDS[i] + '），不能领取');
    if (typeof rollFn !== 'function') fail('claim 需要注入 rollFn');
    var reward = rollFn();
    if (!reward || (reward.type !== 'energy' && reward.type !== 'hints') ||
        !Number.isInteger(reward.n) || reward.n <= 0) fail('rollFn 必须返回 {type:"energy"|"hints", n:>0 整数}');
    var next = Object.assign({}, st, { claimed: st.claimed.slice() });
    next.claimed[i] = true;
    next['r' + i] = reward;  // 记录已领奖励，活动页展示用（与既有存档字段兼容）
    return { state: next, reward: reward };
  }

  // 大奖状态：'locked' | 'claimable' | 'claimed'
  function grandStatus(st) {
    assertState(st);
    if (st.grand) return 'claimed';
    return st.frags >= GOAL ? 'claimable' : 'locked';
  }

  // 领取大奖：固定 GRAND，同样只有 claimable 可领
  function claimGrand(st) {
    var s = grandStatus(st);
    if (s === 'claimed') fail('大奖已领取，不能重复领');
    if (s === 'locked') fail('大奖未解锁（碎片 ' + st.frags + '/' + GOAL + '），不能领取');
    var next = Object.assign({}, st, { claimed: st.claimed.slice(), grand: true });
    return { state: next, reward: { energy: GRAND.energy, hints: GRAND.hints } };
  }

  // ISO 周 key（UTC），与 assets/weekly/weekly-config.json 的键一致：如 2026-W34。
  // 口径：所在周的周四决定 ISO 年（周一为一周之始，与 weekly.js 的 UTC 周一周界一致）。
  function isoWeekKey(now) {
    if (typeof now !== 'number' || !isFinite(now)) fail('now 必须是毫秒时间戳');
    var d = new Date(now);
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    var y = t.getUTCFullYear();
    var wk = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
    return y + '-W' + (wk < 10 ? '0' + wk : wk);
  }

  // 取当周配置条目：命中返回 {theme,title,titleEn,banner,...}，未命中/结构非法返回 null（宿主回退轮换主题）
  function resolveWeek(config, now) {
    if (!config || typeof config !== 'object') return null;
    var e = config[isoWeekKey(now)];
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    return e;
  }

  return {
    THRESHOLDS: THRESHOLDS, GOAL: GOAL, GRAND: GRAND, STATUS: STATUS,
    picStatus: picStatus, claimable: claimable, claimableCount: claimableCount,
    claim: claim, grandStatus: grandStatus, claimGrand: claimGrand,
    isoWeekKey: isoWeekKey, resolveWeek: resolveWeek,
  };
});
