'use strict';
/* 门禁：10 连胜的进度与领奖入口必须出现在玩家眼前。
   用户实报（2026-09-02）：「关卡内要有一个浮动的 10 连胜图标专门统计 10 连胜；
   达到 10 连胜时，结束关卡的 UI 应该有直接看广告领 10 连胜奖励的按钮」。
   改动前：进度只活在首页连胜弹窗里（关卡里看不见），领奖只能「回首页 → 开连胜窗 → 领」。

   盯五件事：
     ① 局内角标是 B（最近 every 盘）的进度，满格切「可领取」态，且不参与连胜判定
     ② 结算窗第三槽只在有票时出现，且不占主按钮位（主按钮位是"下一关"的肌肉记忆）
     ③ 第三槽每次开窗都归位：上一个窗的按钮不许串到下一个窗
     ④ 领奖走完必须把结算窗放回来——领到没领到都要，否则玩家被扣在没有出口的死棋盘上
     ⑤ watchAdFor 的 onSettled 在 granted / 频控 / 没看完 / 异常四条路径上都回叫一次 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, 'mine.html'), 'utf8');
const config = JSON.parse(readFileSync(join(__dirname, 'games/mine/game.config.json'), 'utf8'));
const WinStreakCore = require('./core/winstreak.js');

/* 按大括号配平抽函数体（不能切到「下一个 function」，会把后面的顶层代码算进来） */
function slice(head) {
  const i = html.indexOf(head);
  assert.ok(i > 0, `找不到 ${head}`);
  let depth = 0, started = false;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    const c = html[j];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return html.slice(i, j + 1); }
  }
  throw new Error('大括号不配平: ' + head);
}

function el(id) {
  const node = {
    id, textContent: '', innerHTML: '', hidden: false, onclick: null,
    style: {}, dataset: {}, attrs: {}, classes: new Set(),
    classList: {
      add: (c) => node.classes.add(c), remove: (c) => node.classes.delete(c),
      contains: (c) => node.classes.has(c),
      toggle: (c, on) => { if (on) node.classes.add(c); else node.classes.delete(c); return !!on; }
    },
    setAttribute: (k, v) => { node.attrs[k] = v; },
    getAttribute: (k) => node.attrs[k],
    addEventListener: (ev, fn) => { node.listeners = node.listeners || {}; node.listeners[ev] = fn; }
  };
  return node;
}

function domCtx(extraIds) {
  const nodes = {};
  (['dlgTitle', 'dlgBody', 'dlgList', 'dlgMain', 'dlgSub', 'dlgExtra', 'dlgX', 'overlay',
    'wsFloat', 'wsFloatIc', 'wsFloatNum', 'wsFloatBar', 'home'].concat(extraIds || []))
    .forEach((id) => { nodes[id] = el(id); });
  return { nodes, $: (id) => nodes[id] || (nodes[id] = el(id)) };
}

/* ============ ① 局内浮动角标 ============ */
function renderFloatCtx(saveObj, opts) {
  const o = opts || {};
  const dom = domCtx(['wsFloatLb']);
  const WinStreak = WinStreakCore.create(Object.assign({}, config.winstreak, o.cfg || {}));
  const ctx = {
    $: dom.$, nodes: dom.nodes, Math,
    WinStreak: o.disabled ? Object.assign({}, WinStreak, { enabled: false }) : WinStreak,
    wsGet: () => saveObj,
    t: (k, p) => k + (p && p.n != null ? ':' + p.n : '')
  };
  vm.createContext(ctx);
  vm.runInContext(slice('function renderWsFloat'), ctx);
  vm.runInContext('renderWsFloat()', ctx);
  return { ctx, dom };
}

const fresh = () => WinStreakCore.create(config.winstreak).from({});

test('局内角标：0/10 起步，赢一盘就前进一格', () => {
  const ws = WinStreakCore.create(config.winstreak);
  let st = ws.from({});
  let r = renderFloatCtx(st);
  assert.strictEqual(r.dom.nodes.wsFloat.hidden, false, '关卡里必须看得见它');
  assert.strictEqual(r.dom.nodes.wsFloatNum.textContent, '0/10');
  assert.strictEqual(r.dom.nodes.wsFloatBar.style.width, '0%');
  assert.strictEqual(r.dom.nodes.wsFloatIc.textContent, '🔥');

  for (let i = 0; i < 3; i++) st = ws.win(st).state;
  r = renderFloatCtx(st);
  assert.strictEqual(r.dom.nodes.wsFloatNum.textContent, '3/10');
  assert.strictEqual(r.dom.nodes.wsFloatBar.style.width, '30%');
  assert.ok(!r.dom.nodes.wsFloat.classes.has('ready'), '还没满格不许显示"可领取"');
  assert.strictEqual(r.dom.nodes.wsFloatLb.textContent, 'wsFloatTag',
    '必须有文字标签：光一个 3/10 会被读成关卡数或道具数（视觉评审实测 6.0 分）');
});

