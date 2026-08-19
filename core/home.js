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
      '<span class="avatar" id="idAvatar">玩' +
      '<i class="idbadge" id="idBadge" aria-hidden="true"></i>' +
      '</span>' +
      '<span class="profileinfo">' +
      '<span class="idnameline">' +
      '<span class="profilename" id="idName">玩家</span>' +
      '<i class="idsource" id="idSource"></i>' +
      '</span>' +
      '<span class="idsub" id="idSub"></span>' +
      '</span>' +
      '<span class="profilesource" id="idAction"></span>' +
      '</button>';
  }

  function soundToggle(props) {
    var label = props.label !== undefined ? esc(String(props.label)) : '音效';
    return '<div class="langrow">' +
      '<label for="sfxToggle" id="sfxLabel">' + label + '</label>' +
      '<button id="sfxToggle" class="sfxbtn" aria-pressed="true">开</button>' +
      '</div>';
  }

  function langSelect(props) {
    var label = props.label !== undefined ? esc(String(props.label)) : '语言';
    return '<div class="langrow">' +
      '<label for="langSel" id="langLabel">' + label + '</label>' +
      '<select id="langSel" aria-label="' + label + '"></select>' +
      '</div>';
  }

  function hintline(props) {
    if (!Array.isArray(props.lines) || props.lines.length === 0) fail('hintline.props.lines 必须是非空数组');
    return '<div class="hintline">' + props.lines.map(function (l) { return esc(String(l)); }).join('<br>') + '</div>';
  }

  /* ---------- 注册表：通用模块 + 游戏扩展合并（重名 fail-fast） ---------- */
  var COMMON = {
    'logo': logo,
    'energy': energy,
    'start-button': startButton,
    'homestats': homestats,
    'identity-row': identityRow,
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
