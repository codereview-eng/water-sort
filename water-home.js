/* water 专属首页模块（issue #1 · 首页统一）：每周活动入口 + 排行榜入口。
   经 HomeCore.registry(extensions()) 合并注册，由 games/water/game.config.json
   的 screens.home 声明装配；markup 的 id/class 与 water.html 首页现状对齐，
   迁移零 CSS 改动。动态文案（角标/主题名/碎片数）运行时由 renderHome 按 id 回填。
   浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaterHome = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 每周活动入口（issue #30）：角标 + 主题名 + 碎片数，均带稳定回填 id */
  function weeklyEventEntry() {
    return '<button class="eventbtn" id="btnWeekly">' +
      '<span class="badge" id="wkBadge">本周</span>' +
      '<span class="left">' +
      '<span class="ic" id="wkIcHome">✦</span>' +
      '<span class="t"><b id="wkEntryTitle">每周活动</b><span id="wkEntrySub"></span></span>' +
      '</span>' +
      '<span class="frag mono" id="wkEntryFrag"></span>' +
      '</button>';
  }

  /* 排行榜入口：props.boardId 是运行时打开哪个榜的声明，不参与骨架渲染 */
  function leaderboardEntry() {
    return '<button class="homebtn" id="btnLb"><span>🏆 排行榜</span><span>›</span></button>';
  }

  function extensions() {
    return new Map([
      ['weekly-event-entry', weeklyEventEntry],
      ['leaderboard-entry', leaderboardEntry]
    ]);
  }

  return { extensions: extensions };
});
