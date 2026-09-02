'use strict';
/* 门禁：倒计时进红色告警区就要"滴答"。
   用户实报（2026-09-02）：「倒计时显示成红色的时候，应该有相应的音效滴答滴答，造成紧张感」。
   此前告警只有颜色（HUD 变红 + 闪烁），手机上玩家盯着盘面，眼角扫不到角上那行小字。

   盯四件事：
     ① 只在告警区响：>lowSec 不响、归零不响（那一声让给超时结算）
     ② 挂在真实的一秒上，不挂渲染：renderHud 一秒能重绘好几次，挂渲染会变机枪
     ③ 静音契约：音效开关关掉、广告闸内（adBreak mute）都不许响
     ④ 素材通道坏了要能查、要能被发现：降级音顶上 + 记异常本体 + 反向阈值告警
   还有一条最容易漂的：变红的阈值与响滴答的阈值必须是同一份定义（本机纪律「单一权威契约」）。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const TickAlarmCore = require('./core/tickalarm.js');
const html = readFileSync(join(__dirname, 'mine.html'), 'utf8');

/* ============ 假 AudioContext：记下真实生成的音频图，而不是只记"被调用过" ============ */
function fakeCtx(opts) {
  const o = opts || {};
  const played = [];       // 每一声：{ kind:'buffer'|'synth', gain, rate, freq }
  const ac = {
    currentTime: 0,
    sampleRate: 48000,
    destination: { id: 'dest' },
    decodeAudioData(bytes, onOk, onErr) {
      ac.decodeCalls = (ac.decodeCalls || 0) + 1;
      ac.decodeBytes = bytes.byteLength;
      if (o.decodeFails) { onErr(Object.assign(new Error('mp3 解不了'), { name: 'EncodingError' })); return; }
      if (o.decodeHangs) return;                       // 永不回调：模拟"第一声素材还没解好"
      onOk({ duration: 0.09, id: 'sample' });
    },
    createBuffer(ch, len, rate) {
      return { length: len, sampleRate: rate, getChannelData: () => new Float32Array(len) };
    },
    createBufferSource() {
      const src = { playbackRate: { value: 1 }, buffer: null, connect: (n) => { src.out = n; },
        start() { const isSample = src.buffer && src.buffer.id === 'sample';
          played.push({ kind: isSample ? 'buffer' : 'synth', rate: src.playbackRate.value,
            gain: src.out && src.out.gainValue, freq: src.out && src.out.freq }); } };
      return src;
    },
    createGain() {
      const g = { gain: { value: 1, setValueAtTime(v) { g.gainValue = v; },
          exponentialRampToValueAtTime() {} }, connect: () => {} };
      Object.defineProperty(g, 'gainValue', { writable: true, value: undefined });
      const realGain = g.gain;
      Object.defineProperty(g, 'gain', { get: () => realGain,
        set: (v) => { realGain.value = v; } });
      const origSet = realGain.setValueAtTime.bind(realGain);
      realGain.setValueAtTime = (v, t) => { g.gainValue = v; origSet(v, t); };
      Object.defineProperty(realGain, 'value', {
        get: () => g._v, set: (v) => { g._v = v; g.gainValue = v; }
      });
      return g;
    },
    createBiquadFilter() {
      const f = { type: '', frequency: { value: 0 }, Q: { value: 0 },
        connect: (n) => { f.out = n; } };
      return f;
    }
  };
  return { ac, played };
}

function makeAlarm(opts) {
  const o = opts || {};
  const { ac, played } = fakeCtx(o);
  const events = [];
  const alarm = TickAlarmCore.create({
    withAudio(play) {
      if (o.sfxOff) return 'sfx-off';
      if (o.audioBroken) return 'audio-error:NotAllowedError';
      play(ac); return 'running';
    },
    masterIn: () => ({ id: 'masterIn' }),
    isMuted: () => !!o.muted,
    onEvent: (evt, data) => events.push({ evt, data })
  });
  return { alarm, played, events, ac };
}

