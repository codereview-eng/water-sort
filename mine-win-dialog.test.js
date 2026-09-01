'use strict';
/* 门禁：胜利结算窗不许「一闪而过」。
   用户实报（2026-09-01）：「胜利结束时多次出现相应的关卡没有能弹出胜利结束 UI，
   而是直接返回首页」，且此前几轮修复都没定位到。

   靠页面自己的埋点抓到的现行（真机视口 + CDP 真实触摸双击挖开最后一颗雷）：
     #7 dialog_open kind=win sinceTap=1
     #8 +3ms dialog_btn kind=win slot=main dt=3      ← 弹出 3 毫秒后主按钮就"被点了"
     #9 +2ms level_start lv=5
   通关那一下是双击的第二次 tap，dig → onWin → 胜利窗立刻出现，浏览器随后把这次 tap 合成的
   click 派发给「手指底下刚生成的那个按钮」。按钮是「下一关」就跳关，是「回首页」就是用户看到的
   直接回首页 —— 弹窗其实弹了，只是没人来得及看见。

   所以本门禁盯三件事：
     ① dialog 层有静默期：刚弹出的几百毫秒内，主/次按钮与关闭一律不响应，并且留痕
     ② 静默期过后一切照常（护栏不能把窗口点死）
     ③ 胜利窗延后到通关反馈演完再弹，且埋点覆盖整条链路（没有埋点就会重演「修了又猜」） */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, 'mine.html'), 'utf8');

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