test('局内角标：满 10 连胜切可领取态（礼物 + ready 类 + 满格条）', () => {
  const ws = WinStreakCore.create(config.winstreak);
  let st = ws.from({});
  for (let i = 0; i < 10; i++) st = ws.win(st).state;
  assert.strictEqual(ws.hasTicket(st), true, '内核该出票了，否则本用例的前提就错了');
  const r = renderFloatCtx(st);
  assert.strictEqual(r.dom.nodes.wsFloatNum.textContent, '10/10');
  assert.strictEqual(r.dom.nodes.wsFloatBar.style.width, '100%');
  assert.strictEqual(r.dom.nodes.wsFloatIc.textContent, '🎁', '可领取要换成礼物，玩家才知道该点它');
  assert.ok(r.dom.nodes.wsFloat.classes.has('ready'));
  assert.strictEqual(r.dom.nodes.wsFloatLb.textContent, 'wsFloatClaim',
    '满格要写「领取」：只靠 🎁 表达不出"这个可以点"（视觉评审实测 6.5 分）');
  assert.match(r.dom.nodes.wsFloat.getAttribute('aria-label'), /10\/10/, '无障碍标签要带进度数字');
});

test('局内角标：winstreak 关掉时整个隐藏，不留空壳', () => {
  const r = renderFloatCtx(fresh(), { disabled: true });
  assert.strictEqual(r.dom.nodes.wsFloat.hidden, true);
});

