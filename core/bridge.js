/* 桥接层 core：双宿主适配 + 存档 schema 版本迁移（issue #1 · S16/S17）
   纪律：core 只依赖 Host 合同（kind/userId/storageGet/storageSet），
   telegram/web 两个实现，启动探测一次选实现、之后不再判宿主；宿主判定
   是机制（代码），config 只放宿主参数（如 web 存档 key 前缀）。
   存档：load = 读 → 查 version → 顺序跑迁移链 → 默认值合并；save =
   version 戳 + 单 key 原子写。TG 环境缺关键能力、迁移链断裂、存档版本
   超前一律显式抛错，拒绝静默降级。浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BridgeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fail(msg) { throw new Error('bridge: ' + msg); }

  var HOST_CONTRACT = ['kind', 'userId', 'storageGet', 'storageSet'];

  // ---- S16 宿主探测（一次）与两实现 ----
  function detectHost(env) {
    return env && env.Telegram && env.Telegram.WebApp ? 'telegram' : 'web';
  }

  function createTelegramHost(webApp) {
    if (!webApp) fail('Telegram 宿主缺 WebApp 对象');
    var REQUIRED = ['initDataUnsafe', 'CloudStorage'];
    REQUIRED.forEach(function (m) {
      if (!webApp[m]) fail('Telegram WebApp 缺关键能力 "' + m + '"（版本过老），拒绝静默降级');
    });
    var user = webApp.initDataUnsafe.user;
    if (!user || user.id == null) fail('Telegram WebApp 缺 initDataUnsafe.user.id');
    return {
      kind: 'telegram',
      userId: function () { return String(user.id); },
      storageGet: function (k) { return webApp.CloudStorage.getItem(k); },
      storageSet: function (k, v) { webApp.CloudStorage.setItem(k, v); }
    };
  }

  var WEB_KEYS = ['storagePrefix'];

  function createWebHost(storage, cfg) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') fail('web 宿主需要 storage（getItem/setItem）');
    if (cfg == null) cfg = {};
    for (var k in cfg) if (WEB_KEYS.indexOf(k) === -1) fail('web 宿主配置未知键 "' + k + '"（合法键：' + WEB_KEYS.join('、') + '）');
    var prefix = cfg.storagePrefix === undefined ? '' : cfg.storagePrefix;
    if (typeof prefix !== 'string') fail('storagePrefix 必须是字符串');
    return {
      kind: 'web',
      userId: function () { return 'web-anon'; },
      storageGet: function (k) { return storage.getItem(prefix + k); },
      storageSet: function (k, v) { storage.setItem(prefix + k, v); }
    };
  }

  function assertHost(host) {
    HOST_CONTRACT.forEach(function (m) {
      var ok = m === 'kind' ? typeof host[m] === 'string' : typeof host[m] === 'function';
      if (!ok) fail('Host 合同缺 "' + m + '"');
    });
    return host;
  }

  // ---- S17 存档版本迁移：游戏声明 {version, migrations, defaults}，机制复用 ----
  var SAVE_KEYS = ['version', 'migrations', 'defaults', 'key'];

  function createSaveStore(cfg, host) {
    assertHost(host);
    if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) fail('save 配置必须是对象');
    for (var k in cfg) if (SAVE_KEYS.indexOf(k) === -1) fail('save 配置未知键 "' + k + '"（合法键：' + SAVE_KEYS.join('、') + '）');
    var version = cfg.version;
    if (!Number.isInteger(version) || version < 1) fail('save.version 必须是 >=1 的整数');
    var migrations = cfg.migrations || {};
    for (var v = 1; v < version; v++) {
      if (typeof migrations[v] !== 'function') fail('迁移链断裂：缺 ' + v + '→' + (v + 1) + ' 迁移函数');
    }
    Object.keys(migrations).forEach(function (mv) {
      var n = Number(mv);
      if (!Number.isInteger(n) || n < 1 || n >= version) fail('迁移表键 "' + mv + '" 超出 1..' + (version - 1) + ' 范围');
    });
    var defaults = cfg.defaults || {};
    var KEY = cfg.key === undefined ? 'save' : cfg.key;
    return {
      version: version,
      load: function () {
        var raw = host.storageGet(KEY);
        if (raw == null) return Object.assign({}, defaults, { __v: version });
        var env2;
        try { env2 = JSON.parse(raw); } catch (e) { throw new Error('bridge: 存档损坏（非法 JSON），拒绝静默重置'); }
        if (!Number.isInteger(env2.v) || env2.v < 1) throw new Error('bridge: 存档缺版本号，拒绝硬解析');
        if (env2.v > version) throw new Error('bridge: 存档版本 ' + env2.v + ' 超前当前 ' + version + '（可能是回滚场景），拒绝硬解析');
        var data = env2.data || {};
        for (var mv = env2.v; mv < version; mv++) data = migrations[mv](data);
        return Object.assign({}, defaults, data, { __v: version });
      },
      save: function (data) {
        if (typeof data !== 'object' || data === null) fail('存档必须是对象');
        host.storageSet(KEY, JSON.stringify({ v: version, data: data })); // 单 key 原子写
      }
    };
  }

  return {
    detectHost: detectHost,
    createTelegramHost: createTelegramHost,
    createWebHost: createWebHost,
    assertHost: assertHost,
    createSaveStore: createSaveStore,
    HOST_CONTRACT: HOST_CONTRACT
  };
});