/* ============ ① 只在告警区响 ============ */
test('>lowSec 不响，进了告警区才响；归零那一声让给超时结算', () => {
  const { alarm, played } = makeAlarm();
  assert.strictEqual(alarm.lowSec, 30, '告警阈值应为 30s（与 HUD 变红同一份）');
  assert.strictEqual(alarm.tick(31), 'off-range');
  assert.strictEqual(alarm.tick(0), 'off-range');
  assert.strictEqual(alarm.tick(-3), 'off-range');
  assert.strictEqual(played.length, 0, '告警区外一声都不许响');
  assert.strictEqual(alarm.tick(30), 'played');
  assert.strictEqual(alarm.tick(1), 'played');
  assert.strictEqual(played.length, 2);
  assert.ok(played.every((p) => p.kind === 'buffer'), '正常路径必须用真实素材，不是合成降级音');
});

test('滴/答交替：相邻两声音高不同，末 10 秒整体加急变响', () => {
  const { alarm, played } = makeAlarm();
  alarm.tick(30); alarm.tick(29);
  assert.notStrictEqual(played[0].rate, played[1].rate, '连续两声同音高就成了机器蜂鸣，不是钟摆');
  const normalGain = played[0].gain;
  alarm.tick(10);
  const rush = played[2];
  assert.ok(rush.gain > normalGain, `末 10 秒要更响（${rush.gain} vs ${normalGain}）`);
  assert.ok(rush.rate > played[0].rate, '末 10 秒音高要上移，让"最后十秒"听得出来');
  assert.strictEqual(alarm.isRush(11), false);
  assert.strictEqual(alarm.isRush(10), true);
});

/* ============ ③ 静音契约 ============ */
test('音效开关关掉 / 广告闸内静音时一声不响', () => {
  const off = makeAlarm({ sfxOff: true });
  assert.strictEqual(off.alarm.tick(20), 'sfx-off');
  assert.strictEqual(off.played.length, 0);
  assert.strictEqual(off.alarm.stats().sfxOff, 1);

  const muted = makeAlarm({ muted: true });
  assert.strictEqual(muted.alarm.tick(20), 'muted');
  assert.strictEqual(muted.played.length, 0, '广告期间必须闭嘴（adBreak 契约：mute 进、un-mute 出）');
  assert.strictEqual(muted.ac.decodeCalls, undefined, '静音时连解码都不该被触发');
});

test('AudioContext 起不来时记下原因，不装作响了', () => {
  const { alarm } = makeAlarm({ audioBroken: true });
  assert.strictEqual(alarm.tick(20), 'audio-error:NotAllowedError');
  const s = alarm.stats();
  assert.strictEqual(s.audioError, 1);
  assert.match(s.lastError, /NotAllowedError/);
});

/* ============ ④ 降级可观测 + 反向告警（本机纪律第 5 条） ============ */
test('素材还没解好：先用合成音顶上，不是静默', () => {
  const { alarm, played } = makeAlarm({ decodeHangs: true });
  assert.strictEqual(alarm.tick(20), 'fallback');
  assert.strictEqual(played.length, 1, '降级也必须真的发出一声');
  assert.strictEqual(played[0].kind, 'synth');
  assert.strictEqual(alarm.stats().fallback, 1);
});

test('解码失败要记异常本体（err_name/err_msg），而不是只记一个事件名', () => {
  const { alarm, events } = makeAlarm({ decodeFails: true });
  alarm.tick(20);
  const fail = events.find((e) => e.evt === 'tick_decode_fail');
  assert.ok(fail, '解码失败必须落一条可查的埋点');
  assert.strictEqual(fail.data.err_name, 'EncodingError');
  assert.match(fail.data.err_msg, /解不了/);
  assert.ok(fail.data.bytes > 0, '要记下素材字节数，才能分清"素材没进包"和"浏览器解不了"');
  assert.strictEqual(alarm.stats().decodeFail, 1);
});

test('一直降级会自己喊出来：反向阈值告警 + 降级率可查', () => {
  const { alarm, events } = makeAlarm({ decodeFails: true });
  for (let s = 25; s > 15; s--) alarm.tick(s);
  const alarmEvt = events.filter((e) => e.evt === 'tick_fallback_persistent');
  assert.strictEqual(alarmEvt.length, 1, '常态化降级必须报警，且只报一次（别刷爆埋点）');
  assert.ok(alarmEvt[0].data.fallback >= 5);
  const s = alarm.stats();
  assert.strictEqual(s.played, 0);
  assert.strictEqual(s.fallbackRate, 1, '降级率要能一眼回答"最近响的都是降级音"');
  assert.ok(s.lastError.includes('EncodingError'), '日志要能直接说出为什么降级');
});

