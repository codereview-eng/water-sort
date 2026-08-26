'use strict';
/* core/home.js 单测：通用首页模块渲染 + fail-fast + 与 ShellCore 装配 */
const test = require('node:test');
const assert = require('node:assert');
const Home = require('./home.js');
const Shell = require('./shell.js');

test('registry: 含全部通用模块', () => {
  const reg = Home.registry();
  for (const t of ['logo', 'energy', 'start-button', 'homestats', 'identity-row', 'sound-toggle', 'lang-select', 'hintline']) {
    assert.strictEqual(typeof reg.get(t), 'function', t + ' 缺失');
  }
  /* 两栏身份已合成一栏：旧的「玩家名称行 + run.ceo 账号行」必须彻底下线，
     留着任一个都可能被某个 config 重新声明出来，首页又冒出第二个名字 */
  for (const gone of ['profile-row', 'account-row']) {
    assert.strictEqual(reg.get(gone), undefined, gone + ' 应已被 identity-row 取代');
  }
});

test('registry: 扩展合并 + 重名/非函数 fail-fast', () => {
  const reg = Home.registry(new Map([['custom-entry-xyz', () => '<div></div>']]));
  assert.strictEqual(typeof reg.get('custom-entry-xyz'), 'function');
  // 与内置模块重名必须 fail-fast（weekly-event-entry 现已内置）
  assert.throws(() => Home.registry(new Map([['weekly-event-entry', () => '']])), /重名/);
  assert.strictEqual(typeof reg.get('logo'), 'function', '通用模块不能被扩展挤掉');
  assert.throws(() => Home.registry(new Map([['logo', () => '']])), /重名/);
  assert.throws(() => Home.registry(new Map([['x', 1]])), /必须是函数/);
  assert.throws(() => Home.registry({}), /必须是 Map/);
});

test('logo: 渲染与转义', () => {
  const html = Home.registry().get('logo')({ text: '倒水排序', em: 'WATER SORT' });
  assert.strictEqual(html, '<div class="logo">倒水排序<em>WATER SORT</em></div>');
  const withIcon = Home.registry().get('logo')({ icon: '💣', text: '彩色扫雷', em: 'COLOR MINES' });
  assert.ok(withIcon.startsWith('<div class="logo">💣 彩色扫雷'));
  assert.ok(Home.registry().get('logo')({ text: '<b>x</b>', em: 'E' }).includes('&lt;b&gt;'));
  assert.throws(() => Home.registry().get('logo')({ em: 'E' }), /logo\.props\.text/);
});

test('energy: 骨架带稳定回填 id（enVal/enSub/enBar）', () => {
  const html = Home.registry().get('energy')({});
  for (const id of ['id="enVal"', 'id="enSub"', 'id="enBar"']) assert.ok(html.includes(id), id);
});

test('start-button: btnStart/startLv id + 可选 small', () => {
  const html = Home.registry().get('start-button')({ label: '开始', small: '消耗 15 体力 · 10 分钟限时' });
  assert.ok(html.includes('id="btnStart"'));
  assert.ok(html.includes('id="startLv"'));
  assert.ok(html.includes('<small>消耗 15 体力 · 10 分钟限时</small>'));
  assert.ok(!Home.registry().get('start-button')({ label: '开始' }).includes('<small>'));
  assert.throws(() => Home.registry().get('start-button')({}), /start-button\.props\.label/);
});

test('homestats: items 声明渲染 + 形状 fail-fast', () => {
  const html = Home.registry().get('homestats')({ items: [
    { id: 'homeLv', label: '当前进度', initial: 1 },
    { id: 'homeClears', label: '累计通关' }
  ] });
  assert.ok(html.includes('id="homeLv"') && html.includes('>1</b>'));
  assert.ok(html.includes('id="homeClears"') && html.includes('当前进度'));
  assert.throws(() => Home.registry().get('homestats')({ items: [] }), /非空数组/);
  assert.throws(() => Home.registry().get('homestats')({ items: [{ label: 'x' }] }), /items\[\]\.id/);
  assert.throws(() => Home.registry().get('homestats')({ items: [{ id: 'a' }] }), /items\[\]\.label/);
});

