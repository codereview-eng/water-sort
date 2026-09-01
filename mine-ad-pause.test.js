'use strict';
/* 门禁：彩雷看广告的时间不许算进关卡时长。
   用户实报（2026-08-26）：「看广告回来本该 +60s，结果只剩 20-30s」。
   根因不是加时那一行，而是广告源的 resolve 时机——core/adplay.js 的 directlink 源在
   openUrl() 打开新标签的那一刻就 resolve({ok:true})，玩家还在广告页，父页面已判「看完」
   并重启计时。所以本门禁盯三件事：
     ① 暂停期间 startTimer() 不许真的开表（否则玩家还没回来就继续走表）
     ② 恢复时若时间被扣了，必须按暂停快照补回
     ③ 加时是累加而不是覆盖（覆盖会吞掉广告前的剩余时间）
   PV ref：Google H5 Games Ad Placement API 的 adBreak() 契约（beforeAd 暂停+静音 /
   afterAd 恢复，奖励在真看完后发放）。倒水已按此落地，见 ad-pause-timer.test.js。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, 'mine.html'), 'utf8');

/* 按大括号配平抽函数体：不能切到「下一个 \nfunction」，那会把后面的顶层代码算进函数体，
   造成假失败/假通过（倒水那次踩过，见 repo memory）。 */
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

