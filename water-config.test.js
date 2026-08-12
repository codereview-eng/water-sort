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
  for (const id of ['btnStart', 'startLv', 'enVal', 'enBar', 'enSub', 'btnWeekly', 'wkBadge', 'wkEntryTitle', 'wkEntrySub', 'wkEntryFrag', 'btnLb', 'stWins', 'stBottles', 'btnProfile', 'profileName', 'profileAvatar', 'profileSource', 'sfxToggle', 'langSel']) {
    assert.ok(joined.includes('id="' + id + '"'), '缺回填锚点 ' + id);
  }
});

test('water 扩展不与通用模块重名，且页面经 ShellCore 消费、手写首页已移除', () => {
  assert.throws(() => Home.registry(new Map([['logo', () => '']])), /重名/);
  assert.ok(html.includes('ShellCore.create(HomeCore.registry(WaterHome.extensions())'), '页面未经 ShellCore 渲染 screens.home');
  assert.ok(!/<button class="eventbtn" id="btnWeekly">\s*</.test(html), '仍有手写 btnWeekly markup（首页必须由模块渲染）');
  assert.ok(!/<div class="logo">倒水排序<em>/.test(html), '仍有手写 logo markup（首页必须由模块渲染）');
});