test('identity-row / sound-toggle / lang-select: 回填锚点齐全', () => {
  const reg = Home.registry();
  const p = reg.get('identity-row')({});
  for (const id of ['btnIdentity', 'idAvatar', 'idBadge', 'idName', 'idSource', 'idSub', 'idAction']) {
    assert.ok(p.includes('id="' + id + '"'), id);
  }
  const s = reg.get('sound-toggle')({});
  assert.ok(s.includes('id="sfxToggle"') && s.includes('id="sfxLabel"') && s.includes('aria-pressed'));
  const l = reg.get('lang-select')({});
  assert.ok(l.includes('id="langSel"') && l.includes('id="langLabel"'));
});

test('hintline: 多行 <br> 拼接且逐行转义', () => {
  const html = Home.registry().get('hintline')({ lines: ['单击 = 标记', '雷与雷互不相邻'] });
  assert.strictEqual(html, '<div class="hintline">单击 = 标记<br>雷与雷互不相邻</div>');
  assert.ok(Home.registry().get('hintline')({ lines: ['a<b'] }).includes('a&lt;b'));
  assert.throws(() => Home.registry().get('hintline')({ lines: [] }), /非空数组/);
});

test('identity-row: 一行之内只有一个名字槽位，且不带任何本地改名入口', () => {
  const html = Home.registry().get('identity-row')({});
  assert.strictEqual((html.match(/class="profilename"/g) || []).length, 1, '一栏只能有一个名字');
  assert.strictEqual(html.match(/id="btn[A-Za-z]+"/g).length, 1, '整行只有一个可点区域');
  for (const legacy of ['profileLabel', 'accountStatus', 'accountAction', 'profileSource']) {
    assert.ok(!html.includes(legacy), '不应残留旧两栏锚点 ' + legacy);
  }
});

test('装配: ShellCore + home registry 按 config 声明渲染 home screen', () => {
  const cfg = { home: { modules: [
    { type: 'logo', props: { text: '彩色扫雷', em: 'COLOR MINES', icon: '💣' } },
    { type: 'homestats', props: { items: [{ id: 'homeLv', label: '当前进度', initial: 1 }] } },
    { type: 'start-button', props: { label: '开始 第', small: '每种颜色 / 每行 / 每列恰好一颗雷' } },
    { type: 'hintline', props: { lines: ['先推理再动手'] } }
  ] } };
  const sh = Shell.create(Home.registry(), cfg);
  const parts = sh.render('home', {});
  assert.strictEqual(parts.length, 4);
  assert.ok(parts[0].includes('COLOR MINES'));
  assert.ok(parts[2].includes('id="btnStart"'));
  const joined = parts.join('\n');
  assert.ok(joined.includes('id="homeLv"') && joined.includes('先推理再动手'));
});

test('装配: 未注册 type 仍走 ShellCore fail-fast（拒绝静默跳过）', () => {
  // 注：weekly-event-entry 2026-08-21 已内置到 core，故这里改用一个确实不存在的 type
  const cfg = { home: { modules: [{ type: 'no-such-module-xyz', props: {} }] } };
  assert.throws(() => Shell.create(Home.registry(), cfg), /未知|未注册/);
});

/* ---- 并排行 row + 金币牌 coins（体力不再独占整行；2026-08-20 用户反馈） ---- */
test('coins：默认 id/图标/文案，数值位可回填', () => {
  const html = Home.registry().get('coins')({});
  assert.ok(html.includes('class="coinbox"'));
  assert.ok(html.includes('id="homeCoins"'), '默认 id');
  assert.ok(html.includes('🪙') && html.includes('Coins'));
  const custom = Home.registry().get('coins')({ id: 'stCoins', icon: '💰', label: 'Coins', initial: 7 });
  assert.ok(custom.includes('id="stCoins"') && custom.includes('💰') && custom.includes('Coins'));
  assert.ok(custom.includes('>7<'), 'initial 要渲染进去');
  assert.ok(Home.registry().get('coins')({ label: '<b>x</b>' }).includes('&lt;b&gt;'), '要转义');
  assert.throws(() => Home.registry().get('coins')({ id: '' }), /id/);
});

