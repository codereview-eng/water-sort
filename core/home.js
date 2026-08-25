/* UI 骨架 core：共享首页模块层（issue #1 · 首页统一）
   纪律：与 shell.js 同一 CDUI 定形——本文件只提供「通用首页组件」的
   注册表与纯字符串渲染（Node 可测，浏览器可 innerHTML 装配）；
   哪些模块、什么顺序由各游戏 game.config.json 的 screens.home 声明，
   游戏特有模块（如 water 的每周活动/排行榜）经 registry(ext) 合并注册。
   动态数值（体力/进度/统计）不在渲染层求值：渲染产出带稳定 id 的骨架，
   运行时由游戏侧按 id 回填——保持模块可静态测试、无隐藏数据依赖。
   浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fail(msg) { throw new Error('home module: ' + msg); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function reqStr(props, key, type) {
    if (typeof props[key] !== 'string' || !props[key]) fail(type + '.props.' + key + ' 必须是非空字符串');
    return props[key];
  }

  /* ---------- 通用模块：markup 与 water.html 首页现状逐字对齐（含 id/class），迁移零 CSS 改动 ---------- */

  function logo(props) {
    var text = reqStr(props, 'text', 'logo');
    var em = reqStr(props, 'em', 'logo');
    var icon = props.icon !== undefined ? esc(String(props.icon)) + ' ' : '';
    return '<div class="logo">' + icon + esc(text) + '<em>' + esc(em) + '</em></div>';
  }

  function energy(props) {
    var icon = props.icon !== undefined ? esc(String(props.icon)) : '⚡';
    return '<div class="energy">' +
      '<span class="icon">' + icon + '</span>' +
      '<div class="info">' +
      '<div class="val"><span class="mono" id="enVal">0</span><span class="max mono"> / 0</span></div>' +
      '<div class="sub" id="enSub"></div>' +
      '<div class="bar"><i id="enBar" style="width:100%"></i></div>' +
      '</div></div>';
  }

  /* 金币牌：与体力条并排的一张小卡（体力不再独占整行）。
     id 可配（彩雷 homeCoins / 倒水 stCoins），文案与图标也可配，数值由游戏侧回填。 */
  function coins(props) {
    props = props || {};
    var id = props.id !== undefined ? String(props.id) : 'homeCoins';
    if (!id) fail('coins.props.id 不能是空字符串');
    var icon = props.icon !== undefined ? esc(String(props.icon)) : '🪙';
    var label = props.label !== undefined ? esc(String(props.label)) : 'Coins';
    var initial = props.initial !== undefined ? esc(String(props.initial)) : '0';
    return '<div class="coinbox">' +
      '<span class="icon">' + icon + '</span>' +
      '<div class="info">' +
      '<b class="mono" id="' + esc(id) + '">' + initial + '</b>' +
      '<span>' + label + '</span>' +
      '</div></div>';
  }

  /* 通用并排行：把若干模块放进同一行，按 flex 比重分配宽度。
     解决「体力条独占一整行、旁边大片空白」的问题，也让金币这类小数值有地方放。
     props.items = [{ type, props?, flex? }, ...] —— 递归复用同一套模块渲染。 */
  function row(props, ctx, reg) {
    if (!Array.isArray(props.items) || props.items.length === 0) fail('row.props.items 必须是非空数组');
    var renderOne = function (it) {
      var fn = reg && reg.get ? reg.get(it.type) : null;
      if (typeof fn !== 'function') fail('row.items 里的 "' + it.type + '" 不是已注册模块');
      return fn(it.props || {}, ctx, reg);
    };
    var cells = props.items.map(function (it, i) {
      if (typeof it !== 'object' || it === null) fail('row.items[' + i + '] 必须是对象');
      if (typeof it.type !== 'string' || !it.type) fail('row.items[' + i + '].type 必须是非空字符串');
      if (it.type === 'row') fail('row 不能再嵌套 row');
      if (it.flex !== undefined && (typeof it.flex !== 'number' || !isFinite(it.flex) || it.flex <= 0)) {
        fail('row.items[' + i + '].flex 必须是 >0 的数字');
      }
      var flex = it.flex === undefined ? 1 : it.flex;
      return '<div class="rowcell" style="flex:' + flex + '">' + renderOne(it) + '</div>';
    });
    return '<div class="hrow">' + cells.join('') + '</div>';
  }

  function startButton(props) {
    var label = reqStr(props, 'label', 'start-button');
    var small = props.small !== undefined ? '<small>' + esc(String(props.small)) + '</small>' : '';
    return '<button class="bigbtn" id="btnStart">' + esc(label) +
      ' <span class="mono" id="startLv">1</span>' + small + '</button>';
  }

  function homestats(props) {
    if (!Array.isArray(props.items) || props.items.length === 0) fail('homestats.props.items 必须是非空数组');
    var cells = props.items.map(function (it) {
      if (typeof it !== 'object' || it === null) fail('homestats.items 每项必须是对象');
      if (typeof it.id !== 'string' || !it.id) fail('homestats.items[].id 必须是非空字符串');
      if (typeof it.label !== 'string' || !it.label) fail('homestats.items[].label 必须是非空字符串');
      /* action 格：不显示数值，整格是一个可点按钮（如「道具」→ 打开背包窗口）。
         数量藏进弹窗的理由：首页只放一个入口图标，数量与说明在窗口里看得更清楚。 */
      if (it.action) {
        if (typeof it.icon !== 'string' || !it.icon) fail('homestats.items[].icon 在 action 格上必须是非空字符串');
        return '<button class="st stbtn" type="button" id="' + esc(it.id) + '">' +
          '<b class="sticon" aria-hidden="true">' + esc(it.icon) + '</b>' +
          '<span>' + esc(it.label) + '</span>' +
          '</button>';
      }
      var initial = it.initial !== undefined ? esc(String(it.initial)) : '0';
      return '<div class="st"><b class="mono" id="' + esc(it.id) + '">' + initial + '</b><span>' + esc(it.label) + '</span></div>';
    });
    return '<div class="homestats">' + cells.join('') + '</div>';
  }

  /* 单栏身份行（core/identity.js 配套，替代原来的 profile-row + account-row 两行）：
     一行之内三个槽位各有唯一职责——名字（+来源标签）、名字下面那句「进度存哪」、右侧动作。
     两栏合一的原因见 core/identity.js 头注：原来同一个人显示两个名字、两个动作。
     文案与状态运行时由游戏侧按 id 回填（idName/idSource/idSub/idAction），本层只出骨架。 */
  function identityRow() {
    return '<button class="profilerow idrow" id="btnIdentity">' +
      '<span class="avatar" id="idAvatar">P' +
      '<i class="idbadge" id="idBadge" aria-hidden="true"></i>' +
      '</span>' +
      '<span class="profileinfo">' +
      '<span class="idnameline">' +
      '<span class="profilename" id="idName">Player</span>' +
      '<i class="idsource" id="idSource"></i>' +
      '</span>' +
      '<span class="idsub" id="idSub"></span>' +
      '</span>' +
      '<span class="profilesource" id="idAction"></span>' +
      '</button>';
  }

  function soundToggle(props) {
    var label = props.label !== undefined ? esc(String(props.label)) : 'Sound';
    return '<div class="langrow">' +
      '<label for="sfxToggle" id="sfxLabel">' + label + '</label>' +
      '<button id="sfxToggle" class="sfxbtn" aria-pressed="true">On</button>' +
      '</div>';
  }

  function langSelect(props) {
    var label = props.label !== undefined ? esc(String(props.label)) : 'Language';
    return '<div class="langrow">' +
      '<label for="langSel" id="langLabel">' + label + '</label>' +
      '<select id="langSel" aria-label="' + label + '"></select>' +
      '</div>';
  }

  function hintline(props) {
    if (!Array.isArray(props.lines) || props.lines.length === 0) fail('hintline.props.lines 必须是非空数组');
    return '<div class="hintline">' + props.lines.map(function (l) { return esc(String(l)); }).join('<br>') + '</div>';
  }
  /* 每周活动入口（原在 water-home.js，2026-08-21 提到 core 供所有游戏共用）：
     角标 + 主题名 + 碎片数，都是稳定回填 id；文案由宿主按自己的语言灌，不写死在骨架里。 */
  function weeklyEventEntry(props) {
    var icon = props && typeof props.icon === 'string' && props.icon ? props.icon : '✦';
    return '<button class="eventbtn" id="btnWeekly" type="button">' +
      '<span class="badge" id="wkBadge" hidden></span>' +
      '<span class="left">' +
      '<span class="ic" id="wkIcHome">' + esc(icon) + '</span>' +
      '<span class="t"><b id="wkEntryTitle"></b><span id="wkEntrySub"></span></span>' +
      '</span>' +
      '<span class="frag mono" id="wkEntryFrag"></span>' +
      '</button>';
  }


  /* 连胜卡（core/winstreak.js 配套，2026-08-24 双连胜需求）：
     A 大连胜数字 + B 每 N 盘奖励票进度 + 领取按钮。
     文案/数值全部运行时由宿主按 id 回填（wsCur/wsCurLabel/wsCycLabel/wsCycTxt/
     wsCycBar/wsClaim），骨架不带语言字面量（英文运行时扫中文的门禁友好）；
     领取按钮初始 hidden，宿主在有未领取票时点亮。 */
  function streakCard(props) {
    var icon = props && props.icon !== undefined ? esc(String(props.icon)) : '🔥';
    return '<div class="streakcard" id="wsCard">' +
      '<span class="ic">' + icon + '</span>' +
      '<div class="info">' +
      '<div class="val"><b class="mono" id="wsCur">0</b> <span id="wsCurLabel"></span></div>' +
      '<div class="sub"><span id="wsCycLabel"></span><span class="mono" id="wsCycTxt"></span></div>' +
      '<div class="bar"><i id="wsCycBar" style="width:0%"></i></div>' +
      '</div>' +
      '<button class="wsclaim" id="wsClaim" type="button" hidden></button>' +
      '</div>';
  }

  /* ---------- 注册表：通用模块 + 游戏扩展合并（重名 fail-fast） ---------- */
  var COMMON = {
    'logo': logo,
    'energy': energy,
    'coins': coins,
    'row': row,
    'start-button': startButton,
    'homestats': homestats,
    'identity-row': identityRow,
    'streak-card': streakCard,
    'weekly-event-entry': weeklyEventEntry,
    'sound-toggle': soundToggle,
    'lang-select': langSelect,
    'hintline': hintline
  };

  function registry(extensions) {
    var map = new Map();
    Object.keys(COMMON).forEach(function (k) { map.set(k, COMMON[k]); });
    if (extensions !== undefined) {
      if (!(extensions instanceof Map)) fail('registry 扩展必须是 Map（type → 渲染函数）');
      extensions.forEach(function (fn, type) {
        if (typeof fn !== 'function') fail('扩展组件 "' + type + '" 必须是函数');
        if (map.has(type)) fail('扩展组件 "' + type + '" 与通用模块重名');
        map.set(type, fn);
      });
    }
    return map;
  }

  return { registry: registry, escapeHtml: esc };
});
