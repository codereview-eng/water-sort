/* 身份/地区/语言 core：i18n 回退链 + geo 合规白名单（issue #1 · S13/S14）
   纪律：字典文件即配置——语言集/文案全在 config，core 只实现 RFC 4647
   lookup 式回退链（具体 locale → 基础语言 → 默认语言）；默认语言必须
   100% 全量（加载期校验，回退链最后保证）；回退触发记 telemetry。
   geo：国家决策链一份代码（override → tg 语言区域 → navigator 区域），
   白名单/黑名单纯 config；未知 mode/空名单一律加载期抛错。
   浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LocaleCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fail(msg) { throw new Error('locale config: ' + msg); }

  // ---- S13 i18n：{ default, locales: { <tag>: { key: text } } } ----
  var I18N_KEYS = ['default', 'locales'];

  function createI18n(cfg) {
    if (cfg == null) {
      // 不配置 = 无此系统：任何取词都是配置错误
      return {
        enabled: false,
        locales: function () { return []; },
        misses: function () { return []; },
        t: function () { throw new Error('locale: i18n 未配置'); }
      };
    }
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('i18n 必须是对象');
    for (var k in cfg) if (I18N_KEYS.indexOf(k) === -1) fail('i18n 未知键 "' + k + '"（合法键：' + I18N_KEYS.join('、') + '）');
    var def = cfg['default'];
    if (typeof def !== 'string' || !def) fail('i18n.default 必须是语言标签');
    var locales = cfg.locales;
    if (typeof locales !== 'object' || locales === null || Array.isArray(locales)) fail('i18n.locales 必须是对象');
    if (!locales[def]) fail('默认语言 "' + def + '" 字典缺失');
    Object.keys(locales).forEach(function (loc) {
      var dict = locales[loc];
      if (typeof dict !== 'object' || dict === null || Array.isArray(dict)) fail('locales["' + loc + '"] 必须是字典对象');
      Object.keys(dict).forEach(function (key) {
        if (typeof dict[key] !== 'string') fail('locales["' + loc + '"]["' + key + '"] 必须是字符串');
        if (!(key in locales[def])) fail('key "' + key + '"（' + loc + '）不在默认语言字典——默认语言必须全量');
      });
    });
    var misses = [];
    return {
      enabled: true,
      locales: function () { return Object.keys(locales); },
      misses: function () { return misses.slice(); },
      // 回退链：具体 locale → 基础语言（截断区域）→ 默认语言
      t: function (locale, key) {
        if (!(key in locales[def])) throw new Error('locale: 未知 key "' + key + '"（默认语言全量集之外）');
        var base = String(locale || '').split(/[-_]/)[0];
        var chain = [locale, base, def];
        for (var i = 0; i < chain.length; i++) {
          var l = chain[i];
          if (l && locales[l] && key in locales[l]) {
            if (l !== locale) misses.push({ locale: locale, key: key, usedFallback: l });
            return locales[l][key];
          }
        }
        /* istanbul: unreachable —— 默认语言全量校验兜底 */
      }
    };
  }

  // ---- S14 geo：国家决策链（一份代码）+ 名单在配置 ----
  function regionOf(tag) {
    var m = /[-_]([A-Za-z]{2})$/.exec(String(tag || ''));
    return m ? m[1].toUpperCase() : null;
  }

  /* ---- 语言选择：把「用哪种语言」这条决策链做成一份共用代码 ----
     优先级（与 water.html 既有实现同源，抽到 core 供两个游戏共用）：
       ?lang=xx 调试参数（最高，仅本次会话，不写持久化）
       → saved 手动选择（持久化）
       → Telegram 客户端语言
       → 浏览器语言
       → 默认语言
     available = 可用语言标签数组（取自 i18n 字典键）。
     匹配规则同 RFC 4647 lookup：先精确命中，再按基础语言（截断区域）命中，
     所以 'zh-CN' 能落到 'zh'、'en-US' 能落到 'en'。 */
  function matchLang(want, available) {
    if (!want) return null;
    var tag = String(want);
    if (available.indexOf(tag) !== -1) return tag;
    var base = tag.split(/[-_]/)[0].toLowerCase();
    for (var i = 0; i < available.length; i++) {
      if (String(available[i]).split(/[-_]/)[0].toLowerCase() === base) return available[i];
    }
    return null;
  }

  /* ---- 语言持久化通道（2026-08-29）----
     只写 localStorage 不够：内嵌 webview（coder webview / WKWebView 非持久化 data store /
     带 sandbox 的 iframe）里，写入可能抛异常、被静默丢弃，或者「写得进也读得回，但一刷新
     就是一份全新的空存储」。最后这种形态任何 write-then-read 自检都测不出来，
     所以手动选的语言一律同时镜像进 URL hash（#lang=xx）——刷新必然带着 hash，
     是唯一跨刷新一定还在的通道。hash 里其余参数（#autostart / tgWebAppData…）原样保留。 */
  function splitHash(hash) {
    var s = String(hash == null ? '' : hash).replace(/^#/, '');
    return s === '' ? [] : s.split('&');
  }

  /* 从 location.hash 里取语言；没有则 null */
  function hashLang(hash) {
    var parts = splitHash(hash);
    for (var i = 0; i < parts.length; i++) {
      var m = /^lang=([A-Za-z-]+)$/.exec(parts[i]);
      if (m) return m[1];
    }
    return null;
  }

  /* 把语言写进 hash 字符串（幂等：已有的 lang= 被替换，其它参数保持原顺序） */
  function withHashLang(hash, lang) {
    var kept = [];
    splitHash(hash).forEach(function (p) { if (!/^lang=/.test(p)) kept.push(p); });
    kept.push('lang=' + String(lang));
    return '#' + kept.join('&');
  }

  /* 读回当前已保存的语言：hash 优先（跨刷新可靠），其次 localStorage 镜像 */
  function readSavedLang(win, key) {
    var out = { hash: null, local: null, value: null };
    try { out.hash = hashLang(win.location.hash); } catch (e) {}
    try { out.local = win.localStorage.getItem(key); } catch (e) {}
    out.value = out.hash || out.local;
    return out;
  }

  /* 落盘：两条通道都写，各自读回验证，失败带异常本体大声记日志（禁裸 catch 静默降级）。
     返回 { lang, local, hash, err_name, err_msg }，调用方可据此做可观测/上报。 */
  function persistLang(win, key, lang, log) {
    var report = { lang: String(lang), local: false, hash: false, err_name: '', err_msg: '' };
    function note(e, name) {
      if (report.err_name) return;
      report.err_name = name || (e && e.name) || 'Error';
      report.err_msg = String((e && e.message) != null ? (e && e.message) : e).slice(0, 200);
    }
    try {
      win.localStorage.setItem(key, report.lang);
      report.local = win.localStorage.getItem(key) === report.lang;  // setItem 不抛 ≠ 写成功
      if (!report.local) note(null, 'StorageReadBackMismatch');
    } catch (e) { note(e); }
    try {
      var next = withHashLang(win.location.hash, report.lang);
      try {
        // replaceState：不新增历史项、不触发导航；被沙箱禁掉时退回直接改 hash
        if (win.history && win.history.replaceState) win.history.replaceState(null, '', next);
        else win.location.hash = next;
      } catch (e2) { note(e2); win.location.hash = next; }
      report.hash = hashLang(win.location.hash) === report.lang;
      if (!report.hash) note(null, 'HashReadBackMismatch');
    } catch (e3) { note(e3); }
    if (!report.local || !report.hash) {
      try {
        var w = log || (win.console && win.console.warn && win.console.warn.bind(win.console));
        if (w) w('[lang] persist degraded', report);
      } catch (e4) {}
    }
    return report;
  }

  function resolveLang(inputs, available, def) {
    inputs = inputs || {};
    if (!Array.isArray(available) || available.length === 0) fail('resolveLang: available 必须是非空数组');
    if (available.indexOf(def) === -1) fail('resolveLang: 默认语言 "' + def + '" 不在 available 里');
    var q = /[?&]lang=([A-Za-z-]+)/.exec(inputs.search || '');
    /* 顺序（owner 拍板 2026-08-29）：**云端 > 本地存储 > URL**。
       云端那份不在本函数里——它是登录后异步拿到的，由页面在云档回来时覆盖当前语言（权威）；
       本函数只负责首屏这一刻的本地决策，因此这里的链首是本地存储，其次才是 URL。
       为什么 URL 垫底：?lang= 本意是调试参数，但宿主（内嵌 webview / 壳页面）
       按固定地址装载游戏时会把它一并带上，排在前面就会把玩家的选择每次顶掉——
       表现就是「改完重进又变回去」（2026-08-29 headless 复现确证）。
       调试用途不受影响：干净环境里本来就没有已保存的选择。
       hash 垫在本地存储之后、URL 参数之前：它是本地存储被清掉时的兜底镜像。 */
    var chain = [inputs.saved, hashLang(inputs.hash), q && q[1], inputs.tgLanguageCode, inputs.navigatorLanguage];
    for (var i = 0; i < chain.length; i++) {
      var hit = matchLang(chain[i], available);
      if (hit) return hit;
    }
    return def;
  }

  /* HTML lang 属性值：zh → zh-CN，其它原样（给 <html lang> 用，影响字体/断行/朗读） */
  function htmlLang(tag) {
    return String(tag) === 'zh' ? 'zh-CN' : String(tag);
  }

  function resolveCountry(inputs) {
    inputs = inputs || {};
    if (inputs.override) return String(inputs.override).toUpperCase();
    return regionOf(inputs.tgLanguageCode) || regionOf(inputs.navigatorLanguage) || 'ZZ';
  }

  var GEO_MODES = ['all', 'allowlist', 'denylist'];
  var GEO_KEYS = ['mode', 'countries'];

  function createGeoAllow(cfg) {
    if (cfg == null) cfg = { mode: 'all' };
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('geo 必须是对象');
    for (var k in cfg) if (GEO_KEYS.indexOf(k) === -1) fail('geo 未知键 "' + k + '"（合法键：' + GEO_KEYS.join('、') + '）');
    if (GEO_MODES.indexOf(cfg.mode) === -1) fail('未知 geo mode "' + cfg.mode + '"（合法：' + GEO_MODES.join('、') + '）');
    if (cfg.mode === 'all') {
      if (cfg.countries !== undefined) fail('geo mode=all 不接受 countries');
    } else {
      if (!Array.isArray(cfg.countries) || cfg.countries.length === 0) fail('geo ' + cfg.mode + ' 名单必须是非空数组');
      cfg.countries.forEach(function (c) {
        if (typeof c !== 'string' || !/^[A-Z]{2}$/.test(c)) fail('geo 名单项 "' + c + '" 必须是两位大写国家码');
      });
    }
    return function allowed(country) {
      if (cfg.mode === 'all') return true;
      var hit = cfg.countries.indexOf(country) !== -1;
      return cfg.mode === 'allowlist' ? hit : !hit;
    };
  }

  return {
    createI18n: createI18n,
    resolveCountry: resolveCountry,
    createGeoAllow: createGeoAllow,
    GEO_MODES: GEO_MODES,
    resolveLang: resolveLang,
    matchLang: matchLang,
    htmlLang: htmlLang,
    hashLang: hashLang,
    withHashLang: withHashLang,
    readSavedLang: readSavedLang,
    persistLang: persistLang
  };
});
