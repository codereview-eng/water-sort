// 音效测试：用假 AudioContext 记录真实建了哪些节点（不是只断言"我调用了自己的函数"）
const { test } = require('node:test');
const assert = require('node:assert');
const Audio = require('./water-audio.js');

function fakeCtx() {
  const log = { osc: 0, buffer: 0, gain: 0, filters: [], started: 0, resumed: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
  });
  const node = () => ({ connect() {}, disconnect() {} });
  const ctx = {
    state: 'running',
    currentTime: 0,
    sampleRate: 48000,
    destination: node(),
    resume() { log.resumed += 1; },
    createGain() { log.gain += 1; return Object.assign(node(), { gain: param() }); },
    createOscillator() {
      log.osc += 1;
      return Object.assign(node(), {
        type: 'sine', frequency: param(),
        start() { log.started += 1; }, stop() {},
      });
    },
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; },
    createBufferSource() {
      log.buffer += 1;
      return Object.assign(node(), { buffer: null, loop: false, start() { log.started += 1; }, stop() {} });
    },
    createBiquadFilter() {
      const f = Object.assign(node(), { type: '', Q: param(), frequency: param() });
      log.filters.push(f);
      return f;
    },
  };
  return { ctx, log };
}

function withFake() {
  const { ctx, log } = fakeCtx();
  Audio.__setContextFactory(() => ctx);
  Audio.setEnabled(true);
  return log;
}

test('每个音效都真的建了音频节点并 start（不是空跑）', () => {
  for (const name of Audio.__names) {
    const log = withFake();
    assert.strictEqual(Audio.play(name), true, name + ' 播放失败');
    assert.ok(log.osc + log.buffer > 0, name + ' 没有创建任何声源');
    assert.ok(log.started > 0, name + ' 声源没有 start');
    assert.ok(log.gain > 0, name + ' 没有音量包络');
  }
});

test('水流声：带通滤波 + 噪声源，倒得越多声音越久、气泡越多', () => {
  const one = withFake();
  Audio.play('pour', { amount: 1 });
  assert.strictEqual(one.buffer, 1, '水流应该用噪声源');
  assert.ok(one.filters.some((f) => f.type === 'bandpass'), '水流应该过带通滤波');

  const four = withFake();
  Audio.play('pour', { amount: 4 });
  assert.ok(four.osc > one.osc, '倒 4 层的气泡声应多于 1 层');
});

test('落点水花走高通滤波（清脆而不是闷响）', () => {
  const log = withFake();
  Audio.play('splash');
  assert.ok(log.filters.some((f) => f.type === 'highpass'));
});

test('关掉音效后一个节点都不建，并且计入 silent（可观测）', () => {
  const log = withFake();
  Audio.setEnabled(false);
  const before = Audio.stats().silent;
  assert.strictEqual(Audio.play('pour'), false);
  assert.strictEqual(log.osc + log.buffer, 0, '静音时不该创建声源');
  assert.ok(Audio.stats().silent > before, 'silent 计数没有增加');
  Audio.setEnabled(true);
});

test('浏览器不支持时静默降级,但必须留下可查的原因', () => {
  Audio.__setContextFactory(() => null);
  Audio.setEnabled(true);
  assert.strictEqual(Audio.play('pick'), false);
  const s = Audio.stats();
  assert.ok(s.unavailable.length > 0, '降级原因没有记录下来');
});

test('未知音效名计入失败并写明是哪一个', () => {
  withFake();
  assert.strictEqual(Audio.play('nope'), false);
  const s = Audio.stats();
  assert.ok(s.failures > 0);
  assert.match(s.lastError, /nope/);
});

test('suspended 的上下文会被 resume（手机上首次出声的必要条件）', () => {
  const { ctx, log } = fakeCtx();
  ctx.state = 'suspended';
  Audio.__setContextFactory(() => ctx);
  Audio.setEnabled(true);
  Audio.play('pick');
  assert.ok(log.resumed > 0, '没有尝试 resume');
});
