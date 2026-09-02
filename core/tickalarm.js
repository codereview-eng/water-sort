/* 倒计时告警滴答（tick alarm）——关卡时间进入红色告警区时，每秒一声「滴答」。
 *
 * 为什么要有：告警此前只有颜色（HUD 变红 + 闪烁）。玩家在手机上盯的是盘面，
 * 眼角根本扫不到角上那行小字，等注意到时往往已经超时。紧张感要靠听觉给。
 *
 * 为什么放 core：倒水与彩雷是同一套「HUD 变红 + 每秒滴答」的模式，阈值（lowSec）
 * 与音色只该有一份定义；宿主页面把红字判据也读这里的 lowSec，
 * 保证「变红」和「响滴答」永远是同一个瞬间，不会各写一个字面量而漂移。
 *
 * 素材来源：assets/mine/tick-clock.mp3 —— assetgen（kind=sfx）生成的机械钟摆
 * escapement 单击，裁到 90ms、峰值归一到 -1dBFS、48kHz 单声道，MP3 96kbps。
 * 选 MP3 而不是 ogg/opus：decodeAudioData 对 MP3 是全平台（含旧 iOS webview）都能解的，
 * 而 Ogg Opus 在旧 Safari 上会解码失败 —— 那正好是本游戏的主力人群，
 * 一旦解不出来就只剩降级音，等于白做。选内联 data 而不是外链文件：发布产物
 * fail-close 明令「不许引用 assets/ 二进制」（见 scripts/build-publish-mine.mjs），
 * 素材必须以文本形态进 payload。
 *
 * 下面 sample:begin / sample:end 之间的 base64 是从那个 mp3 机械生成的，不要手改：
 *   node scripts/embed-tick-sample.mjs
 * mine-tick-alarm.test.js 会拿 mp3 重算一遍逮漂移（mp3 才是唯一权威，这里只是它的搬运）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TickAlarmCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SAMPLE_MIME = 'audio/mpeg';
  /* sample:begin */
  var SAMPLE_B64 = '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';
  /* sample:end */

  var DEFAULTS = {
    lowSec: 30,        // ≤30s：HUD 变红 + 开始滴答
    rushSec: 10,       // ≤10s：加急（更响、音高上移，让"最后十秒"听得出来）
    gain: 0.5,         // 素材峰值 -1dBFS，实际响度由宿主共享压缩器兜住
    rushGain: 0.8,
    /* 滴/答：真实钟摆的两声本就不同高（擒纵机构两个方向），靠播放速率交替最省素材 */
    tockRate: 0.92,
    rushRate: 1.08,
    /* 连续降级到第几声就报警：见本机纪律「降级分支必须可观测 + 反向告警」。
       素材解不出来时降级音还在响，用户不会投诉——只有反向阈值能发现它常态化了。 */
    fallbackAlarmAt: 5
  };

  function bytesFromBase64(b64) {
    if (typeof atob === 'function') {
      var raw = atob(b64), n = raw.length, out = new Uint8Array(n);
      for (var i = 0; i < n; i++) out[i] = raw.charCodeAt(i);
      return out;
    }
    if (typeof Buffer !== 'undefined') {
      var b = Buffer.from(b64, 'base64');
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    }
    return null;
  }

  function errText(err) {
    return String((err && err.message) || err || '').slice(0, 200);
  }

  function create(opts) {
    var o = opts || {};
    var cfg = {};
    Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = o[k] == null ? DEFAULTS[k] : o[k]; });

    /* 宿主注入，而不是自己 new AudioContext：开关（save.sfx）、iOS 的 resume 解锁、
       共享输出链（lowpass + 压缩器）都在宿主手里，滴答必须走同一条路，
       否则会出现「关了音效它还在响」或「绕过压缩器扎耳」。 */
    var withAudio = typeof o.withAudio === 'function' ? o.withAudio : null;
    var masterIn = typeof o.masterIn === 'function' ? o.masterIn : null;
    var isMuted = typeof o.isMuted === 'function' ? o.isMuted : function () { return false; };
    var onEvent = typeof o.onEvent === 'function' ? o.onEvent : function () {};
    var sampleB64 = o.sampleB64 == null ? SAMPLE_B64 : o.sampleB64;

    var buf = null;              // 解好的素材
    var decoding = false;
    var noise = null;            // 降级音用的噪声底
    var alarmed = false;         // 反向告警只报一次，别把埋点刷爆
    var stats = {
      calls: 0, played: 0, fallback: 0, muted: 0, offRange: 0, sfxOff: 0,
      audioError: 0, decodeFail: 0, decoded: false,
      lastReason: '', lastSec: -1, lastError: ''
    };

    function reason(r) { stats.lastReason = r; return r; }

    function ensureDecode(ac) {
      if (buf || decoding || !sampleB64) return;
      var bytes = bytesFromBase64(sampleB64);
      if (!bytes) { stats.decodeFail += 1; stats.lastError = 'no base64 decoder'; return; }
      decoding = true;
      var onOk = function (decoded) { buf = decoded; decoding = false; stats.decoded = true; };
      var onErr = function (err) {
        decoding = false;
        stats.decodeFail += 1;
        /* 记异常本体而不是只记一个事件名：降级最爱藏在 catch 里，
           只看日志要能直接回答「为什么在降级」。 */
        stats.lastError = (err && err.name ? err.name + ': ' : '') + errText(err);
        onEvent('tick_decode_fail', {
          err_name: String((err && err.name) || 'DecodeError'),
          err_msg: errText(err),
          bytes: bytes.length
        });
      };
      try {
        /* 两种签名都要接：旧 Safari 只有回调式，Promise 式返回 undefined 的浏览器也存在 */
        var copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        var p = ac.decodeAudioData(copy, onOk, onErr);
        if (p && p.then) p.then(onOk, onErr);
      } catch (err) { onErr(err); }
    }

    function playBuffer(ac, out, gain, rate) {
      var src = ac.createBufferSource();
      src.buffer = buf;
      if (src.playbackRate) src.playbackRate.value = rate;
      var g = ac.createGain();
      g.gain.value = gain;
      src.connect(g); g.connect(out);
      src.start(ac.currentTime);
    }

    /* 降级音：素材还没解好（第一声）或这台机器解不了时顶上的合成"咔"。
       带通噪声 + 6ms 衰减，听起来是同一族的机械声，而不是"什么都没有"。 */
    function playSynth(ac, out, gain, rate) {
      if (!noise) {
        var n = Math.floor(ac.sampleRate * 0.03);
        noise = ac.createBuffer(1, n, ac.sampleRate);
        var d = noise.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      }
      var src = ac.createBufferSource();
      src.buffer = noise;
      if (src.playbackRate) src.playbackRate.value = rate;
      var bp = ac.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2600 * rate; bp.Q.value = 1.4;
      var g = ac.createGain();
      var t0 = ac.currentTime;
      g.gain.setValueAtTime(Math.max(gain, 0.0002), t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(t0);
    }

    function fire(ac, sec, rush) {
      var out = masterIn ? masterIn(ac) : ac.destination;
      var gain = rush ? cfg.rushGain : cfg.gain;
      /* 偶数秒"滴"、奇数秒"答"：两声一组的钟摆感，而不是一串同音的机器蜂鸣 */
      var rate = (sec % 2 === 0 ? 1 : cfg.tockRate) * (rush ? cfg.rushRate : 1);
      ensureDecode(ac);
      if (buf) { playBuffer(ac, out, gain, rate); stats.played += 1; reason('played'); return; }
      playSynth(ac, out, gain, rate);
      stats.fallback += 1;
      reason('fallback');
      /* 反向阈值：一直在降级说明素材通道坏了（HTTP 200、无异常、功能"照常"，
         正向告警永远看不到），必须自己喊出来。 */
      if (!alarmed && stats.played === 0 && stats.fallback >= cfg.fallbackAlarmAt) {
        alarmed = true;
        onEvent('tick_fallback_persistent', {
          fallback: stats.fallback, decode_fail: stats.decodeFail,
          err_msg: stats.lastError || 'sample not decoded yet'
        });
      }
    }

    /* 每走掉一秒叫一次。返回值是原因串（自动化与门禁读它，别靠听）。 */
    function tick(sec) {
      stats.calls += 1;
      stats.lastSec = sec;
      if (!(typeof sec === 'number' && sec > 0 && sec <= cfg.lowSec)) {
        stats.offRange += 1; return reason('off-range');
      }
      if (isMuted()) { stats.muted += 1; return reason('muted'); }   // 广告闸内静音（adBreak 契约）
      if (!withAudio) { stats.audioError += 1; return reason('no-audio-host'); }
      var rush = sec <= cfg.rushSec;
      var res = withAudio(function (ac) { fire(ac, sec, rush); });
      if (res === 'sfx-off') { stats.sfxOff += 1; return reason('sfx-off'); }
      if (typeof res === 'string' && res.indexOf('audio-error') === 0) {
        stats.audioError += 1; stats.lastError = res; return reason(res);
      }
      return stats.lastReason;
    }

    return {
      tick: tick,
      lowSec: cfg.lowSec,
      rushSec: cfg.rushSec,
      isRush: function (sec) { return typeof sec === 'number' && sec > 0 && sec <= cfg.rushSec; },
      /* 可观测性：「最近响了多少声、其中多少是降级、为什么降级」一问就能答 */
      stats: function () {
        return {
          calls: stats.calls, played: stats.played, fallback: stats.fallback,
          muted: stats.muted, offRange: stats.offRange, sfxOff: stats.sfxOff,
          audioError: stats.audioError, decodeFail: stats.decodeFail,
          decoded: stats.decoded, lastReason: stats.lastReason,
          lastSec: stats.lastSec, lastError: stats.lastError,
          fallbackRate: stats.calls ? +(stats.fallback / stats.calls).toFixed(3) : 0
        };
      }
    };
  }

  return { create: create, DEFAULTS: DEFAULTS, SAMPLE_MIME: SAMPLE_MIME,
    sampleBase64: function () { return SAMPLE_B64; } };
}));
