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
