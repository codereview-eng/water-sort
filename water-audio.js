// 倒水音效：全部用 Web Audio 程序化合成，不带任何音频文件
// （素材文件要额外体积和版权来源，而水流/水滴/提示音本来就适合合成）。
// 双环境：Node (module.exports) 与浏览器 (window.WaterAudio)，与其它模块同一封装风格。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaterAudio = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var enabled = true;
  var ctxFactory = null;                 // 测试可注入
  // 可观测性：静音降级不是"什么都不做就算了"，必须能回答「有没有在响、为什么不响」
  var stats = { played: {}, calls: 0, silent: 0, failures: 0, lastError: '', unavailable: '' };

  function defaultFactory() {
    var C = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    return C ? new C() : null;
  }

  function ensure() {
    if (ctx) return ctx;
    try {
      ctx = (ctxFactory || defaultFactory)();
    } catch (err) {
      stats.failures += 1;
      stats.lastError = String((err && err.message) || err).slice(0, 160);
      ctx = null;
    }
    if (!ctx) {
      stats.unavailable = stats.lastError || 'AudioContext 不可用（浏览器不支持或被策略禁用）';
      return null;
    }
    stats.unavailable = '';
    master = ctx.createGain();
    master.gain.value = 0.34;
    master.connect(ctx.destination);
    return ctx;
  }

  function now() { return ctx.currentTime; }

  function envGain(peak, attack, hold, release, at) {
    var g = ctx.createGain();
    var t0 = at == null ? now() : at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    g.gain.setValueAtTime(Math.max(peak, 0.0002), t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
    g.connect(master);
    return g;
  }

  function tone(freqFrom, freqTo, dur, type, peak, at) {
    var t0 = at == null ? now() : at;
    var osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freqFrom, t0);
    if (freqTo && freqTo !== freqFrom) osc.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur);
    var g = envGain(peak || 0.16, Math.min(0.012, dur * 0.25), dur * 0.35, dur * 0.6, t0);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + dur + 0.08);
    return osc;
  }

  function noise(dur) {
    if (!noiseBuf) {
      var n = Math.floor(ctx.sampleRate * 1.2);
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < n; i += 1) data[i] = Math.random() * 2 - 1;
    }
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.start(now());
    src.stop(now() + dur + 0.05);
    return src;
  }

  // ---- 具体音色 ----
  var SFX = {
    pick: function () { tone(620, 980, 0.07, 'sine', 0.12); },

    undo: function () { tone(520, 300, 0.09, 'sine', 0.10); },

    illegal: function () {
      tone(210, 180, 0.06, 'square', 0.07);
      tone(170, 140, 0.07, 'square', 0.06, now() + 0.09);
    },

    // 水流：带通噪声扫频（水柱由细变稳再收），叠几颗“咕嘟”气泡
    pour: function (opts) {
      var amount = (opts && opts.amount) || 1;
      var dur = Math.min(0.30 + amount * 0.12, 0.72);
      var src = noise(dur);
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.1;
      var t0 = now();
      bp.frequency.setValueAtTime(480, t0);
      bp.frequency.linearRampToValueAtTime(1350, t0 + dur * 0.35);
      bp.frequency.linearRampToValueAtTime(760, t0 + dur);
      var g = envGain(0.20, 0.05, dur * 0.55, dur * 0.4, t0);
      src.connect(bp);
      bp.connect(g);
      for (var k = 0; k < 2 + amount; k += 1) {
        var at = t0 + dur * (0.18 + 0.72 * Math.random());
        tone(200 + Math.random() * 260, 120, 0.05, 'sine', 0.045, at);
      }
    },

    // 落点水花：高通噪声短促一击
    splash: function () {
      var dur = 0.11;
      var src = noise(dur);
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      var g = envGain(0.14, 0.006, 0.02, dur, now());
      src.connect(hp);
      hp.connect(g);
    },

    // 一管归位：三音上行
    tubeDone: function () {
      [784, 988, 1319].forEach(function (f, i) { tone(f, f, 0.10, 'sine', 0.11, now() + i * 0.07); });
    },

    // 过关：五音上行 + 尾音
    win: function () {
      [523, 659, 784, 1047].forEach(function (f, i) { tone(f, f, 0.12, 'sine', 0.12, now() + i * 0.09); });
      tone(1319, 1319, 0.42, 'sine', 0.13, now() + 0.36);
    },
  };

  function play(name, opts) {
    stats.calls += 1;
    if (!enabled) { stats.silent += 1; return false; }
    if (!ensure()) { stats.silent += 1; return false; }
    var fn = SFX[name];
    if (!fn) { stats.failures += 1; stats.lastError = '未知音效: ' + name; return false; }
    try {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      fn(opts);
      stats.played[name] = (stats.played[name] || 0) + 1;
      return true;
    } catch (err) {
      stats.failures += 1;
      stats.lastError = name + ': ' + String((err && err.message) || err).slice(0, 160);
      return false;
    }
  }

  return {
    play: play,
    // 浏览器要求先有用户手势才允许出声，第一次点击时调它
    unlock: function () {
      if (!enabled) return false;
      if (!ensure()) return false;
      if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
      return ctx.state !== 'suspended';
    },
    setEnabled: function (v) { enabled = !!v; return enabled; },
    isEnabled: function () { return enabled; },
    stats: function () { return JSON.parse(JSON.stringify(stats)); },
    // 仅测试用：注入假 AudioContext
    __setContextFactory: function (f) { ctxFactory = f; ctx = null; master = null; noiseBuf = null; },
    __names: Object.keys(SFX),
  };
}));
