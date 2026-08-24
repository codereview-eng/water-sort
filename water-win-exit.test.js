'use strict';
/* 门禁：通关结算窗不许生成在玩家手指还没离开屏幕的那一刻。
   用户实报（2026-08-21，手机）：「通关会弹对话，但对话弹出来和最后一次双击重合，导致被误点」——
   倒水是「点源 + 点目标」的成对点击，通关那一下与弹窗弹出撞在一起，第二下正好落在刚生成的
   按钮上（多半点到「回首页」），玩家看到的就是「某些关卡通关后没有下一关，直接回首页」。
   定案修法：先播 🎉 庆祝动画（这一层没有任何按钮，误点无后果），播完才生成选择窗，
   并给新弹窗一段 DLG_GUARD_MS 静默期兜底；结算窗关掉后回首页，不把人留在死棋盘上。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = readFileSync(join(__dirname, 'water.html'), 'utf8');
const slice = (fnHead) => {
  const i = html.indexOf(fnHead);
  assert.ok(i > 0, `找不到 ${fnHead}`);
  return html.slice(i, html.indexOf('\nfunction ', i + 20));
};
const winBody = slice('function win()');
const dlgBody = slice('function dialog(html, onDismiss, guardMs)');

test('通关后先播庆祝动画，弹窗只能在动画回调里生成', () => {
  assert.ok(/celebrate\(\(\) => showWinDialog\(/.test(winBody),
    'win() 必须把结算窗交给 celebrate 的回调，不能通关就地 dialog()');
  assert.ok(!/\bdialog\(`/.test(winBody),
    'win() 函数体里不许直接 dialog(`...`)：那就是「通关瞬间弹窗」，误点又会回来');
  assert.ok(/function celebrate\(done\)/.test(html), '必须有 celebrate() 动画层');
});

test('庆祝动画层吃掉这段时间的点击，且时长可覆盖/可降级', () => {
  const cele = slice('function celebrate(done)');
  assert.ok(/document\.body\.appendChild\(el\)/.test(cele), '动画层要真的挂到页面上（它负责吞掉误点）');
  assert.ok(/setTimeout\(\(\) => \{[^}]*done\(\);/.test(cele.replace(/\n/g, ' ')),
    '动画播完必须回调 done()（否则玩家永远等不到选择窗）');
  assert.ok(/celems=/.test(cele), '要留 #celems=N 覆盖时长，自动化/门禁才能免等');
  assert.ok(/prefers-reduced-motion/.test(cele), 'reduced-motion 用户要自动缩短');
  assert.ok(/const WIN_CELE_MS = \d+/.test(html) && !/const WIN_CELE_MS = 0/.test(html),
    '默认动画时长必须为正，否则又变成通关瞬间弹窗');
});

test('弹窗有防误触静默期：guard 内点击/Esc/遮罩一律不生效', () => {
  assert.ok(/dlgGuardUntil/.test(dlgBody) && /overlay\.classList\.toggle\('guard'/.test(dlgBody),
    'dialog() 要按 guardMs 打开静默期');
  assert.ok(/function dismissDialog\(\) \{ if \(dlgGuarded\(\)\) return;/.test(html),
    'dismissDialog 必须在静默期内直接 return（✕/遮罩/Esc 三条路都经过它）');
  assert.ok(/#overlay\.guard \.dialog\{pointer-events:none\}/.test(html.replace(/\s*\n\s*/g, '')),
    '静默期内弹窗按钮要 pointer-events:none，手指落在按钮上也点不动');
  assert.ok(/const DLG_GUARD_MS = \d+/.test(html) && !/const DLG_GUARD_MS = 0/.test(html),
    '静默期时长必须为正');
});

test('结算窗仍然带「下一关」，关掉后回首页（不留在已完成的死棋盘上）', () => {
  const dlg = slice('function showWinDialog(');
  assert.ok(/id="dlgNext"/.test(dlg) && /id="dlgHome"/.test(dlg), '结算窗必须同时有「下一关」和「回首页」');
  assert.ok(/`,\s*(\/\/[^\n]*\n\s*)*\(\) => \{ show\('home'\); \}, DLG_GUARD_MS\)/.test(dlg),
    'dialog() 第二参必须是 onDismiss（回首页），第三参传 DLG_GUARD_MS');
  assert.ok(/#dlgNext'\)\.addEventListener\('click', \(\) => \{\s*closeDialog\(\);\s*document\.getElementById\('btnStart'\)\.click\(\);/
    .test(dlg), '「下一关」必须直接开下一关，中间不许插新的拦路环节');
});