test('row：把体力与金币放同一行，按 flex 分配宽度', () => {
  const reg = Home.registry();
  const html = reg.get('row')({ items: [
    { type: 'energy', props: {}, flex: 2 },
    { type: 'coins', props: { id: 'homeCoins' }, flex: 1 }
  ] }, {}, reg);
  assert.ok(html.includes('class="hrow"'));
  assert.ok(html.includes('style="flex:2"') && html.includes('style="flex:1"'));
  assert.ok(html.includes('class="energy"'), '子模块要真的被渲染出来');
  assert.ok(html.includes('id="enVal"'), '体力的数值位仍在（游戏侧靠它回填）');
  assert.ok(html.includes('id="homeCoins"'), '金币的数值位仍在');
  assert.ok(html.indexOf('class="energy"') < html.indexOf('coinbox'), '顺序按数组序');
});

test('row：flex 省略默认 1，配置写错直接报错', () => {
  const reg = Home.registry();
  assert.ok(reg.get('row')({ items: [{ type: 'coins' }] }, {}, reg).includes('style="flex:1"'));
  assert.throws(() => reg.get('row')({ items: [] }, {}, reg), /非空数组/);
  assert.throws(() => reg.get('row')({ items: [{ type: 'nope' }] }, {}, reg), /不是已注册模块/);
  assert.throws(() => reg.get('row')({ items: [{ type: 'row', props: { items: [] } }] }, {}, reg), /不能再嵌套/);
  assert.throws(() => reg.get('row')({ items: [{ type: 'coins', flex: 0 }] }, {}, reg), /flex/);
  assert.throws(() => reg.get('row')({ items: ['coins'] }, {}, reg), /必须是对象/);
});

test('shell 渲染 row：容器模块能拿到注册表递归渲染子模块', () => {
  const reg = Home.registry();
  const sh = Shell.create(reg, { home: { modules: [
    { type: 'row', props: { items: [{ type: 'energy', flex: 2 }, { type: 'coins', flex: 1 }] } }
  ] } });
  const out = sh.render('home', {}).join('');
  assert.ok(out.includes('class="hrow"') && out.includes('class="energy"') && out.includes('class="coinbox"'));
});

test('streak-card：稳定回填 id 齐全、无语言字面量、领取按钮初始 hidden', () => {
  const html = require('./home.js').registry().get('streak-card')({});
  for (const id of ['wsCard', 'wsCur', 'wsCurLabel', 'wsCycLabel', 'wsCycTxt', 'wsCycBar', 'wsClaim']) {
    assert.ok(html.includes('id="' + id + '"'), '缺回填 id ' + id);
  }
  assert.ok(/<button[^>]*id="wsClaim"[^>]*hidden/.test(html), '领取按钮必须初始 hidden');
  assert.ok(!/[\u4e00-\u9fff]/.test(html), '骨架不得携带中文字面量（en 运行时扫描门禁）');
});

/* ================= 游戏化首页模块（2026-08-26） ================= */

test('registry：游戏化模块全部注册，且老模块一个不少（没换 config 的游戏零影响）', () => {
  const reg = Home.registry();
  for (const t of ['hud-bar', 'identity-chip', 'energy-chip', 'coins-chip', 'icon-button',
    'hero-level', 'play-cta', 'entry-duo', 'dock']) {
    assert.strictEqual(typeof reg.get(t), 'function', t + ' 缺失');
  }
  for (const t of ['logo', 'energy', 'coins', 'row', 'start-button', 'homestats',
    'identity-row', 'streak-card', 'weekly-event-entry', 'sound-toggle', 'lang-select', 'hintline']) {
    assert.strictEqual(typeof reg.get(t), 'function', t + ' 不该被删（倒水仍在用）');
  }
});

