/* 广告播放层 core（所有游戏共用的「怎么放广告」）
   —— 补上原来缺的一环：core/placements.js 早就要求宿主注入 provider（「放一次广告，
   告诉我成功还是失败」），但**从来没人实现过 provider**，于是两个游戏的「看广告」
   按钮点了直接发奖，Telegram 和浏览器里都没有任何广告会出现（2026-08-21 线上实测：
   点按钮时广告 SDK 调用 0 次、外部请求 0 个、奖励立即到账）。这个文件就是那个 provider。

   分工纪律：
   - core 负责「按环境挑广告源 → 播放 → 回报成功/失败」这条链，所有游戏一模一样；
   - 用哪家广告、各广告位什么格式与失败策略、频控，全部由 config 声明（每游戏可不同）；
   - 奖励发放仍归宿主：core 只回报结果，**绝不代发奖**（避免"没看完也拿奖"）。

   config.sources 有两种写法（可混用）：
     简写   ['telegram', 'monetag', 'house']          —— zone/blockId 取顶层的
     完整   [{ type:'monetag', zoneId:'A', env:'telegram' },   —— 每个源带自己的
             { type:'monetag', zoneId:'B', env:'web' },
             { type:'house' }]
   env 限定运行环境：'telegram'（在 Telegram WebView 内）/ 'web'（普通浏览器）/ 省略=都行。
   这解决 Monetag 的现实约束：TMA zone 只对 Telegram 内流量有效，网页流量要用 Website zone。

   广告源（provider）优先级由 config.sources 声明，逐个尝试第一个可用的：
     'telegram'  Telegram Mini App 官方激励广告（window.Telegram.WebApp.showAd）
     'adsgram'   AdsGram（Telegram 生态最常用的第三方激励广告，需 blockId）
     'monetag'   Monetag Rewarded Interstitial（倒水线上已在用，需 zoneId；
                 SDK 会在 window 上挂 show_<zoneId>）
     'directlink' Monetag Direct Link：玩家点击后新标签打开广告主页面，按访问计费。
                 六种网站格式里唯一「玩家主动触发」的一种，所以是网页端奖励流程的现实解；
                 需 url，且只适合 env:'web'（Telegram WebView 里开外部标签体验很差）。
                 防刷用 placements 的 capping.maxPerDay，别把它当无限领奖入口。
     'house'     自家兜底"广告"：本地全屏倒计时卡（无外部依赖，永远可用）
     'none'      不放广告，直接算失败（配合 onFail:'grant' 可退回旧的白送行为）

   关键设计：**house 兜底默认开**。理由——广告位失败时游戏必须还能玩下去；
   但它是"真的要看完倒计时"的，不是点一下就给，所以奖励语义仍然成立。

   可观测（本机硬纪律：降级分支必须可观测 + 反向告警）：
   每次播放都产出 { ok, source, reason, ms }，并累计 stats()，
   宿主可据此发现"广告源常态化失败"（比如 100% 落到 house）。
   浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdPlayCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SOURCES = ['telegram', 'adsgram', 'monetag', 'directlink', 'house', 'none'];
  var DEFAULTS = {
    sources: ['telegram', 'adsgram', 'house'],   // 逐个尝试，取第一个当前环境可用的
    houseSeconds: 5,                              // 兜底广告卡的观看秒数
    timeoutMs: 20000                              // 单个广告源最长等待，超时算失败并降级
  };

  function fail(msg) { throw new Error('adplay config: ' + msg); }

  function create(cfg, deps) {
    if (cfg !== undefined && cfg !== null && (typeof cfg !== 'object' || Array.isArray(cfg))) {
      fail('config 必须是对象或省略');
    }
    var c = cfg || {};
    var rawSources = c.sources === undefined ? DEFAULTS.sources.slice() : c.sources;
    if (!Array.isArray(rawSources) || rawSources.length === 0) fail('sources 必须是非空数组');
    var ENVS = ['telegram', 'web'];
    /* 归一化：字符串简写 → 对象；对象校验 type/env。zone/blockId 缺省回落到顶层配置，
       这样老配置（简写 + 顶层 zoneId）行为完全不变。 */
    var sources = rawSources.map(function (item, i) {
      var o = typeof item === 'string' ? { type: item } : item;
      if (!o || typeof o !== 'object' || Array.isArray(o)) fail('sources[' + i + '] 必须是字符串或对象');
      if (SOURCES.indexOf(o.type) === -1) {
        fail('未知广告源 "' + o.type + '"（合法：' + SOURCES.join('、') + '）');
      }
      if (o.env !== undefined && ENVS.indexOf(o.env) === -1) {
        fail('sources[' + i + '].env 只能是 ' + ENVS.join(' 或 ') + '，得到 ' + JSON.stringify(o.env));
      }
      if (o.zoneId !== undefined && (typeof o.zoneId !== 'string' || !o.zoneId)) {
        fail('sources[' + i + '].zoneId 必须是非空字符串');
      }
      if (o.blockId !== undefined && (typeof o.blockId !== 'string' || !o.blockId)) {
        fail('sources[' + i + '].blockId 必须是非空字符串');
      }
      if (o.url !== undefined && !(typeof o.url === 'string' && /^https:\/\//.test(o.url))) {
        fail('sources[' + i + '].url 必须是 https:// 开头的字符串');
      }
      return o;
    });
    var houseSeconds = c.houseSeconds === undefined ? DEFAULTS.houseSeconds : c.houseSeconds;
    if (typeof houseSeconds !== 'number' || !isFinite(houseSeconds) || houseSeconds <= 0) {
      fail('houseSeconds 必须是正数');
    }
    var timeoutMs = c.timeoutMs === undefined ? DEFAULTS.timeoutMs : c.timeoutMs;
    if (typeof timeoutMs !== 'number' || !isFinite(timeoutMs) || timeoutMs <= 0) fail('timeoutMs 必须是正数');
    var blockId = c.blockId === undefined ? null : c.blockId;
    if (blockId !== null && (typeof blockId !== 'string' || !blockId)) fail('blockId 必须是非空字符串或省略');
    var zoneId = c.zoneId === undefined ? null : c.zoneId;   // Monetag zone（SDK 挂 window['show_'+zoneId]）
    if (zoneId !== null && (typeof zoneId !== 'string' || !zoneId)) fail('zoneId 必须是非空字符串或省略');
    var directUrl = c.directUrl === undefined ? null : c.directUrl;      // Direct Link 落地页
    if (directUrl !== null && !(typeof directUrl === 'string' && /^https:\/\//.test(directUrl))) {
      fail('directUrl 必须是 https:// 开头的字符串或省略');
    }

    var d = deps || {};
    var env = d.env || (typeof window !== 'undefined' ? window : {});
    var now = d.now || function () { return Date.now(); };
    /* houseAd 由宿主注入（它才知道怎么在自己的 UI 里画那张全屏卡）：
       约定 houseAd(seconds, done) → done(true) 表示看完、done(false) 表示中途放弃。
       没注入就等于 house 源不可用（降级到下一个源）。 */
    var houseAd = typeof d.houseAd === 'function' ? d.houseAd : null;
    /* loadSdk(zoneId) → Promise：宿主按需注入某个 Monetag zone 的 SDK 标签。
       没注入这个依赖时，只有页面 head 里已静态引入的那个 zone 可用。 */
    var loadSdk = typeof d.loadSdk === 'function' ? d.loadSdk : null;
    /* openUrl(url) → 打开外部链接，返回是否成功（被拦弹窗时应返回 false）。
       由宿主注入：只有它知道该用 window.open 还是 Telegram 的 openLink。 */
    var openUrl = typeof d.openUrl === 'function' ? d.openUrl : null;

    /* 每个源最终生效的 zone/blockId：源上写了用源上的，否则用顶层的 */
    function zoneOf(src) { return src.zoneId || zoneId; }
    function blockOf(src) { return src.blockId || blockId; }
    function urlOf(src) { return src.url || directUrl; }
    /* 当前是否在 Telegram WebView 内：以 initData / initDataUnsafe.user 为准
       （只判断 Telegram.WebApp 存在是不够的 —— 网页里也可能引了那个脚本）。 */
    function inTelegram() {
      var tg = env.Telegram && env.Telegram.WebApp;
      if (!tg) return false;
      if (typeof tg.initData === 'string' && tg.initData.length > 0) return true;
      return !!(tg.initDataUnsafe && tg.initDataUnsafe.user);
    }
    function envAllows(src) {
      if (!src.env) return true;
      return src.env === 'telegram' ? inTelegram() : !inTelegram();
    }

    var stats = { attempts: 0, ok: 0, failed: 0, bySource: {}, lastReason: null };
    function bump(source, ok, reason) {
      stats.attempts += 1;
      if (ok) stats.ok += 1; else { stats.failed += 1; stats.lastReason = reason || 'unknown'; }
      var s = stats.bySource[source] || (stats.bySource[source] = { ok: 0, failed: 0 });
      if (ok) s.ok += 1; else s.failed += 1;
    }

    /* 单个源可用吗：环境限定 + 该环境有没有这个能力（不做网络探测，避免拖慢首屏） */
    function canUse(src) {
      if (!envAllows(src)) return false;
      var tg = env.Telegram && env.Telegram.WebApp;
      if (src.type === 'telegram') return !!(tg && typeof tg.showAd === 'function');
      if (src.type === 'adsgram') return !!(env.Adsgram && typeof env.Adsgram.init === 'function' && blockOf(src));
      if (src.type === 'monetag') {
        var z = zoneOf(src);
        if (!z) return false;
        if (typeof env['show_' + z] === 'function') return true;
        return !!loadSdk;              // SDK 还没加载但宿主能按需加载 → 视为可用
      }
      if (src.type === 'directlink') return !!(urlOf(src) && typeof openUrl === 'function');
      if (src.type === 'house') return !!houseAd;
      return true;                     // none
    }
    /* 概览（诊断用）：按源类型汇总，并额外给出当前环境与逐源明细 */
    function availability() {
      var out = { telegram: false, adsgram: false, monetag: false, directlink: false,
        house: !!houseAd, none: true };
      sources.forEach(function (src) { if (canUse(src)) out[src.type] = true; });
      out.env = inTelegram() ? 'telegram' : 'web';
      out.detail = sources.map(function (src) {
        return { type: src.type, env: src.env || 'any', zone: zoneOf(src) || null, usable: canUse(src) };
      });
      return out;
    }

    function withTimeout(promise, source) {
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          resolve({ ok: false, reason: 'timeout' });
        }, timeoutMs);
        Promise.resolve(promise).then(function (r) {
          if (done) return;
          done = true; clearTimeout(timer);
          resolve(r);
        }, function (err) {
          if (done) return;
          done = true; clearTimeout(timer);
          resolve({ ok: false, reason: 'error:' + ((err && (err.name || err.message)) || 'unknown') });
        });
      });
    }

    function playTelegram() {
      var tg = env.Telegram.WebApp;
      return withTimeout(Promise.resolve(tg.showAd()).then(function (res) {
        /* Telegram 的返回形态各版本略有差异：显式失败/跳过一律按未看完处理，
           宁可不发奖，也不要"没看完也拿奖"。 */
        if (res === false) return { ok: false, reason: 'declined' };
        if (res && typeof res === 'object') {
          if (res.status && res.status !== 'ok' && res.status !== 'completed') {
            return { ok: false, reason: 'status:' + res.status };
          }
          if (res.completed === false) return { ok: false, reason: 'not-completed' };
        }
        return { ok: true };
      }), 'telegram');
    }

    function playAdsgram(src) {
      return withTimeout(new Promise(function (resolve, reject) {
        var ctl;
        try { ctl = env.Adsgram.init({ blockId: blockOf(src) }); } catch (e) { return reject(e); }
        if (!ctl || typeof ctl.show !== 'function') return reject(new Error('no-controller'));
        ctl.show().then(function () { resolve({ ok: true }); },
          function (e) { resolve({ ok: false, reason: 'adsgram:' + ((e && (e.description || e.error)) || 'failed') }); });
      }), 'adsgram');
    }

    /* Monetag：SDK 加载后在 window 上挂 show_<zoneId>，返回 Promise。
       它 resolve 即视为看完（Rewarded Interstitial 的语义），reject/抛错视为未完成。 */
    function playMonetag(src) {
      var z = zoneOf(src);
      return withTimeout(new Promise(function (resolve, reject) {
        var run = function () {
          var fn = env['show_' + z];
          if (typeof fn !== 'function') return resolve({ ok: false, reason: 'monetag:sdk-missing' });
          var out;
          try { out = fn(); } catch (e) { return reject(e); }
          Promise.resolve(out).then(function () { resolve({ ok: true }); },
            function (e) { resolve({ ok: false, reason: 'monetag:' + ((e && (e.message || e)) || 'failed') }); });
        };
        /* 按需加载该 zone 的 SDK：一个页面可能配了两个 zone（TMA 一个、Web 一个），
           只加载当前环境真要用的那个，避免把 TMA 的 SDK 塞给网页流量。 */
        if (typeof env['show_' + z] !== 'function' && loadSdk) {
          Promise.resolve(loadSdk(z)).then(run, function (e) {
            resolve({ ok: false, reason: 'monetag:sdk-load-failed:' + ((e && e.message) || '') });
          });
          return;
        }
        run();
      }), 'monetag');
    }

    /* Direct Link：打开落地页即视为完成一次（按访问计费，没有"看完"回调可依赖）。
       弹窗被浏览器拦下 → 判失败并降级，不能白发奖。 */
    function playDirectLink(src) {
      var url = urlOf(src);
      return withTimeout(new Promise(function (resolve) {
        if (!url) return resolve({ ok: false, reason: 'directlink:no-url' });
        var opened = false;
        try { opened = !!openUrl(url); } catch (e) {
          return resolve({ ok: false, reason: 'directlink:error:' + ((e && e.name) || 'unknown') });
        }
        resolve(opened ? { ok: true } : { ok: false, reason: 'directlink:blocked' });
      }), 'directlink');
    }

    function playHouse() {
      return withTimeout(new Promise(function (resolve) {
        houseAd(houseSeconds, function (watched) {
          resolve(watched ? { ok: true } : { ok: false, reason: 'skipped' });
        });
      }), 'house');
    }

    /* 播放一次广告：按 sources 顺序找到第一个可用源播放；
       该源失败（非用户主动放弃）时继续降级到下一个源；用户主动放弃则直接返回失败。 */
    function play() {
      var t0 = now();
      var queue = sources.filter(canUse);
      if (queue.length === 0) {
        bump('none', false, 'no-source');
        return Promise.resolve({ ok: false, source: 'none', reason: 'no-source', ms: 0 });
      }
      var i = 0;
      function step() {
        var src = queue[i];
        var source = src.type;
        if (source === 'none') {
          bump('none', false, 'disabled');
          return Promise.resolve({ ok: false, source: 'none', reason: 'disabled', ms: now() - t0 });
        }
        var p = source === 'telegram' ? playTelegram()
          : source === 'adsgram' ? playAdsgram(src)
          : source === 'monetag' ? playMonetag(src)
          : source === 'directlink' ? playDirectLink(src) : playHouse();
        return p.then(function (r) {
          if (r.ok) {
            bump(source, true);
            return { ok: true, source: source, zone: zoneOf(src) || null, ms: now() - t0 };
          }
          bump(source, false, r.reason);
          // 用户主动放弃 → 不再往下降级（他不是没广告可看，是不想看）
          if (r.reason === 'skipped' || r.reason === 'declined') {
            return { ok: false, source: source, reason: r.reason, ms: now() - t0 };
          }
          i += 1;
          if (i < queue.length) return step();
          return { ok: false, source: source, reason: r.reason, ms: now() - t0 };
        });
      }
      return step();
    }

    return {
      sources: sources.map(function (s) { return s.type; }),        // 兼容既有调用（只看类型）
      sourceList: sources.map(function (s) {                        // 完整声明（含 env/zone）
        return { type: s.type, env: s.env || 'any', zoneId: zoneOf(s) || null,
          blockId: blockOf(s) || null, url: urlOf(s) || null };
      }),
      inTelegram: inTelegram,
      houseSeconds: houseSeconds,
      blockId: blockId,
      zoneId: zoneId,
      availability: availability,
      play: play,
      stats: function () { return JSON.parse(JSON.stringify(stats)); },
      /* 把「播放」与 core/placements.js 的「频控 + onFail 策略」串起来。
         placements.show(id, state, now) 是同步的、内部调 provider 拿 boolean，
         而真实广告必然异步 —— 所以这里先 await 播放结果，再用一个「返回已知结果」的
         provider 驱动 placements，从而复用它的频控与 onFail 判定，不重写一遍。
         state 是该广告位的频控状态（宿主负责持久化），会原样回传给宿主保存。 */
      playPlacement: function (placementsCfg, id, state) {
        return play().then(function (r) {
          if (!placementsCfg) return { shown: r.ok, granted: r.ok, state: state || {}, ad: r };
          var out = placementsCfg.withProvider(function () { return r.ok; })
            .show(id, state || {}, now());
          return Object.assign({}, out, { ad: r });
        });
      }
    };
  }

  return { create: create, SOURCES: SOURCES, DEFAULTS: DEFAULTS };
});