// 暂停层用到的模块级状态声明也从真实源码抽，不在测试里重抄一份实现
const CLOCK_DECL = (html.match(/var clockPause = \{[^\n]*\n/) || [''])[0];
assert.ok(CLOCK_DECL, 'mine.html 缺 clockPause 声明');

function makeCtx(overrides) {
  const warns = [];
  const ctx = Object.assign({
    console: { warn: (m) => warns.push(String(m)) },
    S: { remain: 100, timerId: null, done: false },
    stopTimer() { if (ctx.S) ctx.S.timerId = null; },
    renderTime() { ctx.rendered = (ctx.rendered || 0) + 1; },
    setInterval: () => 'TICK',
    document: { hidden: false },
    trace: function () {},          // 埋点在别的门禁里验，这里只关心时钟闸门
    warns
  }, overrides || {});
  vm.createContext(ctx);
  vm.runInContext(CLOCK_DECL + '\n'
    + slice('function clockBlocked') + '\n'
    + slice('function holdClock') + '\n'
    + slice('function releaseClock') + '\n'
    + slice('function pauseClock') + '\n'
    + slice('function resumeClock') + '\n'
    + slice('function startTimer') + '\n'
    + slice('function onClockVisibility'), ctx);
  return ctx;
}

test('暂停期间 startTimer 不真的开表（directlink 会在玩家还没回来时就发奖）', () => {
  const ctx = makeCtx();
  vm.runInContext('pauseClock()', ctx);
  vm.runInContext('startTimer()', ctx);
  assert.strictEqual(ctx.S.timerId, null, '暂停态下开表 = 继续吃玩家的时间');
  assert.strictEqual(vm.runInContext('clockPause.wasTicking', ctx), true, '要记住「本该在跑」');
  vm.runInContext('resumeClock()', ctx);
  assert.strictEqual(ctx.S.timerId, 'TICK', '恢复后必须真的把表开起来，否则加的时间白加');
});

test('暂停 → 恢复：时间一秒都不许流失；被扣了要按快照补回并留下日志', () => {
  const ctx = makeCtx();
  vm.runInContext('pauseClock()', ctx);
  ctx.S.remain = 70;                                  // 模拟有路径绕过暂停偷走了 30 秒
  vm.runInContext('resumeClock()', ctx);
  assert.strictEqual(ctx.S.remain, 100, '必须补回暂停快照');
  assert.ok(ctx.warns.some((w) => /clock lost \d+s while gated/.test(w)),
    '静默补回不行，必须留下可查的日志（日志本身用英文：主脚本反回归门禁不许中文字面量）');
});

test('嵌套暂停按引用计数：内层恢复不许提前放表', () => {
  const ctx = makeCtx({ S: { remain: 50, timerId: 'TICK', done: false } });
  vm.runInContext('pauseClock(); pauseClock()', ctx);
  assert.strictEqual(ctx.S.timerId, null);
  vm.runInContext('resumeClock()', ctx);
  assert.strictEqual(ctx.S.timerId, null, '还有一层暂停没退，不能开表');
  vm.runInContext('resumeClock()', ctx);
  assert.strictEqual(ctx.S.timerId, 'TICK');
});

test('局面已结束时恢复不开表（关卡结束后不该有表在走）', () => {
  const ctx = makeCtx({ S: { remain: 30, timerId: 'TICK', done: false } });
  vm.runInContext('pauseClock()', ctx);
  ctx.S.done = true;
  vm.runInContext('resumeClock()', ctx);
  assert.strictEqual(ctx.S.timerId, null);
});

test('广告期间静音（adBreak 契约：mute 进、un-mute 出）', () => {
  const ctx = makeCtx();
  vm.runInContext('pauseClock()', ctx);
  assert.strictEqual(vm.runInContext('clockPause.muted', ctx), true);
  vm.runInContext('resumeClock()', ctx);
  assert.strictEqual(vm.runInContext('clockPause.muted', ctx), false);
  assert.ok(/if \(clockPause\.muted\) return;/.test(slice('function cheer')), '音效函数必须认这个静音标志');
});

test('接线：广告包装层负责暂停/恢复，且发奖前已恢复', () => {
  const body = slice('function watchAdFor');
  assert.ok(/pauseClock\(\)/.test(body), 'watchAdFor 必须在这一层暂停（不能让各调用点各写一遍）');
  assert.ok(/resumeClock\(\)/.test(body), '必须恢复');
  const doneAt = body.indexOf('done();');
  const rewardAt = body.indexOf('onReward()');
  assert.ok(doneAt > 0 && rewardAt > doneAt,
    '必须先恢复时钟再发奖：否则 startTimer 只记「本该在跑」，玩家的加时白加');
  assert.ok(/function \(err\)/.test(body) || /\.catch\(/.test(body),
    '失败路径也必须把时钟还给玩家（否则一次广告异常就永久停表）');
});

test('页面不可见时停表：directlink 广告开在新标签，玩家真的会离开页面', () => {
  assert.ok(/addEventListener\('visibilitychange', onClockVisibility\)/.test(html),
    'visibilitychange 必须接到具名的 onClockVisibility（测试要能真跑这条接线）');
  const ctx = makeCtx({ S: { remain: 100, timerId: 'TICK', done: false } });
  ctx.document.hidden = true;
  vm.runInContext('onClockVisibility()', ctx);
  assert.strictEqual(ctx.S.timerId, null, '不可见要停表');
  ctx.document.hidden = false;
  vm.runInContext('onClockVisibility()', ctx);
  assert.strictEqual(ctx.S.timerId, 'TICK', '回来要恢复');
  assert.strictEqual(ctx.S.remain, 100, '不可见期间一秒都不许流失');
});

/* 用户实报（2026-09-01）：「出现开始关卡，需要看广告继续保持连胜，看了广告，切回游戏，
   发现只剩下很短时间了，开始时间不对了」。
   这条路的特殊之处：广告是在首页点的，转 hidden 那一刻**还没有当前局**——旧写法的
   visibilitychange 里 `if (!S) return` 让这次不可见完全没被按住；而 directlink 在打开新
   标签的瞬间就 resolve，于是 startGame 继续往下走，把新的一关开出来并开表，玩家还在广告页。 */
test('开局门（连胜保持）：广告提前 resolve 后开出的新关，玩家没回来前一秒都不许走', () => {
  const ctx = makeCtx({ S: null });
  vm.runInContext('pauseClock()', ctx);              // 广告通道进闸（首页，还没有局）
  ctx.document.hidden = true;
  vm.runInContext('onClockVisibility()', ctx);       // 新标签打开 → 页面不可见
  vm.runInContext('resumeClock()', ctx);             // directlink 立刻 resolve，广告通道出闸
  assert.strictEqual(vm.runInContext('clockBlocked()', ctx), true,
    '玩家还在广告页，hidden 通道必须继续按着表');
  ctx.S = { remain: 300, timerId: null, done: false };   // startGame 继续：开出新的一关
  vm.runInContext('startTimer()', ctx);
  assert.strictEqual(ctx.S.timerId, null, '玩家还没回来，新关的表不许开');
  ctx.document.hidden = false;                       // 玩家看完广告切回游戏
  vm.runInContext('onClockVisibility()', ctx);
  assert.strictEqual(ctx.S.timerId, 'TICK', '回来必须真的把新关的表开起来');
  assert.strictEqual(ctx.S.remain, 300, '新关必须还是满时间（这就是用户实报的症状）');
});

test('闸内换了局：不许拿旧关的剩余秒数给新关补时间', () => {
  const ctx = makeCtx({ S: { remain: 600, timerId: 'TICK', done: false } });
  vm.runInContext('pauseClock()', ctx);                    // 快照 = 旧关的 600s
  ctx.S = { remain: 120, timerId: null, done: false };     // 闸内换成 120s 的新关
  vm.runInContext('startTimer()', ctx);
  vm.runInContext('resumeClock()', ctx);
  assert.strictEqual(ctx.S.remain, 120, '新关不许被旧关快照回填成 600s');
  assert.strictEqual(ctx.S.timerId, 'TICK', '新关的表要开起来');
});

test('加时是累加不是覆盖（覆盖会吞掉广告前的剩余时间）', () => {
  const body = slice('function onTimeUp');
  assert.ok(/S\.remain = Math\.max\(0, S\.remain \|\| 0\) \+ AD_TIME_BONUS/.test(body),
    '加时必须写成 Math.max(0, remain) + 奖励秒数');
  assert.ok(!/S\.remain = AD_TIME_BONUS;/.test(body), '不许再用覆盖式赋值');
});