test('chip 组：回填 id 与老模块逐字一致，游戏侧取数逻辑不用改', () => {
  const reg = Home.registry();
  const en = reg.get('energy-chip')({});
  for (const id of ['enVal', 'enSub', 'enBar']) assert.ok(en.includes('id="' + id + '"'), id);
  assert.ok(en.includes('class="max mono"'), '体力上限那段仍靠 .energy .max 之外的 .max 选择器回填');
  const co = reg.get('coins-chip')({ id: 'homeCoins', action: 'shop' });
  assert.ok(co.includes('id="homeCoins"') && co.includes('data-action="shop"') && co.includes('class="plus"'));
  assert.ok(!reg.get('coins-chip')({}).includes('class="plus"'), '没配 action 就不该出现「+」');
  const idc = reg.get('identity-chip')({ initial: 'W' });
  for (const id of ['btnIdentity', 'idAvatar', 'idBadge', 'idName', 'idSource', 'idSub', 'idAction']) {
    assert.ok(idc.includes('id="' + id + '"'), id);
  }
});

test('icon-button：id/icon 必填，action 与 aria-label 可选', () => {
  const reg = Home.registry();
  const html = reg.get('icon-button')({ id: 'btnSettings', icon: '⚙', action: 'settings', label: 'Settings' });
  assert.ok(html.includes('id="btnSettings"') && html.includes('data-action="settings"') && html.includes('aria-label="Settings"'));
  assert.throws(() => reg.get('icon-button')({ icon: '⚙' }), /icon-button\.props\.id/);
  assert.throws(() => reg.get('icon-button')({ id: 'x' }), /icon-button\.props\.icon/);
});

test('hud-bar：首项靠左、其余进右侧组，未注册子模块 fail-fast', () => {
  const reg = Home.registry();
  const html = reg.get('hud-bar')({ items: [
    { type: 'identity-chip' }, { type: 'energy-chip' }, { type: 'coins-chip' }
  ] }, {}, reg);
  assert.ok(html.includes('class="hudbar"') && html.includes('class="hudright"'));
  assert.ok(html.indexOf('idchip') < html.indexOf('hudright'), '身份 chip 必须在右侧组之前');
  assert.ok(html.indexOf('enchip') > html.indexOf('hudright') && html.indexOf('coinchip') > html.indexOf('hudright'));
  assert.throws(() => reg.get('hud-bar')({ items: [] }, {}, reg), /非空数组/);
  assert.throws(() => reg.get('hud-bar')({ items: [{ type: 'nope' }] }, {}, reg), /不是已注册模块/);
  assert.throws(() => reg.get('hud-bar')({ items: [{ type: 'hud-bar' }] }, {}, reg), /自嵌套/);
});

test('hero-level：回填锚点齐全 + 无中文字面量 + 色块只收十六进制', () => {
  const reg = Home.registry();
  const html = reg.get('hero-level')({ badge: 'COLOR MINES', kicker: 'Next level', desc: '6x6', artColors: ['#e2574c', '#4fb7e8'] });
  for (const id of ['homeHero', 'heroBadge', 'heroStars', 'heroKicker', 'heroLv', 'heroDesc', 'heroBar', 'heroChapter', 'heroProgress']) {
    assert.ok(html.includes('id="' + id + '"'), '缺回填 id ' + id);
  }
  assert.ok(!/[\u4e00-\u9fff]/.test(html), '骨架不得携带中文字面量（en 运行时扫描门禁）');
  assert.ok(html.includes('background:#e2574c') && html.includes('grid-template-columns:repeat(6,1fr)'));
  assert.ok(!reg.get('hero-level')({ art: 'plain' }).includes('class="tiles"'));
  // style 属性里的颜色若放行任意字符串，等于开了个 CSS 注入口子
  assert.throws(() => reg.get('hero-level')({ artColors: ['red;}body{display:none'] }), /颜色/);
  assert.throws(() => reg.get('hero-level')({ artColors: [] }), /非空数组/);
  assert.throws(() => reg.get('hero-level')({ art: 'photo' }), /tiles 或 plain/);
  assert.throws(() => reg.get('hero-level')({ artCols: 0 }), /artCols/);
});

test('play-cta：沿用 btnStart/startLv，可关掉关卡号', () => {
  const reg = Home.registry();
  const html = reg.get('play-cta')({ label: 'Play', small: 'Costs 15 energy' });
  assert.ok(html.includes('id="btnStart"') && html.includes('id="startLv"'));
  assert.ok(html.includes('<small>Costs 15 energy</small>') && html.includes('class="shine"'));
  assert.ok(!reg.get('play-cta')({ label: 'Play', showLevel: false }).includes('id="startLv"'));
  assert.throws(() => reg.get('play-cta')({}), /play-cta\.props\.label/);
  assert.throws(() => reg.get('play-cta')({ label: 'P', showLevel: 'yes' }), /showLevel/);
});