test('局内角标只读状态：不许在局内判连胜断链', () => {
  const body = slice('function renderWsFloat');
  for (const banned of ['wsKeepDialog', 'WinStreak.lose', 'WinStreak.drop', 'wsSet(']) {
    assert.ok(!body.includes(banned),
      `renderWsFloat 里不许出现 ${banned} —— 局内不判连胜（用户拍板 2026-08-31），角标只显示`);
  }
  const at = html.indexOf("$('wsFloat').addEventListener");
  const tap = html.slice(at, at + 700);
  assert.match(tap, /openStreak\(\)/, '点角标打开连胜窗（进度与领取都在那儿）');
  assert.ok(!/wsClaimTicket\(/.test(tap),
    '浮动按钮悬在拇指区，误触概率不低——不许点一下就直接跳广告，领奖入口给在结算窗');
  assert.ok(!tap.includes('wsKeepDialog'), '点角标不许弹连胜断链窗');
});

/* ============ ②③ 结算窗第三槽 ============ */
function dialogCtx() {
  const dom = domCtx();
  const traced = [];
  const ctx = {
    $: dom.$, nodes: dom.nodes, Date,
    setTimeout: (fn) => { ctx.pending = fn; return 1; },
    DLG_GUARD_MS: 350,
    dlgState: { kind: 'none', openedAt: 0, guardUntil: 0, open: false },
    dlgGuarded: () => ctx.guard === true,
    dlgDismiss: null,
    hideDialog() { ctx.hidden = (ctx.hidden || 0) + 1; },
    dismissDialog() {},
    trace: (evt, data) => traced.push({ evt, data }),
    sinceTapMs: () => 999,
    traced
  };
  vm.createContext(ctx);
  vm.runInContext(slice('function dialog(title, body'), ctx);
  return { ctx, dom, traced };
}

test('第三槽：不传 extra 就彻底隐藏（普通弹窗不长出一个广告按钮）', () => {
  const { ctx, dom } = dialogCtx();
  vm.runInContext("dialog('T', 'B', 'OK', null, null, null, null, 'other')", ctx);
  assert.strictEqual(dom.nodes.dlgExtra.hidden, true);
  assert.strictEqual(dom.nodes.dlgExtra.onclick, null);
});

test('第三槽：传了就显示、点了走回调，且埋点记 slot=extra', () => {
  const { ctx, dom, traced } = dialogCtx();
  ctx.hit = 0;
  vm.runInContext(`dialog('T', 'B', '下一关', null, '回首页', null, null, 'win',
    { text: '🎁 看广告领 10 连胜奖励', onClick: function () { hit++; } })`, ctx);
  assert.strictEqual(dom.nodes.dlgExtra.hidden, false);
  assert.strictEqual(dom.nodes.dlgExtra.textContent, '🎁 看广告领 10 连胜奖励');
  assert.strictEqual(dom.nodes.dlgMain.textContent, '下一关', '主按钮位仍然是"下一关"，不许被广告按钮占掉');
  dom.nodes.dlgExtra.onclick();
  assert.strictEqual(ctx.hit, 1);
  assert.strictEqual(ctx.hidden, 1, '点完要先收窗再走广告');
  assert.ok(traced.some((x) => x.evt === 'dialog_btn' && x.data.slot === 'extra'));
});

test('第三槽：静默期内点它不响应（与主/副按钮同一道防误触）', () => {
  const { ctx, dom } = dialogCtx();
  ctx.hit = 0;
  vm.runInContext(`dialog('T', 'B', 'OK', null, null, null, null, 'win',
    { text: 'AD', onClick: function () { hit++; } })`, ctx);
  ctx.guard = true;                     // 模拟"窗刚出来的那 350ms"
  dom.nodes.dlgExtra.onclick();
  assert.strictEqual(ctx.hit, 0, '通关那一下的手指余波不许点到广告按钮');
});

test('第三槽不许串味：上一个窗有 extra，下一个窗没有就必须消失', () => {
  const { ctx, dom } = dialogCtx();
  vm.runInContext(`dialog('T', 'B', 'OK', null, null, null, null, 'win',
    { text: 'AD', onClick: function () {} })`, ctx);
  assert.strictEqual(dom.nodes.dlgExtra.hidden, false);
  vm.runInContext("dialog('T2', 'B2', 'OK', null, null, null, null, 'other')", ctx);
  assert.strictEqual(dom.nodes.dlgExtra.hidden, true);
  assert.strictEqual(dom.nodes.dlgExtra.onclick, null, '旧回调必须清掉，否则点它会触发上一个窗的动线');
});

/* ============ ④ 结算窗：有票才给领奖入口，领完把窗放回来 ============ */
function runOnWin(hasTicket) {
  const dom = domCtx(['hudLv']);
  const calls = { dialogs: [], claim: [] };
  const ctx = {
    $: dom.$, Math, Object, JSON, Date,
    setTimeout: (fn) => { (ctx.timers = ctx.timers || []).push(fn); return 1; },
    S: { lv: 4, size: 7, found: new Set([1, 2]), opened: new Set(), remain: 40, done: false },
    save: { level: 4, clears: 3 },
    resetGestureState() {}, trace() {}, stopTimer() {}, persist() {},
    WIN_DIALOG_DELAY_MS: 320,
    Weekly: { enabled: false, frags: { win: 20 } },
    WeeklyCtl: { addFrags: () => [] },
    Coins: { rewardClear: () => null, earnPerClear: 1, balance: () => 10 },
    wsOnWin() {}, sinceTapMs: () => 999,
    WinStreak: { enabled: true, every: 10, hasTicket: () => hasTicket },
    wsGet: () => ({}),
    wsClaimTicket(onDone) { calls.claim.push(onDone); },
    startLevel() {}, showHome() {},
    maybeStory(at, cb) { cb(); },
    cheer() {},
    t: (k, p) => k + (p && p.n != null ? ':' + p.n : ''),
    dialog(title, body, mainText, onMain, subText, onSub, onDismiss, kind, extra) {
      calls.dialogs.push({ title, mainText, subText, kind, extra });
    }
  };
  vm.createContext(ctx);
  vm.runInContext(slice('function onWin'), ctx);
  vm.runInContext('onWin()', ctx);
  (ctx.timers || []).forEach((fn) => fn());     // 结算窗是延后弹的（等通关反馈演完）
  return { ctx, calls };
}

test('结算窗：没满 10 连胜时不出现领奖按钮', () => {
  const { calls } = runOnWin(false);
  assert.strictEqual(calls.dialogs.length, 1, '通关必须弹结算窗');
  assert.strictEqual(calls.dialogs[0].kind, 'win');
  assert.strictEqual(calls.dialogs[0].extra, null, '没票就不该有领奖按钮');
});

test('结算窗：满 10 连胜时给「看广告领 10 连胜奖励」，主/副按钮不动', () => {
  const { calls } = runOnWin(true);
  const d = calls.dialogs[0];
  assert.ok(d.extra && d.extra.text, '有票必须在结算窗给领奖入口（用户点名的就是这里）');
  assert.strictEqual(d.extra.text, 'wsWinClaim:10', '文案走 i18n 键 wsWinClaim，并带上 every');
  assert.strictEqual(d.mainText, 'nextLevel');
  assert.strictEqual(d.subText, 'toHome');
});

test('结算窗：领奖走完要把结算窗放回来（不把人扣在死棋盘上）', () => {
  const { calls } = runOnWin(true);
  calls.dialogs[0].extra.onClick();
  assert.strictEqual(calls.claim.length, 1, '点领奖要真的进领奖动线');
  const onDone = calls.claim[0];
  assert.strictEqual(typeof onDone, 'function', '必须传收尾回调，否则领完窗回不来');
  onDone();
  assert.strictEqual(calls.dialogs.length, 2, '领完（或没领到）结算窗必须重新弹出来');
  assert.strictEqual(calls.dialogs[1].kind, 'win');
});

/* ============ ⑤ 领奖收尾契约：四条路径都要回叫 ============ */
function claimCtx(hasTicket) {
  const dom = domCtx();
  const seen = { watch: [], done: 0 };
  const ctx = {
    $: dom.$, Object, Date,
    setTimeout: () => 1,
    WinStreak: { hasTicket: () => hasTicket, claim: () => ({ state: {}, rewards: { coins: 10 } }) },
    wsGet: () => ({}), wsSet() {}, wsRewardText: () => 'x',
    save: { energy: 0 }, persist() {}, toast() {}, renderHome() {}, renderWsFloat() {},
    Reward: { E_MAX: 120 }, Coins: { coinsKey: 'coins' }, Stock: { grant: () => ({}) },
    Weekly: { enabled: false }, WeeklyCtl: { addFrags: () => [] },
    t: (k) => k,
    watchAdFor(id, onReward, onSettled) { seen.watch.push({ id, onReward, onSettled }); },
    seen
  };
  vm.createContext(ctx);
  vm.runInContext('var wsClaiming = false;\n' + slice('function wsClaimTicket'), ctx);
  return { ctx, seen };
}

test('领奖：没票时也要立刻回叫收尾（否则调用方永远等不到）', () => {
  const { ctx, seen } = claimCtx(false);
  vm.runInContext('wsClaimTicket(function () { seen.done++; })', ctx);
  assert.strictEqual(seen.watch.length, 0, '没票不该去播广告');
  assert.strictEqual(seen.done, 1);
});

test('领奖：收尾回调挂在 watchAdFor 的 onSettled 上，不是挂在"领到奖"那一条', () => {
  const { ctx, seen } = claimCtx(true);
  vm.runInContext('wsClaimTicket(function () { seen.done++; })', ctx);
  assert.strictEqual(seen.watch.length, 1);
  assert.strictEqual(seen.watch[0].id, 'streak-claim');
  assert.strictEqual(typeof seen.watch[0].onSettled, 'function',
    '必须用 onSettled：只在 onReward 里恢复现场的话，没领到奖的那几条路径会把玩家留在死棋盘上');
  seen.watch[0].onSettled();
  assert.strictEqual(seen.done, 1);
});

function watchCtx(res, reject) {
  const seen = { settled: 0, reward: 0, warns: [] };
  const ctx = {
    Date, JSON, String, setTimeout: (fn) => { fn(); return 1; },
    console: { warn: (m) => seen.warns.push(String(m)) },
    pauseClock() {}, resumeClock() { seen.resumed = (seen.resumed || 0) + 1; },
    saveAdState() {}, checkAdHealth() {}, toast() {}, t: (k) => k,
    adState: {}, AdPlacements: {},
    AdPlay: {
      playPlacement: () => (reject ? Promise.reject(new Error('boom')) : Promise.resolve(res)),
      stats: () => ({ ok: 1, failed: 0, bySource: {} })
    },
    seen
  };
  vm.createContext(ctx);
  vm.runInContext(slice('function watchAdFor'), ctx);
  vm.runInContext(`watchAdFor('streak-claim', function () { seen.reward++; }, function () { seen.settled++; })`, ctx);
  return seen;
}

for (const [name, res, reject] of [
  ['领到奖', { granted: true, state: {} }, false],
  ['频控拦下', { granted: false, shown: false, state: {} }, false],
  ['没看完', { granted: false, shown: true, ad: { reason: 'directlink:too-short' }, state: {} }, false],
  ['广告链抛异常', null, true]
]) {
  test(`广告收尾：${name} 也必须回叫 onSettled 恰好一次`, async () => {
    const seen = watchCtx(res, reject);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(seen.settled, 1, `${name}：onSettled 少叫或多叫，弹窗就回不来/回两次`);
  });
}

/* ============ 文案 ============ */
test('新文案两种语言都有，且都带 {n} 占位符', () => {
  for (const lang of ['zh', 'en']) {
    const txt = config.i18n.locales[lang].wsWinClaim;
    assert.ok(txt, `${lang} 缺 wsWinClaim`);
    assert.match(txt, /\{n\}/, `${lang} 的 wsWinClaim 必须用 {n} 承载连胜盘数`);
  }
  assert.ok(html.includes('wsWinClaim'), '内嵌配置副本要同步（node scripts/sync-embedded-config.mjs）');
});
