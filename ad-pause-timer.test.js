'use strict';
/* 门禁：看广告的时间不许算进关卡时长。
   用户实报（2026-08-21）：「看广告花了 30 秒，回来只加了剩下的 30 秒」。
   最优解（prior art）= Google H5 Games Ad Placement API 的 adBreak() 契约：
     beforeAd = "Mute and pause the game flow"、afterAd = "Resume the game and un-mute the sound"，
     奖励在 adViewed（真看完）之后发放。AdMob 侧的事实约束：激励广告倒计时 5~30 秒
     （高互动创意可到 60 秒），所以「广告时长」相对关卡时长绝不是可忽略量。
   本仓落法：暂停/恢复收进 showRewardedAd() 这一层（此前是三个调用点各自手写 stopTimer/startTimer，
   新广告位默认不受保护），再加一道「暂停快照」兜底补回。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const ROOT = __dirname;
const html = readFileSync(join(ROOT, 'water.html'), 'utf8');
/* 按大括号配平抽函数体：不能用「到下一个 \nfunction」切，那会把后面的顶层代码
   （例如 #btnHome 里的 stopTimer()）算进函数体，断言就假失败/假通过。 */
const slice = (head) => {
  const i = html.indexOf(head);
  assert.ok(i > 0, `找不到 ${head}`);
  let depth = 0, started = false;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    const c = html[j];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return html.slice(i, j + 1); }
  }
  throw new Error('大括号不配平: ' + head);
};
// 广告暂停用到的模块级状态声明（同样取真实源码，不在测试里重抄一份）
const AD_STATE_DECL = (html.match(/let adPauseDepth[^\n]*\n/) || [''])[0]
  + (html.match(/let clockHidden[^\n]*\n/) || [''])[0];
assert.ok(/clockHidden/.test(AD_STATE_DECL), 'water.html 缺时钟闸门的 hidden 通道状态声明');

/* 时钟闸门的全套真源码（两条通道 + 进出闸 + 可见性接线），一起放进同一个 vm 上下文。
   不在测试里重抄实现：抄一份就会变成「测试自己跟自己对」。 */
const CLOCK_SRC = AD_STATE_DECL
  + ['clockBlocked', 'holdClock', 'releaseClock', 'adPauseGame', 'adResumeGame', 'onClockVisibility']
    .map((n) => slice('function ' + n)).join('\n');

function makeClockCtx(sandbox, opts) {
  const ctx = Object.assign({ console: { warn() {} }, document: { hidden: false } }, sandbox);
  vm.createContext(ctx);
  let src = CLOCK_SRC;
  // 需要验「闸内 startTimer 不许真开表」时，连真的 startTimer/stopTimer 一起抽进来
  if (opts && opts.realStartTimer) src += '\n' + slice('function startTimer') + '\n' + slice('function stopTimer');
  vm.runInContext(src, ctx);
  return ctx;
}

// 从 HTML 里抽出具名函数，放进 vm 跑真代码（不重抄一份实现，避免测试自证）
function runFn(name, sandbox) {
  const body = slice('function ' + name);
  const ctx = Object.assign({ console: { warn() {} } }, sandbox);
  vm.createContext(ctx);
  vm.runInContext(body + '\n' + name + '.__loaded = true;', ctx);
  return ctx;
}

test('grantTimeBonus 是叠加，不是覆盖（不许吞掉广告前的剩余时间）', () => {
  const S = { timeBudget: 600, remain: 25 };
  const ctx = runFn('grantTimeBonus', { S });
  vm.runInContext('grantTimeBonus(60)', ctx);
  assert.strictEqual(S.remain, 85, '25s 剩余 + 60s 奖励 = 85s（写成 = seconds 会变成 60）');
  assert.strictEqual(S.timeBudget, 660);
  S.remain = 0;
  vm.runInContext('grantTimeBonus(60)', ctx);
  assert.strictEqual(S.remain, 60, '归零场景仍是整 60s');
});

test('广告期间暂停：倒计时停、音效静音，广告后恢复原状', () => {
  const S = { remain: 42, timerId: 7, finished: false };
  const audio = { on: true, isEnabled() { return this.on; }, setEnabled(v) { this.on = !!v; return this.on; } };
  const calls = [];
  const sandbox = {
    S, WaterAudio: audio,
    stopTimer() { calls.push('stop'); S.timerId = null; },
    startTimer() { calls.push('start'); S.timerId = 9; },
    renderTimer() {},
  };
  // 两个函数都要在同一个 vm 上下文里（共享 adPause* 状态）
  const ctx = makeClockCtx(sandbox);

  vm.runInContext('adPauseGame()', ctx);
  assert.strictEqual(S.timerId, null, '广告开始 → 倒计时必须停');
  assert.strictEqual(audio.on, false, '广告开始 → 游戏音效必须静音（契约 beforeAd）');

  // 广告播了 30 秒；即使某条路径偷偷让 tick 跑掉了 30 秒，也必须补回来
  S.remain = 12;
  vm.runInContext('adResumeGame()', ctx);
  assert.strictEqual(S.remain, 42, '广告花掉的时间一秒都不算进关卡（按暂停快照补回）');
  assert.strictEqual(audio.on, true, '广告结束 → 恢复原来的音效开关（契约 afterAd）');
  assert.deepStrictEqual(calls, ['stop', 'start'], '暂停时停表、恢复时重新开表');
});