test('entry-duo：连胜卡与周活动并排，子模块回填 id 原样保留', () => {
  const reg = Home.registry();
  const html = reg.get('entry-duo')({ items: [{ type: 'streak-card' }, { type: 'weekly-event-entry' }] }, {}, reg);
  assert.ok(html.includes('class="hduo"') && html.includes('class="duocell"'));
  assert.ok(html.includes('id="wsCard"') && html.includes('id="btnWeekly"'));
  assert.ok(html.indexOf('wsCard') < html.indexOf('btnWeekly'), '顺序按数组序');
  assert.throws(() => reg.get('entry-duo')({ items: [{ type: 'entry-duo' }] }, {}, reg), /自嵌套/);
});

test('dock：每格 id/icon/label/action 必填，项数 2..5', () => {
  const reg = Home.registry();
  const items = [
    { id: 'dkHome', icon: '🏠', label: 'Home', action: 'home', active: true },
    { id: 'btnBag', icon: '🎒', label: 'Items', action: 'bag' }
  ];
  const html = reg.get('dock')({ items });
  assert.ok(html.includes('id="dkHome"') && html.includes('class="dockbtn on"'));
  assert.ok(html.includes('id="btnBag"') && html.includes('data-action="bag"'));
  assert.throws(() => reg.get('dock')({ items: [items[0]] }), /至少两项/);
  assert.throws(() => reg.get('dock')({ items: new Array(6).fill(items[0]) }), /最多五项/);
  assert.throws(() => reg.get('dock')({ items: [{ id: 'a', icon: 'x', label: 'y' }, items[1]] }), /action/);
});

test('styles()：主题色进 CSS 变量，未知键与非法色 fail-fast', () => {
  const css = Home.styles();
  for (const sel of ['.hudbar', '.hchip', '.hero', '.ctabtn', '.hduo', '.dock', '.dockbtn']) {
    assert.ok(css.includes(sel + '{') || css.includes(sel + ' '), '缺样式 ' + sel);
  }
  assert.ok(css.includes('--hm-accent:#ffb454'), '默认主色');
  assert.ok(!/[\u4e00-\u9fff]/.test(css), 'CSS 不得带中文（会被 en 运行时扫描门禁抓）');
  const water = Home.styles({ accent: '#5ec8f2', heroFrom: '#123456' });
  assert.ok(water.includes('--hm-accent:#5ec8f2') && water.includes('--hm-hero-1:#123456'));
  assert.ok(water.includes('--hm-accent-ink:#20160a'), '没配的主题键回落默认值');
  assert.throws(() => Home.styles({ accnet: '#fff' }), /未知主题键/);
  assert.throws(() => Home.styles({ accent: 'red' }), /颜色/);
  assert.throws(() => Home.styles([]), /必须是对象/);
});

test('shell 装配一整套游戏化首页：模块顺序与回填 id 全在', () => {
  const reg = Home.registry();
  const sh = Shell.create(reg, { home: { modules: [
    { type: 'hud-bar', props: { items: [{ type: 'identity-chip' }, { type: 'energy-chip' }, { type: 'coins-chip', props: { action: 'shop' } }] } },
    { type: 'hero-level', props: { badge: 'COLOR MINES', kicker: 'Next level' } },
    { type: 'play-cta', props: { label: 'Play' } },
    { type: 'entry-duo', props: { items: [{ type: 'streak-card' }, { type: 'weekly-event-entry' }] } },
    { type: 'dock', props: { items: [
      { id: 'dkHome', icon: '🏠', label: 'Home', action: 'home', active: true },
      { id: 'btnBag', icon: '🎒', label: 'Items', action: 'bag' },
      { id: 'dkSet', icon: '⚙', label: 'Settings', action: 'settings' }
    ] } }
  ] } });
  const out = sh.render('home', {}).join('');
  for (const id of ['btnIdentity', 'enVal', 'homeCoins', 'heroLv', 'btnStart', 'startLv', 'wsCard', 'btnWeekly', 'btnBag']) {
    assert.ok(out.includes('id="' + id + '"'), '整页缺回填 id ' + id);
  }
  assert.ok(out.indexOf('hudbar') < out.indexOf('hero') && out.indexOf('hero') < out.indexOf('btnStart'));
  assert.ok(out.indexOf('btnStart') < out.indexOf('wsCard') && out.indexOf('wsCard') < out.indexOf('dock'));
});