const GUARD_MS = Number((html.match(/var DLG_GUARD_MS = (\d+);/) || [])[1]);
assert.ok(GUARD_MS >= 250 && GUARD_MS <= 600, `静默期应在 250–600ms，当前 ${GUARD_MS}`);
const STATE_DECL = (html.match(/var dlgState = \{[^\n]*\n/) || [''])[0];
const DISMISS_DECL = (html.match(/var dlgDismiss = null;/) || [''])[0];

function makeCtx() {
  let now = 100000;
  const el = () => ({ textContent: '', style: {}, hidden: false, classList: { add() {}, remove() {}, contains: () => true } });
  const nodes = {};
  const ctx = {
    events: [],
    trace: (e, d) => ctx.events.push(Object.assign({ e }, d)),
    $: (id) => (nodes[id] = nodes[id] || el()),
    setTimeout: (fn) => { ctx.timers.push(fn); return 1; },
    timers: [],
    lastPointerUpAt: 0,
    Date: { now: () => now },
    advance: (ms) => { now += ms; },
    nowRef: () => now,
  };
  vm.createContext(ctx);
  vm.runInContext([
    DISMISS_DECL, STATE_DECL, `var DLG_GUARD_MS = ${GUARD_MS};`,
    slice('function dlgGuarded'), slice('function hideDialog'),
    slice('function dismissDialog'), slice('function dialog'),
  ].join('\n'), ctx);
  return ctx;
}

test('弹窗刚出现的静默期内，主按钮的「点击」一律不响应（通关那一下的 click 余波）', () => {
  const ctx = makeCtx();
  const calls = [];
  ctx.onMain = () => calls.push('main');
  vm.runInContext(`dialog('t', 'b', '下一关', onMain, null, null, null, 'win')`, ctx);
  ctx.advance(3);                                  // 真实抓到的间隔就是 3ms
  vm.runInContext(`$('dlgMain').onclick()`, ctx);
  assert.deepStrictEqual(calls, [], '静默期内不许触发主按钮 —— 这就是「胜利窗一闪而过」的那一下');
  const ignored = ctx.events.filter((e) => e.e === 'dialog_input_ignored');
  assert.strictEqual(ignored.length, 1, '挡掉了什么必须留痕');
  assert.strictEqual(ignored[0].what, 'main');
  assert.strictEqual(ignored[0].kind, 'win');
});

test('静默期内点遮罩/✕/Esc 也不许把窗关掉（否则「误点按钮」只是换成了「误关窗口」）', () => {
  const ctx = makeCtx();
  const calls = [];
  ctx.onDismiss = () => calls.push('home');
  vm.runInContext(`dialog('t', 'b', 'ok', null, null, null, onDismiss, 'win')`, ctx);
  ctx.advance(10);
  vm.runInContext(`dismissDialog('mask')`, ctx);
  assert.deepStrictEqual(calls, [], '静默期内的 dismiss = 手指余波，不是玩家的意思');
  assert.ok(ctx.events.some((e) => e.e === 'dialog_input_ignored' && e.what === 'dismiss' && e.via === 'mask'));
});

test('静默期一过，按钮与关闭都恢复正常（护栏不许把窗点死）', () => {
  const ctx = makeCtx();
  const calls = [];
  ctx.onMain = () => calls.push('main');
  ctx.onDismiss = () => calls.push('home');
  vm.runInContext(`dialog('t', 'b', '下一关', onMain, null, null, onDismiss, 'win')`, ctx);
  ctx.advance(GUARD_MS + 1);
  vm.runInContext(`$('dlgMain').onclick()`, ctx);
  assert.deepStrictEqual(calls, ['main'], '静默期后主按钮必须照常工作');
  const btn = ctx.events.filter((e) => e.e === 'dialog_btn');
  assert.strictEqual(btn.length, 1);
  assert.strictEqual(btn[0].slot, 'main');

  const ctx2 = makeCtx();
  ctx2.onDismiss = () => calls.push('home2');
  vm.runInContext(`dialog('t', 'b', 'ok', null, null, null, onDismiss, 'win')`, ctx2);
  ctx2.advance(GUARD_MS + 1);
  vm.runInContext(`dismissDialog('x')`, ctx2);
  assert.ok(calls.includes('home2'), '静默期后 ✕ 必须能关窗（弹窗必须能退出——硬规则）');
});

test('埋点覆盖整条胜利链路：每一步、以及「谁把人送回首页」都要有记录', () => {
  const onWin = slice('function onWin');
  for (const evt of ['win_detected', 'win_dialog_scheduled', 'win_dialog_call']) {
    assert.ok(onWin.includes(evt), `onWin 缺埋点 ${evt}`);
  }
  assert.ok(/trace\('win_reached', \{ via: 'dig'/.test(html), '挖到最后一颗雷要埋点');
  assert.ok(/trace\('win_reached', \{ via: 'tool'/.test(html), '道具挖出最后一颗雷也要埋点');
  const showHome = slice('function showHome');
  assert.ok(/trace\('home_shown'/.test(showHome), '回首页必须记来源，否则又要靠猜');
  assert.ok(/showHome\('win-dismiss'\)/.test(html), '胜利窗被关掉这条路要能在日志里区分出来');
  assert.ok(/showHome\('win-btn'\)/.test(html), '玩家主动点「回首页」也要能区分');
  const dialogFn = slice('function dialog');
  for (const evt of ['dialog_open', 'dialog_replaced', 'dialog_btn']) {
    assert.ok(dialogFn.includes(evt), `dialog 缺埋点 ${evt}`);
  }
  assert.ok(slice('function dismissDialog').includes('dialog_dismiss'), 'dismiss 要记 via/dt/sinceTap');
});

test('胜利窗延后到通关反馈演完再弹（不是立刻糊玩家一脸）', () => {
  const onWin = slice('function onWin');
  assert.ok(/setTimeout\(winDialog, WIN_DIALOG_DELAY_MS\)/.test(onWin), '普通通关要延后弹窗');
  const delay = Number((html.match(/var WIN_DIALOG_DELAY_MS = (\d+);/) || [])[1]);
  assert.ok(delay >= 200 && delay <= 600, `延迟应在 200–600ms，当前 ${delay}`);
  assert.ok(/maybeStory\(S\.lv, function \(\) \{ trace\('win_cg_done'/.test(onWin),
    'CG 那条路不加延迟（玩家刚看完动画，没有余波），但要留埋点');
});

test('埋点缓冲接的是 core/trace.js，且手机上取得到（__mine.trace）', () => {
  assert.ok(/<script src="\.\/core\/trace\.js"><\/script>/.test(html), '页面要引入 core/trace.js');
  assert.ok(/TraceCore\.create\(\{ key: 'mine_trace_v1'/.test(html), '要建出彩雷自己的缓冲');
  assert.ok(/trace: function \(n\) \{ return Trace\.text/.test(html), '__mine.trace() 是自动化取证入口');
});
