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

  /* 通用开关行（2026-08-28）：设置里除音效外还会有别的开/关项（彩雷首个是「剧情动画」）。
     不给每个开关各写一个组件——id 与文案由配置声明，运行时由游戏侧按 id 回填状态与 i18n 文案，
     和 sound-toggle 共用同一套样式，视觉上天然一致。 */
  function switchRow(props) {
    if (props.id === undefined || String(props.id) === '') fail('switch-row 必须声明 id（游戏侧按它绑定与回填）');
    var id = esc(String(props.id));
    var label = props.label !== undefined ? esc(String(props.label)) : id;
    /* 可选副说明：光一个名词说不清「关掉之后会少什么」，视觉评审把这一条列为最弱项。
       文案同样由游戏侧按 id + 'Hint' 回填 i18n，配置里只放英文安全 fallback。 */
    var hint = props.hint !== undefined ? String(props.hint) : '';
    return '<div class="langrow">' +
      '<span class="rowlb"><label for="' + id + '" id="' + id + 'Label">' + label + '</label>' +
      (hint ? '<small class="rowhint" id="' + id + 'Hint">' + esc(hint) + '</small>' : '') +
      '</span>' +
      '<button id="' + id + '" class="sfxbtn" aria-pressed="true">On</button>' +
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

  /* ================= 游戏化首页（2026-08-26）：HUD 条 / 主视觉 / 主 CTA / 并排入口 / 底部 Dock =================
     动因：原首页是一列等宽卡片 + 两行设置项，像设置页不像游戏。这组模块把「玩」放到视觉中心，
     设置类收进弹窗。全部仍是纯字符串渲染 + 稳定回填 id，老模块一个不删——没换 config 的游戏零影响。
     样式见本文件末尾的 styles()：跟着模块一起放在 core，别的游戏才可能「只改配置」。 */

  /* 颜色只收十六进制：这些值会进 style 属性，放行任意字符串等于开了个 CSS 注入口子 */
  var HEX = /^#[0-9a-fA-F]{3,8}$/;
  function reqHex(v, where) {
    if (typeof v !== 'string' || !HEX.test(v)) fail(where + ' 必须是 #RRGGBB 形式的颜色');
    return v;
  }
  function optStr(props, key) {
    if (props[key] === undefined) return '';
    if (typeof props[key] !== 'string') fail(key + ' 必须是字符串');
    return props[key];
  }

  /* 容器共用：把 items 交回注册表递归渲染（与 row 同一套安全边界：只能重排已注册模块） */
  function renderItems(props, ctx, reg, type, cls, cellCls) {
    if (!Array.isArray(props.items) || props.items.length === 0) fail(type + '.props.items 必须是非空数组');
    var cells = props.items.map(function (it, i) {
      if (typeof it !== 'object' || it === null || Array.isArray(it)) fail(type + '.items[' + i + '] 必须是对象');
      if (typeof it.type !== 'string' || !it.type) fail(type + '.items[' + i + '].type 必须是非空字符串');
      if (it.type === type) fail(type + ' 不能自嵌套');
      if (it.flex !== undefined && (typeof it.flex !== 'number' || !isFinite(it.flex) || it.flex <= 0)) {
        fail(type + '.items[' + i + '].flex 必须是 >0 的数字');
      }
      var fn = reg && reg.get ? reg.get(it.type) : null;
      if (typeof fn !== 'function') fail(type + '.items 里的 "' + it.type + '" 不是已注册模块');
      var flex = it.flex === undefined ? 1 : it.flex;
      return '<div class="' + cellCls + '" style="flex:' + flex + '">' + fn(it.props || {}, ctx, reg) + '</div>';
    });
    return '<div class="' + cls + '">' + cells.join('') + '</div>';
  }

  /* 顶部 HUD 条：头像 chip + 资源 chip 组。左侧第一项靠左、其余靠右，
     所以这里不按 flex 均分，而是把首项之后的塞进右侧组。 */
  function hudBar(props, ctx, reg) {
    if (!Array.isArray(props.items) || props.items.length === 0) fail('hud-bar.props.items 必须是非空数组');
    var out = props.items.map(function (it, i) {
      if (typeof it !== 'object' || it === null || Array.isArray(it)) fail('hud-bar.items[' + i + '] 必须是对象');
      if (typeof it.type !== 'string' || !it.type) fail('hud-bar.items[' + i + '].type 必须是非空字符串');
      if (it.type === 'hud-bar') fail('hud-bar 不能自嵌套');
      var fn = reg && reg.get ? reg.get(it.type) : null;
      if (typeof fn !== 'function') fail('hud-bar.items 里的 "' + it.type + '" 不是已注册模块');
      return fn(it.props || {}, ctx, reg);
    });
    return '<div class="hudbar">' + out[0] +
      '<div class="hudright">' + out.slice(1).join('') + '</div></div>';
  }

  /* 身份 chip（头像 + 名字）：沿用 identity-row 的回填 id，点开的还是同一个身份弹窗，
     所以 renderIdentity() 不用改——只是首页上的形态从整行变成了一枚 chip。 */
  function identityChip(props) {
    var initial = props.initial !== undefined ? esc(String(props.initial)) : 'P';
    return '<button class="hchip idchip" id="btnIdentity" type="button">' +
      '<span class="av" id="idAvatar">' + initial +
      '<i class="idbadge" id="idBadge" aria-hidden="true"></i>' +
      '</span>' +
      '<span class="nm"><span class="profilename" id="idName">Player</span>' +
      '<i class="idsource" id="idSource"></i></span>' +
      '<span class="idsub" id="idSub" hidden></span>' +
      '<span class="profilesource" id="idAction" hidden></span>' +
      '</button>';
  }

  /* 体力 chip：回填 id 与 energy 卡完全一致（enVal/enSub/enBar + .max），
     游戏侧 renderHome() 那几行取数逻辑一个字都不用动。 */
  function energyChip(props) {
    var icon = props.icon !== undefined ? esc(String(props.icon)) : '⚡';
    var action = optStr(props, 'action');
    return '<button class="hchip enchip" type="button"' +
      (action ? ' data-action="' + esc(action) + '"' : '') + '>' +
      '<span class="ic">' + icon + '</span>' +
      '<b class="mono" id="enVal">0</b><i class="max mono" id="enMax"> / 0</i>' +
      '<span class="sub" id="enSub" hidden></span>' +
      '<span class="mini"><u id="enBar" style="width:100%"></u></span>' +
      '</button>';
  }

  /* 金币 chip：同理沿用 coins 卡的回填 id；action 给「+」按钮用（开商店） */
  function coinsChip(props) {
    var id = props.id !== undefined ? String(props.id) : 'homeCoins';
    if (!id) fail('coins-chip.props.id 不能是空字符串');
    var icon = props.icon !== undefined ? esc(String(props.icon)) : '🪙';
    var initial = props.initial !== undefined ? esc(String(props.initial)) : '0';
    var action = optStr(props, 'action');
    return '<button class="hchip coinchip" type="button"' +
      (action ? ' data-action="' + esc(action) + '"' : '') + '>' +
      '<span class="ic">' + icon + '</span>' +
      '<b class="mono" id="' + esc(id) + '">' + initial + '</b>' +
      (action ? '<span class="plus" aria-hidden="true">+</span>' : '') +
      '</button>';
  }

  /* 通用图标按钮（HUD 右侧的齿轮之类）：id 由 config 给，行为由宿主按 data-action 绑定 */
  function iconButton(props) {
    var id = reqStr(props, 'id', 'icon-button');
    var icon = reqStr(props, 'icon', 'icon-button');
    var action = optStr(props, 'action');
    var label = optStr(props, 'label');
    return '<button class="hchip iconbtn" type="button" id="' + esc(id) + '"' +
      (action ? ' data-action="' + esc(action) + '"' : '') +
      (label ? ' aria-label="' + esc(label) + '"' : '') +
      '>' + esc(icon) + '</button>';
  }

  /* 主视觉卡：一屏之内回答「我在第几关」。大关卡号复用 startLv 之外的独立 id（heroLv），
     章节名/副标题/星级/进度全部是回填锚点，文案由宿主按语言灌。
     art:'tiles' 时铺一层斜面色块当插画——颜色来自 config，所以倒水换一套色就是另一副长相。 */
  function heroLevel(props) {
    var art = props.art === undefined ? 'tiles' : props.art;
    if (art !== 'tiles' && art !== 'plain') fail('hero-level.props.art 只能是 tiles 或 plain');
    var cols = props.artCols === undefined ? 6 : props.artCols;
    var rows = props.artRows === undefined ? 4 : props.artRows;
    if (typeof cols !== 'number' || cols < 1 || cols > 12) fail('hero-level.props.artCols 必须是 1..12');
    if (typeof rows !== 'number' || rows < 1 || rows > 12) fail('hero-level.props.artRows 必须是 1..12');
    var tiles = '';
    if (art === 'tiles') {
      var colors = props.artColors === undefined ? ['#e2574c', '#f0a63c', '#4fb7e8', '#6fc86f', '#b06fe0'] : props.artColors;
      if (!Array.isArray(colors) || colors.length === 0) fail('hero-level.props.artColors 必须是非空数组');
      colors.forEach(function (c, i) { reqHex(c, 'hero-level.props.artColors[' + i + ']'); });
      var cells = [];
      for (var i = 0; i < cols * rows; i++) {
        cells.push('<span style="background:' + colors[(i + Math.floor(i / cols)) % colors.length] + '"></span>');
      }
      tiles = '<div class="tiles" aria-hidden="true" style="grid-template-columns:repeat(' + cols + ',1fr)">'
        + cells.join('') + '</div><div class="scrim" aria-hidden="true"></div>';
    }
    var badge = optStr(props, 'badge');
    /* 进度行可关：关卡无限生成的游戏（彩雷）没有「x / 总数」这种真数据，
       与其编一个百分比，不如让 config 说「我没有」——底部只留一行文字锚点。 */
    var withProgress = props.progress === undefined ? true : props.progress;
    if (typeof withProgress !== 'boolean') fail('hero-level.props.progress 必须是布尔值');
    var bot = withProgress
      ? '<div class="pgbar"><u id="heroBar" style="width:0%"></u></div>' +
        '<div class="pgtxt"><span id="heroChapter"></span><span class="mono" id="heroProgress"></span></div>'
      : '<div class="pgtxt"><span id="heroChapter"></span><span class="mono" id="heroProgress"></span></div>';
    return '<div class="hero" id="homeHero">' +
      '<div class="glow" aria-hidden="true"></div>' + tiles +
      '<div class="htop">' +
      (badge ? '<span class="hbadge" id="heroBadge">' + esc(badge) + '</span>' : '<span></span>') +
      '<span class="hstars" id="heroStars"></span>' +
      '</div>' +
      '<div class="hmid">' +
      '<div class="kick" id="heroKicker">' + esc(optStr(props, 'kicker')) + '</div>' +
      '<div class="lv mono" id="heroLv">1</div>' +
      '<div class="desc" id="heroDesc">' + esc(optStr(props, 'desc')) + '</div>' +
      '</div>' +
      '<div class="hbot">' + bot + '</div></div>';
  }

  /* 主 CTA：与 start-button 同一套 id（btnStart / startLv），换的只是长相 */
  function playCta(props) {
    var label = reqStr(props, 'label', 'play-cta');
    var showLevel = props.showLevel === undefined ? true : props.showLevel;
    if (typeof showLevel !== 'boolean') fail('play-cta.props.showLevel 必须是布尔值');
    var small = props.small !== undefined ? '<small>' + esc(String(props.small)) + '</small>' : '';
    return '<button class="bigbtn ctabtn" id="btnStart" type="button">' +
      '<span class="shine" aria-hidden="true"></span>' +
      '<span class="ctalabel">' + esc(label) +
      (showLevel ? ' <span class="mono" id="startLv">1</span>' : '') + '</span>' +
      small + '</button>';
  }

  /* 双连胜卡（2026-08-26）：core/winstreak.js 本来就是两套东西——
     A 累计大连胜（cur，只增不封顶）、B 每 every 盘出一张奖励票的周期（cyc/every + 领取）。
     老的 streak-card 把 B 压成一行小字，用户实际反馈「只看到一个连胜」，
     所以这里拆成左右两块各自成立；回填 id 与 streak-card 逐字相同，宿主回填逻辑一行不用改。 */
  function streakDuo(props) {
    props = props || {};
    var icon = props.icon !== undefined ? esc(String(props.icon)) : '🔥';
    var ticketIcon = props.ticketIcon !== undefined ? esc(String(props.ticketIcon)) : '🎟';
    /* layout:'stack' = 上下两块（弹窗这种窄容器用）。左右并排时两个数字挨着，
       用户实测把「A 连胜 7」和「B 最近 10 盘 7/10」读成了同一个数，所以窄处一律竖排。 */
    var layout = props.layout === undefined ? 'row' : props.layout;
    if (layout !== 'row' && layout !== 'stack') fail('streak-duo.props.layout 只能是 row 或 stack');
    return '<div class="streakduo' + (layout === 'stack' ? ' stack' : '') + '" id="wsCard">' +
      '<div class="wsa">' +
      '<span class="ic" aria-hidden="true">' + icon + '</span>' +
      '<b class="mono" id="wsCur">0</b>' +
      '<span class="lb" id="wsCurLabel"></span>' +
      '<span class="hint" id="wsCurHint"></span>' +
      '</div>' +
      '<div class="wsb">' +
      '<div class="wstop">' +
      '<span class="lb"><span class="ic" aria-hidden="true">' + ticketIcon + '</span><span id="wsCycLabel"></span></span>' +
      '<b class="mono" id="wsCycTxt"></b>' +
      '</div>' +
      '<div class="bar"><i id="wsCycBar" style="width:0%"></i></div>' +
      '</div>' +
      '<button class="wsclaim" id="wsClaim" type="button" hidden></button>' +
      '</div>';
  }

  /* 并排入口：连胜卡 / 周活动入口等半宽并排，子模块原样复用（回填 id 不变） */
  function entryDuo(props, ctx, reg) {
    return renderItems(props, ctx, reg, 'entry-duo', 'hduo', 'duocell');
  }

  /* 侧边图标列（2026-08-26 owner 定案）：手游常见的「主视觉左右两条竖列小图标」。
     首页正中只留主视觉与开始按钮，功能入口（道具/玩法/设置/连胜/活动）一律收成图标，
     点击都弹窗——底部导航条随之下线。
     每项：{ id, icon, action, label?, badgeId? }；badgeId 给宿主回填角标（红点/数字），
     初始 hidden，没有未读就不出现。 */
  function sideRail(props) {
    var side = props.side;
    if (side !== 'left' && side !== 'right') fail('side-rail.props.side 只能是 left 或 right');
    if (!Array.isArray(props.items) || props.items.length === 0) fail('side-rail.props.items 必须是非空数组');
    if (props.items.length > 5) fail('side-rail.props.items 最多五项（再多要遮住主视觉了）');
    var cells = props.items.map(function (it, i) {
      if (typeof it !== 'object' || it === null || Array.isArray(it)) fail('side-rail.items[' + i + '] 必须是对象');
      if (typeof it.id !== 'string' || !it.id) fail('side-rail.items[' + i + '].id 必须是非空字符串');
      if (typeof it.icon !== 'string' || !it.icon) fail('side-rail.items[' + i + '].icon 必须是非空字符串');
      if (typeof it.action !== 'string' || !it.action) fail('side-rail.items[' + i + '].action 必须是非空字符串');
      if (it.label !== undefined && typeof it.label !== 'string') fail('side-rail.items[' + i + '].label 必须是字符串');
      if (it.badgeId !== undefined && (typeof it.badgeId !== 'string' || !it.badgeId)) {
        fail('side-rail.items[' + i + '].badgeId 必须是非空字符串');
      }
      return '<button class="railbtn" type="button" id="' + esc(it.id) + '" data-action="' + esc(it.action) + '">' +
        '<span class="ic" aria-hidden="true">' + esc(it.icon) + '</span>' +
        (it.label ? '<span class="lb">' + esc(it.label) + '</span>' : '') +
        (it.badgeId ? '<span class="badge" id="' + esc(it.badgeId) + '" hidden></span>' : '') +
        '</button>';
    });
    return '<div class="siderail rail-' + side + '">' + cells.join('') + '</div>';
  }

  /* 底部 Dock：常驻导航，每格 data-action 由宿主绑到已有弹窗（背包/排行/设置） */
  function dock(props) {
    if (!Array.isArray(props.items) || props.items.length < 2) fail('dock.props.items 至少两项');
    if (props.items.length > 5) fail('dock.props.items 最多五项（再多手指点不准）');
    var cells = props.items.map(function (it, i) {
      if (typeof it !== 'object' || it === null || Array.isArray(it)) fail('dock.items[' + i + '] 必须是对象');
      if (typeof it.id !== 'string' || !it.id) fail('dock.items[' + i + '].id 必须是非空字符串');
      if (typeof it.icon !== 'string' || !it.icon) fail('dock.items[' + i + '].icon 必须是非空字符串');
      if (typeof it.label !== 'string' || !it.label) fail('dock.items[' + i + '].label 必须是非空字符串');
      if (typeof it.action !== 'string' || !it.action) fail('dock.items[' + i + '].action 必须是非空字符串');
      if (it.active !== undefined && typeof it.active !== 'boolean') fail('dock.items[' + i + '].active 必须是布尔值');
      return '<button class="dockbtn' + (it.active ? ' on' : '') + '" type="button" id="' + esc(it.id) +
        '" data-action="' + esc(it.action) + '">' +
        '<span class="ic" aria-hidden="true">' + esc(it.icon) + '</span>' +
        '<span class="lb">' + esc(it.label) + '</span></button>';
    });
    return '<nav class="dock">' + cells.join('') + '</nav>';
  }

  /* ---------- 样式也在 core：否则「其他游戏只改配置」做不到（各家 HTML 还得各抄一份 CSS） ----------
     返回一段纯 CSS 字符串，宿主启动时注入 <style id="homeCoreStyle">。
     只认这几个主题键，写错立刻抛错（配置漂移不该等到肉眼发现）。 */
  var THEME_KEYS = ['accent', 'accentInk', 'accentShadow', 'heroFrom', 'heroMid', 'heroTo'];
  var THEME_DEFAULT = {
    accent: '#ffb454', accentInk: '#20160a', accentShadow: '#b96c1c',
    heroFrom: '#33406b', heroMid: '#1d2740', heroTo: '#161d2c'
  };
  function styles(theme) {
    var t = {};
    THEME_KEYS.forEach(function (k) { t[k] = THEME_DEFAULT[k]; });
    if (theme !== undefined) {
      if (typeof theme !== 'object' || theme === null || Array.isArray(theme)) fail('styles(theme) 必须是对象');
      Object.keys(theme).forEach(function (k) {
        if (THEME_KEYS.indexOf(k) === -1) fail('未知主题键 "' + k + '"（合法键：' + THEME_KEYS.join('、') + '）');
        t[k] = reqHex(theme[k], 'theme.' + k);
      });
    }
    return [
      ':root{--hm-accent:' + t.accent + ';--hm-accent-ink:' + t.accentInk + ';--hm-accent-shadow:' + t.accentShadow +
        ';--hm-hero-1:' + t.heroFrom + ';--hm-hero-2:' + t.heroMid + ';--hm-hero-3:' + t.heroTo + ';}',
      /* 减去安全区：页面若开了 viewport-fit=cover，视口高度含刘海/手势条那两条，
         而 .home 外面的 .wrap 已经把它们做成 padding 让位了。这里不减就会多出
         「刘海高 + 手势条高」的溢出，首页凭空可滚一截。没开 cover 的页 env() 恒为 0，取值不变。 */
      '.home{display:flex;flex-direction:column;gap:12px;padding-top:4px;flex:1 1 auto;' +
        'min-height:calc(100vh - 34px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));}',
      '@supports (height:100dvh){.home{min-height:calc(100dvh - 34px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));}}',
      /* HUD 条 */
      '.hudbar{display:flex;align-items:center;gap:8px;}',
      '.hudright{margin-left:auto;display:flex;gap:8px;align-items:stretch;}',
      '.hchip{display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.06);border:1px solid var(--edge);' +
        'border-radius:999px;padding:5px 11px;font:inherit;font-size:12px;font-weight:800;color:var(--ink);' +
        'cursor:pointer;position:relative;white-space:nowrap;}',
      '.idchip .idsource{display:none;}',
      '.hchip .ic{font-size:13px;}',
      '.hchip b{font-size:13px;font-variant-numeric:tabular-nums;}',
      '.hchip i{font-style:normal;color:var(--ink-3);font-weight:600;font-size:11px;}',
      '.idchip{padding:4px 12px 4px 4px;}',
      '.idchip .av{width:26px;height:26px;border-radius:50%;background:var(--hm-accent);color:var(--hm-accent-ink);' +
        'display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;position:relative;flex:none;}',
      '.idchip .nm{display:flex;align-items:center;gap:5px;max-width:34vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}',
      '.enchip{padding-bottom:7px;}',
      '.enchip .mini{position:absolute;left:10px;right:10px;bottom:3px;height:2px;border-radius:2px;background:rgba(255,255,255,.14);}',
      '.enchip .mini u{display:block;height:100%;border-radius:2px;background:var(--hm-accent);text-decoration:none;}',
      '.coinchip .plus{width:16px;height:16px;border-radius:50%;background:var(--hm-accent);color:var(--hm-accent-ink);' +
        'font-size:12px;font-weight:900;display:flex;align-items:center;justify-content:center;}',
      '.iconbtn{font-size:15px;padding:6px 10px;}',
      /* 主视觉 */
      '.hero{position:relative;flex:1 1 auto;min-height:300px;border-radius:22px;overflow:hidden;' +
        'border:1px solid rgba(255,255,255,.12);padding:16px;display:flex;flex-direction:column;justify-content:space-between;' +
        'background:linear-gradient(165deg,var(--hm-hero-1) 0%,var(--hm-hero-2) 55%,var(--hm-hero-3) 100%);' +
        'box-shadow:0 18px 40px -18px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.14);}',
      '.hero .glow{position:absolute;width:260px;height:260px;border-radius:50%;left:50%;top:34%;transform:translate(-50%,-50%);' +
        'background:radial-gradient(circle,rgba(255,255,255,.16) 0%,rgba(255,255,255,0) 68%);}',
      '.hero .tiles{position:absolute;inset:auto -6% -12% -6%;height:34%;display:grid;gap:6px;' +
        'transform:perspective(520px) rotateX(46deg);opacity:.78;}',
      '.hero .tiles span{border-radius:7px;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),inset 0 -3px 0 rgba(0,0,0,.22);}',
      '.hero .scrim{position:absolute;left:0;right:0;bottom:0;height:30%;' +
        'background:linear-gradient(180deg,rgba(19,25,38,0),rgba(19,25,38,.78) 70%);}',
      '.hero .htop{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;}',
      '.hero .hbadge{background:rgba(0,0,0,.34);border:1px solid rgba(255,255,255,.16);border-radius:999px;' +
        'padding:4px 10px;font-size:11px;font-weight:800;letter-spacing:.08em;color:var(--hm-accent);}',
      '.hero .hstars{font-size:12px;letter-spacing:2px;color:var(--hm-accent);}',
      '.hero .hmid{position:relative;z-index:2;text-align:center;margin:auto 0;}',
      '.hero .kick{font-size:12px;letter-spacing:.3em;color:var(--ink-2);font-weight:700;}',
      '.hero .lv{font-size:72px;font-weight:900;line-height:1.05;color:var(--hm-accent);' +
        'text-shadow:0 6px 18px rgba(0,0,0,.45);}',
      '.hero .desc{margin-top:4px;font-size:12px;color:var(--ink-2);}',
      '.hero .hbot{position:relative;z-index:2;}',
      '.hero .pgbar{height:7px;border-radius:6px;background:rgba(0,0,0,.36);overflow:hidden;border:1px solid rgba(255,255,255,.08);}',
      '.hero .pgbar u{display:block;height:100%;border-radius:6px;background:var(--hm-accent);text-decoration:none;transition:width .3s;}',
      '.hero .pgtxt{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--ink-2);margin-top:6px;font-weight:600;}',
      /* 主 CTA */
      '.ctabtn{position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;gap:2px;' +
        'background:var(--hm-accent);color:var(--hm-accent-ink);border-radius:18px;padding:15px 16px;font-size:19px;font-weight:900;' +
        'box-shadow:0 9px 0 -2px var(--hm-accent-shadow),0 18px 30px -14px rgba(0,0,0,.6);}',
      '.ctabtn:active{transform:translateY(3px);box-shadow:0 5px 0 -2px var(--hm-accent-shadow);}',
      '.ctabtn .shine{position:absolute;inset:2px 2px auto 2px;height:42%;border-radius:16px 16px 40px 40px;' +
        'background:linear-gradient(180deg,rgba(255,255,255,.4),rgba(255,255,255,0));pointer-events:none;}',
      '.ctabtn .ctalabel{position:relative;}',
      '.ctabtn small{position:relative;display:block;font-weight:700;font-size:11px;opacity:.75;}',
      /* 并排入口 */
      '.hduo{display:flex;gap:10px;align-items:stretch;}',
      '.hduo .duocell{min-width:0;}',
      '.hduo .duocell > *{height:100%;box-sizing:border-box;}',
      '.hduo .streakcard,.hduo .eventbtn{flex-direction:column;align-items:flex-start;gap:6px;}',
      /* 双连胜卡：左 A 大连胜、右 B 奖励票周期，中间一道分隔线——两件事各自看得见 */
      '.streakduo{display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--edge);' +
        'border-radius:14px;padding:11px 13px;}',
      '.streakduo .wsa{display:flex;align-items:center;gap:6px;padding-right:12px;border-right:1px solid var(--edge);flex:none;}',
      '.streakduo .wsa .ic{font-size:20px;}',
      '.streakduo .wsa b{font-size:24px;font-weight:900;color:var(--hm-accent);font-variant-numeric:tabular-nums;}',
      '.streakduo .wsa .lb{font-size:11px;color:var(--ink-3);}',
      '.streakduo .wsb{flex:1;min-width:0;}',
      '.streakduo .wstop{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:5px;}',
      '.streakduo .wstop .lb{font-size:11px;color:var(--ink-2);display:flex;align-items:center;gap:4px;min-width:0;}',
      '.streakduo .wstop .ic{font-size:13px;}',
      '.streakduo .wstop b{font-size:13px;font-weight:900;color:var(--ink);font-variant-numeric:tabular-nums;}',
      '.streakduo .bar{height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;}',
      '.streakduo .bar i{display:block;height:100%;border-radius:4px;background:var(--ok);transition:width .3s;}',
      '.streakduo .wsclaim{flex:none;background:var(--hm-accent);color:var(--hm-accent-ink);border:0;border-radius:9px;' +
        'padding:9px 11px;font:inherit;font-size:12px;font-weight:900;white-space:nowrap;cursor:pointer;}',
      /* 侧边图标列：浮在主视觉左右两侧，首页正中只留「我在第几关」和「开始」 */
      '.home{position:relative;}',
      '.siderail{position:absolute;top:104px;display:flex;flex-direction:column;gap:9px;z-index:3;}',
      '.rail-left{left:0;}',
      '.rail-right{right:0;}',
      '.railbtn{position:relative;width:56px;padding:7px 2px 6px;border:1px solid var(--edge);border-radius:16px;' +
        'background:rgba(14,20,32,.62);color:var(--ink);font:inherit;cursor:pointer;' +
        'display:flex;flex-direction:column;align-items:center;gap:2px;backdrop-filter:blur(6px);' +
        '-webkit-backdrop-filter:blur(6px);box-shadow:0 6px 16px -8px rgba(0,0,0,.9);}',
      '.railbtn:active{transform:translateY(1px);}',
      '.railbtn .ic{font-size:22px;line-height:1.15;}',
      '.railbtn .lb{font-size:10px;font-weight:700;color:var(--ink-2);white-space:nowrap;}',
      '.railbtn .badge{position:absolute;top:-5px;right:-4px;min-width:19px;height:19px;border-radius:10px;' +
        'background:#e5484d;color:#fff;font-size:10px;font-weight:900;padding:0 5px;' +
        'display:flex;align-items:center;justify-content:center;border:2px solid var(--bg,#141a24);}',
      '.railbtn .badge[hidden]{display:none;}',
      '.railbtn .badge.gold{background:var(--hm-accent);color:var(--hm-accent-ink);}',
      '.streakduo .wsa .hint{display:none;}',
      '.streakduo.stack{flex-direction:column;align-items:stretch;gap:11px;}',
      '.streakduo.stack .wsa{border-right:0;border-bottom:1px solid var(--edge);padding:0 0 10px;' +
        'display:grid;grid-template-columns:auto auto 1fr;grid-template-rows:auto auto;' +
        'column-gap:7px;row-gap:2px;align-items:baseline;text-align:left;}',
      '.streakduo.stack .wsa .ic{grid-row:1;}',
      '.streakduo.stack .wsa b{grid-row:1;font-size:28px;}',
      '.streakduo.stack .wsa .lb{grid-row:1;}',
      '.streakduo.stack .wsa .hint{display:block;grid-column:1 / -1;grid-row:2;' +
        'font-size:10.5px;line-height:1.5;color:var(--ink-3);}',
      /* Dock */
      '.dock{display:flex;gap:6px;background:rgba(255,255,255,.05);border:1px solid var(--edge);border-radius:18px;padding:7px;}',
      '.dockbtn{flex:1;background:transparent;border:0;color:var(--ink-2);font:inherit;font-size:10px;font-weight:700;' +
        'display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;border-radius:13px;cursor:pointer;}',
      '.dockbtn .ic{font-size:19px;line-height:1.1;}',
      '.dockbtn.on{background:rgba(255,255,255,.10);color:var(--hm-accent);}'
    ].join('\n');
  }

  /* ---------- 注册表：通用模块 + 游戏扩展合并（重名 fail-fast） ---------- */
  var COMMON = {
    'logo': logo,
    'energy': energy,
    'coins': coins,
    'row': row,
    'hud-bar': hudBar,
    'identity-chip': identityChip,
    'energy-chip': energyChip,
    'coins-chip': coinsChip,
    'icon-button': iconButton,
    'hero-level': heroLevel,
    'streak-duo': streakDuo,
    'play-cta': playCta,
    'entry-duo': entryDuo,
    'dock': dock,
    'side-rail': sideRail,
    'start-button': startButton,
    'homestats': homestats,
    'identity-row': identityRow,
    'streak-card': streakCard,
    'weekly-event-entry': weeklyEventEntry,
    'sound-toggle': soundToggle,
    'lang-select': langSelect,
    'switch-row': switchRow,
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

  return { registry: registry, escapeHtml: esc, styles: styles };
});
