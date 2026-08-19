'use strict';
/* water config↔页面消费一致性（issue #1 · 首页统一）：
   ① water.html 内嵌 gameConfig 必须与 games/water/game.config.json 逐字段一致；
   ② screens.home 声明必须能被 ShellCore+HomeCore(+water 扩展) 真实渲染（拒绝「config 是文档」回潮）；
   ③ 首页手写 markup 必须已移除，页面确实经 ShellCore 装配。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Shell = require('./core/shell.js');
const Home = require('./core/home.js');
const WaterHome = require('./water-home.js');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/water/game.config.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, 'water.html'), 'utf8');

function embedded() {
  const m = html.match(/<script id="gameConfig" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'water.html 缺内嵌 gameConfig JSON 块');
  return JSON.parse(m[1]);
}

test('water.html 内嵌 gameConfig 与 games/water/game.config.json 逐字段一致', () => {
  assert.deepStrictEqual(embedded(), cfg);
});

test('screens.home 声明可被 ShellCore+HomeCore+water 扩展完整渲染且含全部回填锚点', () => {
  const parts = Shell.create(Home.registry(WaterHome.extensions()), { home: cfg.screens.home }).render('home', {});
  assert.strictEqual(parts.length, cfg.screens.home.modules.length);
  for (const p of parts) assert.ok(typeof p === 'string' && p.length > 0, '模块渲染产出空 markup');
  const joined = parts.join('');
  for (const id of ['btnStart', 'startLv', 'enVal', 'enBar', 'enSub', 'btnWeekly', 'wkBadge', 'wkEntryTitle', 'wkEntrySub', 'wkEntryFrag', 'btnLb', 'stWins', 'stBottles', 'btnIdentity', 'idName', 'idAvatar', 'idSource', 'idSub', 'idAction', 'sfxToggle', 'langSel']) {
    assert.ok(joined.includes('id="' + id + '"'), '缺回填锚点 ' + id);
  }
  /* 两栏身份合一：旧的「玩家名称行 + run.ceo 账号行」不得再出现，
     否则首页又是两个名字，且其中一个还带本地改名入口 */
  for (const gone of ['btnProfile', 'profileLabel', 'btnAccount', 'accountStatus', 'accountAction']) {
    assert.ok(!joined.includes('id="' + gone + '"'), '首页仍残留旧两栏锚点 ' + gone);
  }
});

test('platform 配置过 PlatformCore 校验：字段映射列与 schema.json 实体一致，页面经 connect 消费', () => {
  const PlatformCore = require('./core/platform.js');
  const P = PlatformCore.create(cfg.platform);
  assert.strictEqual(P.entity, 'Save');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/water/schema.json'), 'utf8'));
  const entity = schema.entities[cfg.platform.entity];
  assert.ok(entity, 'games/water/schema.json 缺实体 ' + cfg.platform.entity);
  for (const key of Object.keys(cfg.platform.fields)) {
    const col = cfg.platform.fields[key].col;
    assert.ok(entity.fields[col], 'schema.json 实体缺列 ' + col + '（fields.' + key + ' 映射悬空）');
  }
  assert.strictEqual(entity.fields.updated_ms, 'number', 'schema 必须声明 updated_ms number（云档判新列）');
  assert.ok(html.includes('PlatformCore.connect(GAME_CFG.platform)'), '页面未经 PlatformCore 消费 platform 配置');
  assert.ok(html.includes('<script src="./core/platform.js"></script>'), '页面未引入 core/platform.js');
  const joined = Shell.create(Home.registry(WaterHome.extensions()), { home: cfg.screens.home }).render('home', {}).join('');
  assert.ok(joined.includes('id="btnIdentity"'), '首页缺 identity-row 回填锚点');
});

test('身份显示：单栏身份行接线齐全，游戏内没有任何本地改名入口', () => {
  assert.ok(html.includes('<script src="./core/identity.js"></script>'), '页面未引入 core/identity.js');
  for (const hook of ['IdentityCore.resolve', 'function renderIdentity', "getElementById('btnIdentity')",
    'IdentityCore.renameUrl', 'IdentityCore.takeRenameFlag', 'IdentityCore.renameOutcome']) {
    assert.ok(html.includes(hook), '页面缺身份行接线 ' + hook);
  }
  /* 定案：改名只能改 run.ceo 上本游戏的云端名称，游戏内不得有输入框/prompt */
  for (const banned of ['profileInput', 'profileEditTitle', 'normalizeAlias', 'window.prompt', 'renderAccount(']) {
    assert.ok(!html.includes(banned), '页面仍残留本地改名/旧账号行代码 ' + banned);
  }
  /* 改名跳转必须走平台契约参数名，且默认只改本游戏 */
  const Identity = require('./core/identity.js');
  const url = Identity.renameUrl({ apex: 'https://run.ceo', slug: 'water-sort', returnTo: 'https://play-water-sort.run.ceo/' });
  assert.ok(url.startsWith('https://run.ceo/coder/play/nickname?'), '改名地址不是平台改名页');
  assert.ok(url.includes('scope=perGame'), '改名默认必须是 perGame');
});

test('water 扩展不与通用模块重名，且页面经 ShellCore 消费、手写首页已移除', () => {
  assert.throws(() => Home.registry(new Map([['logo', () => '']])), /重名/);
  assert.ok(html.includes('ShellCore.create(HomeCore.registry(WaterHome.extensions())'), '页面未经 ShellCore 渲染 screens.home');
  assert.ok(!/<button class="eventbtn" id="btnWeekly">\s*</.test(html), '仍有手写 btnWeekly markup（首页必须由模块渲染）');
  assert.ok(!/<div class="logo">倒水排序<em>/.test(html), '仍有手写 logo markup（首页必须由模块渲染）');
});
