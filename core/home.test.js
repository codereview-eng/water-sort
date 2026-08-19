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
  const reg = Home.registry(new Map([['weekly-event-entry', () => '<div></div>']]));
  assert.strictEqual(typeof reg.get('weekly-event-entry'), 'function');
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
  const cfg = { home: { modules: [{ type: 'weekly-event-entry', props: {} }] } };
  assert.throws(() => Shell.create(Home.registry(), cfg), /未知|未注册/);
});