test('嵌套/重复调用不会提前恢复（引用计数）', () => {
  const S = { remain: 30, timerId: 3, finished: false };
  const audio = { on: true, isEnabled() { return this.on; }, setEnabled(v) { this.on = !!v; } };
  const ctx = makeClockCtx({ S, WaterAudio: audio,
    stopTimer() { S.timerId = null; }, startTimer() { S.timerId = 9; }, renderTimer() {} });
  vm.runInContext('adPauseGame(); adPauseGame(); adResumeGame();', ctx);
  assert.strictEqual(S.timerId, null, '还有一层广告没结束，不能恢复计时');
  vm.runInContext('adResumeGame()', ctx);
  assert.strictEqual(S.timerId, 9, '最后一层结束才恢复');
  vm.runInContext('adResumeGame()', ctx);   // 多余调用不许出错/不许重复 start
  assert.strictEqual(S.timerId, 9);
});

test('暂停挂在广告包装层，调用点不再各自手写 stopTimer', () => {
  const wrapper = slice('function showRewardedAd');
  assert.ok(/adPauseGame\(\)/.test(wrapper), 'showRewardedAd 必须在发起广告前 adPauseGame()');
  assert.ok(/adResumeGame\(\)/.test(wrapper), '成功/失败两路都必须 adResumeGame()');
  assert.ok(/\.then\(resume, resumeThrow\)/.test(wrapper), '失败路径也要恢复（否则广告没填充就把表停死）');
  for (const fn of ['function adRefillUndo', 'function unlockBottleWithAd']) {
    const body = slice(fn);
    assert.ok(!/resumeTimer/.test(body), `${fn} 不该再自己管计时（单一权威落在 showRewardedAd）`);
    assert.ok(!/stopTimer\(\)/.test(body), `${fn} 不该再自己 stopTimer`);
  }
});

test('时间流失有可观测日志（降级不许静默）', () => {
  const body = slice('function releaseClock');
  assert.ok(/console\.warn\(/.test(body) && /补回/.test(body),
    '补回时要打 warn：说明有路径绕过了暂停，不能静默修正');
});

/* 用户实报（2026-09-01）：「出现开始关卡，需要看广告继续保持连胜，看了广告，切回游戏，
   发现只剩下很短时间了，开始时间不对了」。
   这条路的特殊之处：广告是在首页点的，转 hidden 那一刻还没进关——旧写法的 visibilitychange
   只在 `!pages.game.hidden` 时停表，于是这次不可见什么都没按住；而 core/adplay.js 的
   directlink 源在打开新标签的瞬间就 resolve，开局流程继续往下把新的一关开出来并开表，
   玩家还在广告页上，回来时时间已经走掉一截。 */
test('开局门（连胜保持）：广告提前 resolve 后开出的新关，玩家没回来前一秒都不许走', () => {
  const S = { remain: 8, timerId: null, finished: false };   // 首页：上一关的残留剩余时间
  const audio = { on: true, isEnabled() { return this.on; }, setEnabled(v) { this.on = !!v; } };
  const ctx = makeClockCtx({ S, WaterAudio: audio, renderTimer() {}, tick() {},
    setInterval: () => 'TICK', clearInterval() {} }, { realStartTimer: true });

  vm.runInContext('adPauseGame()', ctx);              // 首页点「看广告保持连胜」
  ctx.document.hidden = true;
  vm.runInContext('onClockVisibility()', ctx);        // 广告在新标签打开 → 页面不可见
  vm.runInContext('adResumeGame()', ctx);             // directlink 立刻 resolve，广告通道出闸
  assert.strictEqual(vm.runInContext('clockBlocked()', ctx), true,
    '玩家还在广告页，hidden 通道必须继续按着表');

  S.remain = 600; S.timerId = null; S.finished = false;   // startLevel：开出新的一关
  vm.runInContext('startTimer()', ctx);
  assert.strictEqual(S.timerId, null, '玩家还没回来，新关的表不许开');

  ctx.document.hidden = false;                        // 玩家看完广告切回游戏
  vm.runInContext('onClockVisibility()', ctx);
  assert.strictEqual(S.timerId, 'TICK', '回来必须真的把新关的表开起来');
  assert.strictEqual(S.remain, 600, '新关必须还是满时间（这就是用户实报的症状）');
});

test('闸内换了局：不许拿旧关的剩余秒数给新关补时间', () => {
  const S = { remain: 600, timerId: 'TICK', finished: false };
  const audio = { on: true, isEnabled() { return this.on; }, setEnabled(v) { this.on = !!v; } };
  const ctx = makeClockCtx({ S, WaterAudio: audio, renderTimer() {}, tick() {},
    setInterval: () => 'TICK', clearInterval() {} }, { realStartTimer: true });
  vm.runInContext('adPauseGame()', ctx);              // 快照 = 旧关的 600s
  S.remain = 120;                                    // 闸内换成 120s 的新关
  vm.runInContext('startTimer()', ctx);
  vm.runInContext('adResumeGame()', ctx);
  assert.strictEqual(S.remain, 120, '新关不许被旧关快照回填成 600s');
  assert.strictEqual(S.timerId, 'TICK', '新关的表要开起来');
});

test('可见性接线走具名的 onClockVisibility（与在不在游戏页无关）', () => {
  const i = html.indexOf("addEventListener('visibilitychange'");
  assert.ok(i > 0, '缺 visibilitychange 监听');
  const seg = html.slice(i, i + 420);
  assert.ok(/onClockVisibility\(\)/.test(seg), '时钟闸门必须由具名函数统一接线');
  assert.ok(!/!pages\.game\.hidden.*stopTimer/s.test(seg),
    '不许再用「在游戏页才停表」判据：开局门的广告是在首页点的');
});