test('streak-duo：A 大连胜与 B 奖励票周期各自成块，回填 id 与 streak-card 逐字相同', () => {
  const reg = Home.registry();
  const html = reg.get('streak-duo')({});
  for (const id of ['wsCard', 'wsCur', 'wsCurLabel', 'wsCycLabel', 'wsCycTxt', 'wsCycBar', 'wsClaim']) {
    assert.ok(html.includes('id="' + id + '"'), '缺回填 id ' + id);
  }
  assert.ok(html.includes('class="wsa"') && html.includes('class="wsb"'), '两块必须各自成块（用户反馈「只看到一个连胜」）');
  assert.ok(/<button[^>]*id="wsClaim"[^>]*hidden/.test(html), '领取按钮必须初始 hidden');
  assert.ok(!/[\u4e00-\u9fff]/.test(html), '骨架不得携带中文字面量');
  // 老卡片仍在：倒水还在用，删了会连带炸掉另一款游戏
  assert.strictEqual(typeof reg.get('streak-card'), 'function');
  const css = Home.styles();
  assert.ok(css.includes('.streakduo{'), 'styles() 必须带双连胜卡样式');
});

test('energy-chip 有 enMax 锚点；hero-level 可关掉进度行（关卡无限生成的游戏没有 x/总数）', () => {
  const reg = Home.registry();
  assert.ok(reg.get('energy-chip')({}).includes('id="enMax"'), '体力上限要有独立 id，宿主不必靠 .energy .max 选择器');
  const noPg = reg.get('hero-level')({ progress: false });
  assert.ok(!noPg.includes('id="heroBar"') && noPg.includes('id="heroChapter"'));
  assert.ok(reg.get('hero-level')({}).includes('id="heroBar"'), '默认仍有进度条');
  assert.throws(() => reg.get('hero-level')({ progress: 'no' }), /progress/);
});

test('side-rail：左右两条竖列图标，每格必须有 action，角标初始 hidden', () => {
  const reg = Home.registry();
  const html = reg.get('side-rail')({ side: 'right', items: [
    { id: 'btnStreak', icon: '🔥', label: 'Streak', action: 'streak', badgeId: 'wsRailBadge' },
    { id: 'btnWeekly', icon: '✦', label: 'Event', action: 'weekly', badgeId: 'wkBadge' }
  ] });
  assert.ok(html.includes('class="siderail rail-right"'));
  assert.ok(html.includes('id="btnStreak"') && html.includes('data-action="streak"'));
  assert.ok(/<span class="badge" id="wsRailBadge" hidden>/.test(html), '角标必须初始 hidden（没有未读就别冒红点）');
  assert.ok(reg.get('side-rail')({ side: 'left', items: [{ id: 'a', icon: 'x', action: 'bag' }] })
    .includes('class="siderail rail-left"'));
  // 点了没反应的图标是最糟的：action 缺失直接加载期报错
  assert.throws(() => reg.get('side-rail')({ side: 'left', items: [{ id: 'a', icon: 'x' }] }), /action/);
  assert.throws(() => reg.get('side-rail')({ side: 'top', items: [{ id: 'a', icon: 'x', action: 'bag' }] }), /left 或 right/);
  assert.throws(() => reg.get('side-rail')({ side: 'left', items: [] }), /非空数组/);
  assert.throws(() => reg.get('side-rail')({ side: 'left',
    items: new Array(6).fill({ id: 'a', icon: 'x', action: 'bag' }) }), /最多五项/);
  const css = Home.styles();
  assert.ok(css.includes('.siderail{') && css.includes('.railbtn{'), 'styles() 必须带侧边图标样式');
});
