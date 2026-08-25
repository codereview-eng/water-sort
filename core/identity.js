/* 单栏身份 core：首页「我是谁 + 进度存哪 + 能做什么」的唯一判定处

   背景（为什么有这个模块）：首页原来有两行身份——「玩家名称」行（浏览器本机化名，可点着改）
   和「run.ceo 账号」行（登录状态），同一个人显示两个名字、两个动作，用户分不清哪个算。
   本模块把三件事收成一个纯函数结论：显示哪个名字、名字下面那句说什么、右侧给哪个动作。

   两条硬规则（用户 2026-08-19 定案）：
   1) 身份来源只有两档：浏览器本机缓存 与 run.ceo 平台云端（不做 Telegram 那一路）。
   2) 游戏内不提供本地改名。改名只能改 run.ceo 上「本游戏的云端名称」，入口是**跳转**平台
      改名页（形态就是顶层跳转，不做弹窗/iframe）。未登录/离线/未设正式名时显示不可编辑的
      「临时名」。

   平台契约依据（https://play-<slug>.run.ceo/__sdk/v1.md 的 play-nickname-contract 区）：
   - `play.user` = {id, name?}，`name` 只用于展示、可缺失、不得作授权或唯一键；
     滚动升级期调用方必须容忍 name 缺失 —— 所以 resolve() 把空名字一律当「没有云端名」。
   - 改名选择器由 run.ceo 渲染，`gameOriginMayRenderSelector: false`（游戏源自渲染算违规）。
   - 改名页 path `/coder/play/nickname`，`scopeParam: scope`（perGame|global），
     `globalOptInParam: global_opt_in` = '1'，`returnToParam: return_to`（必须同源），
     改名冷却 7 天。以上参数名以该契约为唯一权威，本模块不自造别名。
   - 契约缺口（实测 2026-08-19）：契约 JSON 未声明 slug 参数，但改名页实际读它——
     未传时 302 回跳链里回显 `slug=` 空值。故本模块按实测传 slug（值取自 `play.slug`，
     SDK 单一来源，不硬编码），并已把「契约补 slugParam」列入给平台方的需求。

   文案不在本模块：resolve() 只给出语义状态与 i18n key，具体中英文案由游戏侧 t() 提供，
   与 home/shell/reward 同一 CDUI 定形。浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IdentityCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MODES = ['pending', 'online', 'local'];
  var SCOPES = ['perGame', 'global'];
  var NICKNAME_PATH = '/coder/play/nickname';
  var RETURN_FLAG = 'renamed';

  function fail(msg) { throw new Error('identity: ' + msg); }

  function trimmed(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  /* 名字的唯一优先级链：run.ceo 本游戏云端名 › 浏览器临时名 › 默认名（i18n key）。
     注意 expired 态另有规则（保住上一次显示的名字，不跳回陌生名）。 */
  function resolve(state) {
    if (typeof state !== 'object' || state === null || Array.isArray(state)) {
      fail('resolve state 必须是对象，得到 ' + JSON.stringify(state));
    }
    var mode = state.mode;
    if (MODES.indexOf(mode) === -1) {
      fail('resolve state.mode 必须是 ' + MODES.join('|') + '，得到 ' + JSON.stringify(mode));
    }

    var cloudName = state.user ? trimmed(state.user.name) : '';
    var tempName = trimmed(state.tempName);
    var lastName = trimmed(state.lastName);
    var defaultKey = typeof state.defaultKey === 'string' && state.defaultKey ? state.defaultKey : 'me';

    function view(o) {
      return {
        state: o.state,
        name: o.name || '',
        /* 名字为空时游戏侧用 nameKey 兜底渲染（永不渲染空名字） */
        nameKey: o.name ? null : defaultKey,
        nameKind: o.name ? o.nameKind : 'fallback',
        sourceKey: o.sourceKey || null,
        subKey: o.subKey,
        badge: o.badge,
        action: { kind: o.actionKind, labelKey: o.actionLabelKey || null }
      };
    }

    /* S1 平台连接中：名字位留白（游戏侧渲染骨架），但副标题必须说清进度暂存哪。
       不在这一态显示「未登录」，免得连上后名字/状态闪一下。 */
    if (mode === 'pending') {
      return {
        state: 'pending', name: '', nameKey: null, nameKind: 'none', sourceKey: null,
        subKey: 'idSubPending', badge: 'off', action: { kind: 'none', labelKey: null }
      };
    }

    /* S6 环境不支持云存档（file:// / 预览页 / SDK 不可用）：既没有登录也没有改名，
       因为名字只能在云端改，离线环境本就改不了——给按钮等于骗点击。 */
    if (mode === 'local') {
      return view({
        state: 'unsupported', name: tempName, nameKind: 'temp',
        sourceKey: tempName ? 'idSrcTemp' : null,
        subKey: 'idSubUnsupported', badge: 'off', actionKind: 'none'
      });
    }

    /* S5 登录过期：保住上一次显示的名字（没有就退回临时名），转警示态要求重新登录。
       进度不丢，只是新进度暂存本浏览器。 */
    if (state.expired && !state.user) {
      var keep = lastName || tempName;
      return view({
        state: 'expired', name: keep, nameKind: 'stale',
        /* 过期时显示的名字通常是过期前那个云端名——来源标签要照实说 run.ceo，
           标成「临时名」会误导（用户会以为云端名丢了）。只有回落到本机临时名时才标临时名。 */
        sourceKey: keep ? (lastName ? 'idSrcCloud' : 'idSrcTemp') : null,
        subKey: 'idSubExpired', badge: 'warn', actionKind: 'relogin', actionLabelKey: 'idActRelogin'
      });
    }

    /* S2 未登录：临时名（自动生成、不可编辑），唯一动作是登录 */
    if (!state.user) {
      return view({
        state: 'anon', name: tempName, nameKind: 'temp',
        sourceKey: tempName ? 'idSrcTemp' : null,
        subKey: 'idSubAnon', badge: 'off', actionKind: 'login', actionLabelKey: 'idActLogin'
      });
    }

    /* S3 已登录且平台给了名字：云端名是唯一真相，点整行进账号面板 */
    if (cloudName) {
      return view({
        state: 'cloud', name: cloudName, nameKind: 'cloud', sourceKey: 'idSrcCloud',
        subKey: 'idSubCloud', badge: 'ok', actionKind: 'panel'
      });
    }

    /* S4 已登录但平台还没给名字（契约允许 name 缺失）：临时名顶着 + 去平台改名 */
    return view({
      state: 'cloudTemp', name: tempName, nameKind: 'temp',
      sourceKey: tempName ? 'idSrcTemp' : null,
      subKey: 'idSubCloudTemp', badge: 'ok', actionKind: 'rename', actionLabelKey: 'idActRename'
    });
  }

  /* 头像首字：按码点取，避免把 emoji 名字截成半个代理对 */
  function avatarChar(name) {
    var s = typeof name === 'string' ? name : '';
    return Array.from(s)[0] || '';
  }

  function assertAbsoluteHttp(url, what) {
    if (typeof url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(url)) {
      fail(what + ' 必须是绝对 http(s) 地址（契约要求同源回跳），得到 ' + JSON.stringify(url));
    }
  }

  /* 改名跳转地址：参数名逐个对齐平台 nickname 契约，游戏侧不得另起别名。
     scope 默认 perGame（只改本游戏的名称）；global 按契约必须显式带 global_opt_in=1。 */
  function renameUrl(opts) {
    if (typeof opts !== 'object' || opts === null) fail('renameUrl opts 必须是对象');
    var apex = typeof opts.apex === 'string' ? opts.apex.replace(/\/+$/, '') : '';
    assertAbsoluteHttp(apex, 'renameUrl apex');
    var slug = trimmed(opts.slug);
    if (!slug) fail('renameUrl slug 必须是非空字符串（取自 play.slug，勿硬编码）');
    var scope = opts.scope === undefined ? 'perGame' : opts.scope;
    if (SCOPES.indexOf(scope) === -1) {
      fail('renameUrl scope 必须是 ' + SCOPES.join('|') + '，得到 ' + JSON.stringify(scope));
    }
    assertAbsoluteHttp(opts.returnTo, 'renameUrl returnTo');

    var qs = 'slug=' + encodeURIComponent(slug) +
      '&scope=' + encodeURIComponent(scope) +
      (scope === 'global' ? '&global_opt_in=1' : '') +
      '&return_to=' + encodeURIComponent(opts.returnTo);
    return apex + NICKNAME_PATH + '?' + qs;
  }

  /* 回跳标记：改完名字回到游戏时要认得出来，才能刷新身份并给一次性反馈。
     用 query 而非 fragment——fragment 被 SDK 的 token 拾取逻辑占用（#play_token=）。 */
  function markReturn(url) {
    assertAbsoluteHttp(url, 'markReturn url');
    var u = new URL(url);
    u.searchParams.set(RETURN_FLAG, '1');
    return u.toString();
  }

  function takeRenameFlag(url) {
    assertAbsoluteHttp(url, 'takeRenameFlag url');
    var u = new URL(url);
    if (u.searchParams.get(RETURN_FLAG) === null) return { renamed: false, cleanUrl: url };
    u.searchParams.delete(RETURN_FLAG);
    return { renamed: true, cleanUrl: u.toString() };
  }

  /* 改完名字回来，名字到底变了没：三态明确，绝不静默当成功。
     - applied：确实变了，报喜；
     - stale：回来了但名字没变（平台侧刷新未生效/仍是旧令牌快照）——必须让用户分辨得出，
       并且 warn=true 供游戏侧记 warn 日志与降级计数，不允许无声吞掉；
     - unknown：拿不到新名字（未登录/读取失败），同样不谎报成功。 */
  function renameOutcome(o) {
    if (typeof o !== 'object' || o === null) fail('renameOutcome 参数必须是对象');
    var before = trimmed(o.before);
    var after = o.after === null || o.after === undefined ? null : trimmed(o.after);
    if (after === null || after === '') {
      return { status: 'unknown', msgKey: 'idRenameUnknown', warn: true };
    }
    if (after !== before) {
      return { status: 'applied', msgKey: 'idRenameApplied', warn: false, name: after };
    }
    return { status: 'stale', msgKey: 'idRenameStale', warn: true, name: after };
  }

  /* 改名降级的可观测性核心（本机硬纪律：降级分支必须可计数 + 反向阈值告警）。
     单条 warn 日志回答不了「最近发生多少次、是不是常态化了」，而改名降级恰恰是
     「HTTP 正常、无异常抛出、功能却没生效」那一类——只能靠反向阈值发现：
     连续降级达到阈值本身就是故障信号（多半是平台侧名字刷新一直没生效）。

     纯函数：不碰 storage，由调用方把上次的记录传进来、把返回值存回去，因此可单测。
     入参 o: { prev: 上次记录|null, outcome: renameOutcome 结果, at: 时间戳, threshold?: 连续几次告警(默认3) }
     返回: { streak 连续降级次数, total 累计降级次数, firstAt, lastAt, lastStatus, alert 是否该告警 } */
  function trackRenameDegrade(o) {
    if (typeof o !== 'object' || o === null) fail('trackRenameDegrade 参数必须是对象');
    var outcome = o.outcome;
    if (typeof outcome !== 'object' || outcome === null) fail('trackRenameDegrade 需要 outcome');
    var prev = (typeof o.prev === 'object' && o.prev !== null) ? o.prev : {};
    var at = typeof o.at === 'number' ? o.at : 0;
    var threshold = typeof o.threshold === 'number' && o.threshold > 0 ? o.threshold : 3;
    var total = typeof prev.total === 'number' && prev.total >= 0 ? prev.total : 0;
    if (!outcome.warn) {
      /* 成功一次就把连续计数清零，但保留 total：不然「偶尔成功」会把常态化降级洗白 */
      return { streak: 0, total: total, firstAt: prev.firstAt || null, lastAt: prev.lastAt || null,
        lastStatus: outcome.status || 'applied', alert: false };
    }
    var streak = (typeof prev.streak === 'number' && prev.streak >= 0 ? prev.streak : 0) + 1;
    return {
      streak: streak,
      total: total + 1,
      firstAt: prev.firstAt || at || null,
      lastAt: at || null,
      lastStatus: outcome.status || 'unknown',
      alert: streak >= threshold
    };
  }

  /* 系统临时名 = 语言前缀 + 随机序号。切语言时只替换已知系统前缀；
     用户自己设置的名称和云端名称一律原样保留。 */
  var DEFAULT_ALIAS_RE = /^(?:玩家|Player)\s*(\d{3,6})$/;
  function aliasSeed(alias) {
    var m = DEFAULT_ALIAS_RE.exec(String(alias == null ? '' : alias).trim());
    return m ? m[1] : null;
  }
  function localizeAlias(alias, label) {
    var seed = aliasSeed(alias);
    if (seed === null) return String(alias == null ? '' : alias);
    return String(label == null ? '' : label) + seed;
  }

  return {
    resolve: resolve,
    avatarChar: avatarChar,
    aliasSeed: aliasSeed,
    localizeAlias: localizeAlias,
    trackRenameDegrade: trackRenameDegrade,
    renameUrl: renameUrl,
    markReturn: markReturn,
    takeRenameFlag: takeRenameFlag,
    renameOutcome: renameOutcome,
    NICKNAME_PATH: NICKNAME_PATH,
    RETURN_FLAG: RETURN_FLAG
  };
});
