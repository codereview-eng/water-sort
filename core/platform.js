/* run.ceo Play SDK 平台接入 core（SDK 契约：https://play-<slug>.run.ceo/__sdk/v1.md）
   纪律（与 shell/home/reward 同一 CDUI 定形）：
   - 游戏只写声明式 config（game.config.json 的 platform 段：实体名/字段映射/登录引导阈值），
     加载、登录、云存档合并、同步节流全部在本模块，游戏侧零平台细节。
   - §0 两行接入：SDK 从同源 /__sdk/v1.js 动态加载，slug/origin 一律由 Play.init() 推断，
     本模块不硬编码 slug/origin/token，代码里永远没有任何 secret（红线 1）。
   - 匿名可玩优先（红线 2）：SDK 缺失（file://、artifact 面）或未登录一律降级 local 模式，
     游戏照常用 localStorage；写云档收到 401 才引导 play.login()。
   - 纯函数层（config 校验/字段合并/登录引导判定）Node 可测；浏览器胶水（loadSdk/connect）薄壳。
   浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MERGE = ['max', 'newest'];
  var RESERVED = ['updated_ms', 'id', 'created_by', 'created_date', 'updated_date'];

  function fail(msg) { throw new Error('platform config: ' + msg); }

  /* ---------- 纯函数层 ---------- */

  function create(cfg) {
    if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) fail('必须是对象，得到 ' + JSON.stringify(cfg));
    if (typeof cfg.entity !== 'string' || !cfg.entity) fail('entity 必须是非空字符串');
    var promptAfter = cfg.loginPromptAfterClears;
    if (promptAfter === undefined) promptAfter = 3;
    if (typeof promptAfter !== 'number' || !isFinite(promptAfter) || promptAfter < 0 || promptAfter !== Math.floor(promptAfter)) {
      fail('loginPromptAfterClears 必须是 >=0 的整数，得到 ' + JSON.stringify(cfg.loginPromptAfterClears));
    }
    if (typeof cfg.fields !== 'object' || cfg.fields === null || Object.keys(cfg.fields).length === 0) {
      fail('fields 必须是非空对象（saveKey → {col, merge}）');
    }
    var cols = {};
    Object.keys(cfg.fields).forEach(function (key) {
      var f = cfg.fields[key];
      if (typeof f !== 'object' || f === null) fail('fields.' + key + ' 必须是对象');
      if (typeof f.col !== 'string' || !f.col) fail('fields.' + key + '.col 必须是非空字符串');
      if (RESERVED.indexOf(f.col) !== -1) fail('fields.' + key + '.col "' + f.col + '" 是保留列名');
      if (MERGE.indexOf(f.merge) === -1) fail('fields.' + key + '.merge 必须是 ' + MERGE.join('|') + '，得到 ' + JSON.stringify(f.merge));
      if (cols[f.col]) fail('fields.' + key + '.col "' + f.col + '" 与 ' + cols[f.col] + ' 重复');
      cols[f.col] = key;
    });

    var fields = cfg.fields;

    /* 本地 save（游戏形状）→ 云端行（列形状）；nowMs 落 updated_ms */
    function toRow(save, nowMs) {
      if (typeof nowMs !== 'number' || !isFinite(nowMs)) fail('toRow nowMs 必须是有限数');
      var row = { updated_ms: nowMs };
      Object.keys(fields).forEach(function (key) {
        if (save[key] !== undefined) row[fields[key].col] = save[key];
      });
      return row;
    }

    /* 云端行 → 本地 save 补丁（只带映射内且非 undefined 的键） */
    function fromRow(row) {
      var patch = {};
      Object.keys(fields).forEach(function (key) {
        var v = row ? row[fields[key].col] : undefined;
        if (v !== undefined && v !== null) patch[key] = v;
      });
      return patch;
    }

    /* 合并：local = 游戏当前 save（需带 updatedMs 本地时间戳），row = 云端行或 null。
       max 字段取两边较大（进度只进不退）；newest 字段按 updated_ms/updatedMs 判新。
       opts.localFresh=true 表示本地档没有实际游玩痕迹（换设备刚初始化就登录的场景）——
       此时本地时间戳虽新但只是默认值，newest 一律云端优先，防止默认档反向覆盖云档。
       空字符串视为缺值（如未设置的昵称），不参与覆盖。
       返回 {save, dirtyCloud}：save 是合并后的本地形状；dirtyCloud=true 表示云端需要回写。 */
    function mergeSave(local, row, opts) {
      if (!row) return { save: local, dirtyCloud: true };
      var cloudTs = typeof row.updated_ms === 'number' ? row.updated_ms : 0;
      var localTs = typeof local.updatedMs === 'number' ? local.updatedMs : 0;
      var cloudNewer = (opts && opts.localFresh) ? true : cloudTs > localTs;
      var merged = {};
      Object.keys(local).forEach(function (k) { merged[k] = local[k]; });
      var dirtyCloud = false;
      Object.keys(fields).forEach(function (key) {
        var col = fields[key].col;
        var lv = local[key];
        var cv = row[col];
        if (lv === '') lv = undefined;
        if (cv === '') cv = undefined;
        var out;
        if (cv === undefined || cv === null) out = lv;
        else if (lv === undefined || lv === null) out = cv;
        else if (fields[key].merge === 'max' && typeof lv === 'number' && typeof cv === 'number') out = Math.max(lv, cv);
        else out = cloudNewer ? cv : lv;
        if (out !== undefined) merged[key] = out;
        if (out !== cv) dirtyCloud = true;
      });
      return { save: merged, dirtyCloud: dirtyCloud };
    }

    /* 登录引导判定：匿名玩满 promptAfter 盘且本会话没提示过才提示；0 = 永不主动提示 */
    function shouldPromptLogin(state) {
      if (typeof state !== 'object' || state === null) fail('shouldPromptLogin state 必须是对象');
      if (state.prompted) return false;
      if (promptAfter === 0) return false;
      return (state.clears || 0) >= promptAfter;
    }

    return {
      entity: cfg.entity,
      loginPromptAfterClears: promptAfter,
      toRow: toRow,
      fromRow: fromRow,
      mergeSave: mergeSave,
      shouldPromptLogin: shouldPromptLogin
    };
  }

  /* ---------- 浏览器胶水层 ---------- */

  /* 同源动态加载 /__sdk/v1.js；非 http(s) 面（file://）或加载失败/超时 → null（降级 local） */
  function loadSdk(opts) {
    opts = opts || {};
    if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
    if (window.Play) return Promise.resolve(window.Play);
    if (window.location.protocol !== 'https:' && window.location.protocol !== 'http:') return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; resolve(window.Play || null); } }
      var s = document.createElement('script');
      s.src = opts.sdkUrl || '/__sdk/v1.js';
      s.onload = finish;
      s.onerror = finish;
      setTimeout(finish, opts.timeoutMs || 6000);
      document.head.appendChild(s);
    });
  }

  /* 连接平台：永不 reject——一切不可用路径都归于 {mode:'local', reason}，游戏无脑继续本地玩。
     online 会话暴露 login/logout/loadCloud/saveCloud/queueSync/on。 */
  function connect(cfg, opts) {
    opts = opts || {};
    var P = create(cfg);
    function local(reason, user) {
      return { mode: 'local', reason: reason, user: user || null, core: P };
    }
    return loadSdk(opts).then(function (Play) {
      if (!Play) return local('SDK_UNAVAILABLE');
      return Play.init(opts.init || {}).then(function (play) {
        var table = play.db && play.db[P.entity];
        if (!table) return local('ENTITY_UNDECLARED', play.user);
        var rowId = null;
        var timer = null;
        var session = {
          mode: 'online',
          reason: null,
          core: P,
          user: play.user,
          play: play,
          login: function () { return play.login(); },
          logout: function () { play.logout(); },
          on: function (ev, fn) { return play.on(ev, fn); },
          /* 拉取本玩家最新云档行（owner 隔离由服务端裁决） */
          loadCloud: function () {
            return table.list('-updated_ms', 1).then(function (rows) {
              rowId = rows && rows[0] ? rows[0].id : null;
              return rows && rows[0] ? rows[0] : null;
            });
          },
          /* 回写云档：已有行 update，否则 create 并缓存行 id */
          saveCloud: function (save, nowMs) {
            var row = P.toRow(save, typeof nowMs === 'number' ? nowMs : Date.now());
            if (rowId) return table.update(rowId, row);
            return table.create(row).then(function (created) {
              rowId = created.id;
              return created;
            });
          },
          /* 防抖云同步：persist() 单点调用；未登录/401/网络失败不打断游戏。
             onError(err) 可选；401 时置匿名并触发 onAuthLost。 */
          queueSync: function (getSave, hooks) {
            hooks = hooks || {};
            if (!session.user) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(function () {
              timer = null;
              Promise.resolve().then(function () { return session.saveCloud(getSave()); })
                .catch(function (err) {
                  if (err && err.status === 401) {
                    session.user = null;
                    if (hooks.onAuthLost) hooks.onAuthLost(err);
                  } else if (err && err.retryable && !hooks.__retried) {
                    setTimeout(function () { session.queueSync(getSave, { onAuthLost: hooks.onAuthLost, onError: hooks.onError, __retried: true }); }, 5000);
                  } else if (hooks.onError) hooks.onError(err);
                });
            }, opts.syncDebounceMs || 1500);
          },
          /* 页面隐藏前尽力冲刷未落的同步 */
          flush: function (getSave) {
            if (!session.user || !timer) return;
            clearTimeout(timer); timer = null;
            Promise.resolve().then(function () { return session.saveCloud(getSave()); }).catch(function () {});
          }
        };
        return session;
      }).catch(function (err) {
        return local((err && err.code) || 'INIT_FAILED');
      });
    });
  }

  return { create: create, loadSdk: loadSdk, connect: connect };
});
