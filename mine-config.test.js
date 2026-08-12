'use strict';
/* config↔页面消费一致性（issue #1 · 首页统一）：
   ① mine.html 内嵌 GameConfig 必须与 games/mine/game.config.json 逐字段一致；
   ② screens.home 声明必须能被 ShellCore+HomeCore 真实渲染（拒绝「config 是文档」回潮）；
   ③ reward 参数过 RewardCore fail-fast 校验，且页面确实经 CFG 消费。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Shell = require('./core/shell.js');
const Home = require('./core/home.js');
const RewardCore = require('./core/reward.js');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/mine/game.config.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, 'mine.html'), 'utf8');

function embedded() {
  const m = html.match(/<script id="gameConfig" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'mine.html 缺内嵌 gameConfig JSON 块');
  return JSON.parse(m[1]);
}

test('mine.html 内嵌 GameConfig 与 games/mine/game.config.json 逐字段一致', () => {
  assert.deepStrictEqual(embedded(), cfg);
});

test('screens.home 声明可被 ShellCore+HomeCore 完整渲染且含全部回填锚点', () => {
  const parts = Shell.create(Home.registry(), cfg.screens).render('home', {});
  assert.strictEqual(parts.length, cfg.screens.home.modules.length);
  for (const p of parts) assert.ok(typeof p === 'string' && p.length > 0, '模块渲染产出空 markup');
  const joined = parts.join('');
  for (const id of ['btnStart', 'startLv', 'enVal', 'enBar', 'enSub', 'homeLv', 'homeClears', 'homeTools', 'btnProfile', 'sfxToggle']) {
    assert.ok(joined.includes('id="' + id + '"'), '缺回填锚点 ' + id);
  }
});

test('reward 配置过 RewardCore 校验且页面经 CFG 消费、手写首页已移除', () => {
  const R = RewardCore.create(cfg.reward);
  assert.strictEqual(R.E_COST, 15);
  assert.strictEqual(R.E_MAX, 120);
  assert.strictEqual(R.E_AD, 60);
  assert.ok(html.includes('RewardCore.create(CFG.reward)'), '页面未经 RewardCore 消费 reward 配置');
  assert.ok(html.includes('ShellCore.create(HomeCore.registry(), CFG.screens)'), '页面未经 ShellCore 渲染 screens');
  assert.ok(!/<div class="homestats">/.test(html), '仍有手写 homestats markup（首页必须由模块渲染）');
});
