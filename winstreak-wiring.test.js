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

test('mine：开局门先解决未决断链；连胜角标/弹窗回填与领取按钮已接', () => {
  const start = windowAfter(mine, 'function startGame() {', 400, 'mine startGame');
  assert.ok(start.includes('wsKeepDialog('), '开局门必须先弹保持窗');
  assert.ok(start.includes('.pend'), '开局门必须判 pend');
  /* 2026-08-26 owner 定案：首页只留侧边🔥图标 + 角标，两块详情与领取按钮搬进连胜弹窗。
     所以回填拆成两半：角标 renderStreakRail，卡片 fillStreakCard；renderHome 必须两个都调，
     否则「连胜涨了首页看不出来」或「弹窗数字不刷新」。 */
  const home = windowAfter(mine, 'function renderHome() {', 2600, 'mine renderHome');
  assert.ok(home.includes('renderStreakRail()'), 'renderHome 必须刷新侧边连胜角标');
  assert.ok(home.includes('fillStreakCard()'), 'renderHome 必须刷新连胜卡（弹窗开着时）');
  const fill = windowAfter(mine, 'function fillStreakCard() {', 900, 'mine fillStreakCard');
  for (const id of ['wsCur', 'wsCycTxt', 'wsCycBar', 'wsClaim']) {
    assert.ok(fill.includes(`'${id}'`), `fillStreakCard 缺 ${id} 回填`);
  }
  const rail = windowAfter(mine, 'function renderStreakRail() {', 700, 'mine renderStreakRail');
  assert.ok(rail.includes('hasTicket('), '有未领取的票时角标必须点亮（否则玩家不知道该去领）');
  assert.ok(windowAfter(mine, 'function openStreak() {', 900, 'mine openStreak').includes('wsClaimTicket'),
    '领取按钮必须在打开连胜弹窗时绑（弹窗内容每次重建，见 repo memory 的重绑教训）');
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
    /* 双连胜必须在首页有位置：老布局用 streak-card（一张卡里两块），
       游戏化首页用 streak-duo（A 大连胜与 B 奖励票周期左右分开，用户实测「只看到一个连胜」后拆的）。
       两者回填 id 相同，宿主逻辑共用；这里只要求「至少有一个」，不锁死长相。 */
    /* 双连胜必须有位置：老布局在首页整行卡，游戏化布局是首页侧边图标 + 点开的连胜弹窗
       （screens.streak）。这里只要求「某个 screen 声明了它」，不锁死放在哪一屏。 */
    const anyScreen = Object.values(cfg.screens).flatMap((sc) => sc.modules.map((mm) => mm.type));
    assert.ok(anyScreen.includes('streak-card') || anyScreen.includes('streak-duo'),
      name + ' 缺双连胜模块（streak-card 或 streak-duo）');
    for (const f of ['wsCur', 'wsPend', 'wsCyc', 'wsEarned', 'wsClaimed']) {
      assert.ok(cfg.platform.fields[f], `${name} 云同步缺字段 ${f}`);
    }
    assert.equal(cfg.platform.fields.wsEarned.merge, 'max', name + ' wsEarned 必须只增 max 合并（票不复活不丢失）');
    assert.equal(cfg.platform.fields.wsClaimed.merge, 'max', name + ' wsClaimed 必须只增 max 合并');
  }
});