/* ============ 素材：mp3 才是唯一权威，js 里的 base64 只是搬运件 ============ */
test('内联 base64 与 assets/mine/tick-clock.mp3 一致，且是真 MP3', () => {
  const mp3 = readFileSync(join(__dirname, 'assets/mine/tick-clock.mp3'));
  assert.strictEqual(TickAlarmCore.sampleBase64(), mp3.toString('base64'),
    '内联素材与源 mp3 漂移了 —— 跑 node scripts/embed-tick-sample.mjs 重新内联');
  assert.strictEqual(TickAlarmCore.SAMPLE_MIME, 'audio/mpeg');
  const head = mp3.subarray(0, 3).toString('latin1');
  assert.ok(head === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0),
    'MP3 才是全平台（含旧 iOS webview）都能 decodeAudioData 的格式');
  assert.ok(mp3.length > 400 && mp3.length < 8 * 1024,
    `素材 ${mp3.length}B：太小说明裁空了，太大会挤爆 1MiB payload 预算`);
});

/* ============ ② 接线：挂在真实的一秒上，且阈值只有一份 ============ */
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

function runTimer(remainStart, steps) {
  const ticks = [], renders = [];
  const ctx = {
    S: { remain: remainStart, timerId: null, done: false },
    clockPause: { held: false, muted: false, wasTicking: false, remain: -1 },
    clockBlocked: () => false,
    stopTimer() { ctx.S.timerId = null; },
    renderTime() { renders.push(ctx.S.remain); },
    onTimeUp() { ctx.timeUp = true; },
    TickAlarm: { tick: (sec) => { ticks.push(sec); return 'played'; }, lowSec: 30,
      isRush: (s) => s <= 10 },
    setInterval: (fn) => { ctx.fn = fn; return 'TIMER'; },
    clearInterval: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(slice('function startTimer') + '\n' + slice('function stopTimer'), ctx);
  vm.runInContext('startTimer()', ctx);
  for (let i = 0; i < steps; i++) ctx.fn();
  return { ticks, renders, ctx };
}

test('每走掉一秒响一声；归零不响，交给超时结算', () => {
  const { ticks, ctx } = runTimer(3, 3);
  assert.deepStrictEqual(ticks, [2, 1], '2s、1s 各一声；0 那一下不响');
  assert.strictEqual(ctx.timeUp, true);
});

test('滴答不挂在渲染上：重绘 HUD 不会多响', () => {
  const el = { textContent: '', classList: { toggle: () => {}, remove: () => {} } };
  const ctx = {
    S: { remain: 12 },
    $: () => el,
    TickAlarm: { lowSec: 30, tick: () => { throw new Error('renderTime 里不许响滴答'); },
      isRush: (s) => s <= 10 },
    Math
  };
  vm.createContext(ctx);
  vm.runInContext(slice('function renderTime'), ctx);
  vm.runInContext('renderTime(); renderTime(); renderTime()', ctx);   // 不许抛
  assert.strictEqual(el.textContent, '00:12');
});

test('变红与滴答共用一份阈值：renderTime 不许再写裸字面量', () => {
  const body = slice('function renderTime');
  assert.ok(/TickAlarm\.lowSec/.test(body),
    'renderTime 必须读 TickAlarm.lowSec —— 两处各写一个 30 迟早漂成"红了不响/响了不红"');
  assert.ok(!/<=\s*30\b/.test(body), 'renderTime 里还留着裸的 30');
});

test('滴答走宿主的音效开关与共享输出链，且广告静音接的是同一份闸门状态', () => {
  const create = html.slice(html.indexOf('TickAlarmCore.create('), html.indexOf('运行时状态'));
  assert.match(create, /withAudio:\s*withAudio/, '必须复用宿主 withAudio（音效开关 + iOS resume 解锁）');
  assert.match(create, /masterIn:\s*masterIn/, '必须走共享压缩器输出链，否则大音量下扎耳');
  assert.match(create, /clockPause\.muted/, '广告闸内静音要读同一份 clockPause.muted');
  assert.match(create, /onEvent:[\s\S]{0,40}trace\(/, '降级/解码失败要落进同一份诊断日志');
  assert.ok(html.includes('<script src="./core/tickalarm.js"></script>'),
    'mine.html 必须真的引入 core/tickalarm.js（否则 TickAlarmCore 未定义，整页 script 会挂）');
});
