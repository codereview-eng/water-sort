'use strict';
/* 双连胜页面接线门禁（2026-08-24）：core 纯函数全绿挡不住页面漏接/接错
   （教训见 repo memory「页面接线要单独测」）。这里锁三类接线的存在性：
   ① 胜负事件源：win/onWin 记 wsOnWin，全部失败出口记 wsOnLose；
   ② 开局门：btnStart/startGame 在 pend 未决时先走 wsKeepDialog，不放行开局；
   ③ 领取/展示：首页连胜卡回填 + 领取按钮绑定 + streak-keep/streak-claim 广告位。
   断言用「函数体窗口内找调用点」而不是全文 regex，避免注释/配置误命中
   （教训见 repo memory「HTML 门禁 regex 会自我误报」）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = __dirname;
const water = readFileSync(join(ROOT, 'water.html'), 'utf8');
const mine = readFileSync(join(ROOT, 'mine.html'), 'utf8');

/* 取 anchor 之后 span 字符的窗口（anchor 必须存在且唯一，防呆） */
function windowAfter(html, anchor, span, label) {
  const i = html.indexOf(anchor);
  assert.ok(i !== -1, `${label}: 找不到锚点 "${anchor}"`);
  assert.equal(html.indexOf(anchor, i + 1), -1, `${label}: 锚点 "${anchor}" 不唯一`);
  return html.slice(i, i + span);
}

test('water：胜利记 wsOnWin，四个失败出口都记 wsOnLose', () => {
  assert.ok(windowAfter(water, 'function win() {', 700, 'water win').includes('wsOnWin();'));
  // 超时关窗 / 超时放弃（同一 timeUp 函数体内两处）
  const timeUp = windowAfter(water, 'function timeUp() {', 900, 'water timeUp');
  assert.equal((timeUp.match(/wsOnLose\(\)/g) || []).length, 2, 'timeUp 的关窗与放弃两条出口都要记断链');
  // 死局放弃回首页
  assert.ok(windowAfter(water, 'function stuck() {', 1600, 'water stuck').includes('wsOnLose()'));
  // 局中弃战（游戏内返回键）
  assert.ok(windowAfter(water, "getElementById('btnHome').addEventListener", 300, 'water btnHome').includes('wsOnLose()'));
});

test('water：开局门先解决未决断链；首页卡回填与领取按钮已接', () => {
  const start = windowAfter(water, "getElementById('btnStart').addEventListener", 400, 'water btnStart');
  assert.ok(start.includes('wsKeepDialog('), '开局门必须先弹保持窗');
  assert.ok(start.includes('.pend'), '开局门必须判 pend');
  const home = windowAfter(water, 'function renderHome() {', 2200, 'water renderHome');
  for (const id of ['wsCur', 'wsCycTxt', 'wsCycBar', 'wsClaim']) {
    assert.ok(home.includes(`'${id}'`), `renderHome 缺 ${id} 回填`);
  }
  assert.ok(water.includes("wsClaimEl.addEventListener('click'"), '首页领取按钮未绑定');
  assert.ok(windowAfter(water, 'function showWinDialog', 1200, 'water showWinDialog').includes('dlgWsClaim'), '结算窗缺领取按钮');
});

test('mine：胜利记 wsOnWin，四个失败出口都记 wsOnLose', () => {
  assert.ok(windowAfter(mine, 'function onWin() {', 700, 'mine onWin').includes('wsOnWin();'));
  for (const fn of ['function onDead() {', 'function onTimeUp() {']) {
    const body = windowAfter(mine, fn, 900, 'mine ' + fn);
    assert.equal((body.match(/wsOnLose\(\)/g) || []).length, 2, `${fn} 的重开与关窗两条出口都要记断链`);
  }
  assert.ok(windowAfter(mine, "$('btnBack').addEventListener", 400, 'mine btnBack').includes('wsOnLose()'), '局中弃战要记断链');
});

test('mine：开局门先解决未决断链；首页卡回填与领取按钮已接', () => {
  const start = windowAfter(mine, 'function startGame() {', 400, 'mine startGame');
  assert.ok(start.includes('wsKeepDialog('), '开局门必须先弹保持窗');
  assert.ok(start.includes('.pend'), '开局门必须判 pend');
  const home = windowAfter(mine, 'function renderHome() {', 2600, 'mine renderHome');
  for (const id of ['wsCur', 'wsCycTxt', 'wsCycBar', 'wsClaim']) {
    assert.ok(home.includes(`'${id}'`), `renderHome 缺 ${id} 回填`);
  }
  assert.ok(windowAfter(mine, 'function bindHome() {', 900, 'mine bindHome').includes('wsClaimTicket'),
    '首页领取按钮必须在 bindHome 里绑（切语言重建 DOM 后要重绑，见 repo memory）');
});

test('两游戏：streak-keep / streak-claim 广告位已配置，winstreak 段已声明', () => {
  for (const [name, html] of [['water', water], ['mine', mine]]) {
    const m = html.match(/<script id="gameConfig" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(m, name + ' 缺内嵌 gameConfig');
    const cfg = JSON.parse(m[1]);
    assert.equal(cfg.winstreak && cfg.winstreak.enabled, true, name + ' winstreak 未开启');
    for (const p of ['streak-keep', 'streak-claim']) {
      assert.ok(cfg.ads.placements[p], `${name} 缺广告位 ${p}`);
      assert.equal(cfg.ads.placements[p].format, 'rewarded');
    }
    assert.ok(cfg.screens.home.modules.some((mm) => mm.type === 'streak-card'), name + ' 首页缺 streak-card 模块');
    for (const f of ['wsCur', 'wsPend', 'wsCyc', 'wsEarned', 'wsClaimed']) {
      assert.ok(cfg.platform.fields[f], `${name} 云同步缺字段 ${f}`);
    }
    assert.equal(cfg.platform.fields.wsEarned.merge, 'max', name + ' wsEarned 必须只增 max 合并（票不复活不丢失）');
    assert.equal(cfg.platform.fields.wsClaimed.merge, 'max', name + ' wsClaimed 必须只增 max 合并');
  }
});
