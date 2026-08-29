/* core/stock.js — 消耗品（道具）库存的单调账本
   为什么不用「库存数 + 按时间戳取新」（这正是 2026-08-20 线上 bug 的根因）：
   库存数是可增可减的量，跨设备合并时只能靠 updated_ms 判新；而 updated_ms 会被任何一次
   无关写入（体力恢复、昵称、音效开关、合并后的回写）刷新，"谁更新"与"谁的道具数对"完全脱钩。
   结果：任一端拿着旧的/默认的库存做一次无关保存，就把已扣减的正确值覆盖回去
   —— 玩家表现为「用了道具，重新登录又变回默认 N 个」。

   本模块改用 prior art 明确的做法（CRDT G-Counter / 会计式只增账本，Firebase、游戏经济
   系统里常见）：库存不直接存，改存两个**只增不减**的累计数：
     granted = 这个玩家累计获得过多少（初始赠送 + 通关奖励 + 看广告补充）
     spent   = 这个玩家累计消耗过多少
     stock   = max(0, granted - spent)
   两个累计数在云端一律用 max 合并（core/platform.js 已支持 merge:"max"），于是：
   - 任何合并顺序、任何时间戳漂移下，已消耗的道具都不会被云端复活（spent 只增）；
   - 离线获得的道具也不会被抹掉（granted 只增）；
   - 不需要事务、不需要服务端扣减，纯客户端即可保证「用了就一定减少」。

   纯函数、无 IO，浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StockCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fail(msg) { throw new Error('stock config: ' + msg); }

  function num(v) {
    var n = Number(v);
    return (typeof v === 'number' || typeof v === 'string') && isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  /* cfg = { items: { <key>: { granted, spent, legacy?, initial? } } }
     granted/spent = 存档里的字段名（同时也是 platform.fields 里以 max 合并的两列）
     legacy        = 旧版本用的「库存数」字段名，用于一次性迁移与向后兼容回写
     initial       = 新玩家初始赠送数量（默认 0）
     icon/name/desc = 纯展示元数据（背包窗口用）。都是可选：icon 缺省 '📦'、
                      name 缺省用 key 本身、desc 缺省空串。存档语义完全不依赖它们，
                      所以老配置不写也照常工作。 */
  function create(cfg) {
    if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) fail('必须是对象，得到 ' + JSON.stringify(cfg));
    if (typeof cfg.items !== 'object' || cfg.items === null || Object.keys(cfg.items).length === 0) {
      fail('items 必须是非空对象（道具 key → {granted, spent, legacy?, initial?}）');
    }
    var keys = Object.keys(cfg.items);
    var seen = {};
    keys.forEach(function (key) {
      var it = cfg.items[key];
      if (typeof it !== 'object' || it === null) fail('items.' + key + ' 必须是对象');
      ['granted', 'spent'].forEach(function (f) {
        if (typeof it[f] !== 'string' || !it[f]) fail('items.' + key + '.' + f + ' 必须是非空字符串');
        if (seen[it[f]]) fail('字段名 "' + it[f] + '" 被 ' + seen[it[f]] + ' 与 items.' + key + ' 重复占用');
        seen[it[f]] = 'items.' + key;
      });
      if (it.granted === it.spent) fail('items.' + key + ' 的 granted/spent 不能同名');
      if (it.legacy !== undefined && (typeof it.legacy !== 'string' || !it.legacy)) fail('items.' + key + '.legacy 必须是非空字符串');
      if (it.initial !== undefined && (typeof it.initial !== 'number' || !isFinite(it.initial) || it.initial < 0 || it.initial !== Math.floor(it.initial))) {
        fail('items.' + key + '.initial 必须是 >=0 的整数，得到 ' + JSON.stringify(it.initial));
      }
      ['icon', 'name', 'desc', 'nameKey', 'descKey'].forEach(function (f) {
        if (it[f] !== undefined && typeof it[f] !== 'string') {
          fail('items.' + key + '.' + f + ' 必须是字符串，得到 ' + JSON.stringify(it[f]));
        }
      });
    });

    var items = cfg.items;
    function item(key) {
      var it = items[key];
      if (!it) fail('未声明的道具 key "' + key + '"');
      return it;
    }

    /* 当前库存 = max(0, granted - spent) */
    function stock(save, key) {
      var it = item(key);
      return Math.max(0, num(save && save[it.granted]) - num(save && save[it.spent]));
    }

    function all(save) {
      var out = {};
      keys.forEach(function (k) { out[k] = stock(save, k); });
      return out;
    }

    function total(save) {
      return keys.reduce(function (n, k) { return n + stock(save, k); }, 0);
    }

    /* 消耗 n 个：库存不足返回 null（调用方据此走「看广告补充」），够则返回只含 spent 增量的补丁。
       spent 只增不减，所以任何云端旧档都无法把已消耗的道具还回来。 */
    function spend(save, key, n) {
      var it = item(key);
      var qty = n === undefined ? 1 : num(n);
      if (qty <= 0) return null;
      if (stock(save, key) < qty) return null;
      var patch = {};
      patch[it.spent] = num(save && save[it.spent]) + qty;
      return patch;
    }

    /* ---- 物理上限（issue #1 · 广告奖励可信度）----
       只增账本 + max 合并有一个副作用：**被篡改的数字不可回收**。
       实测（.spike/spike-ledger.mjs）：控制台把 toolMineGranted 改成 99999 再触发一次同步，
       max 合并让这个假数字赢，换设备、清缓存都还在，正常值再也顶不回去。

       对策不是"检测作弊"（客户端做不到），而是**限损**：给累计获得量算一个
       「按游戏规则物理上最多能拿多少」的上限，超过就削平并记一条异常。
       上限 = initial + (开档天数 + 1) × perDay × safety
       safety 默认 3 倍冗余：宁可让作弊者停在 180 个/天，也绝不能误伤真玩家。

       ⚠️ 这是启发式，不是安全判定：
       - 上限本身依赖「开档天数」，本地时钟不可信 —— 所以宿主应当传服务端盖的
         created_date 换算出的天数；拿不到可信天数时**不 clamp**（返回 unknownAge），
         而不是拿本地时钟凑一个假证据出来。
       - 会改存档的人也能改天数。它挡的是"数字大到离谱且永久固化"，不是定向作弊。 */
    var ceilingCfg = cfg.ceiling === undefined ? null : cfg.ceiling;
    if (ceilingCfg !== null) {
      if (typeof ceilingCfg !== 'object' || Array.isArray(ceilingCfg)) fail('ceiling 必须是对象或省略');
      if (typeof ceilingCfg.perDay !== 'object' || ceilingCfg.perDay === null || Array.isArray(ceilingCfg.perDay)) {
        fail('ceiling.perDay 必须是对象（道具 key → 每天物理上限）');
      }
      Object.keys(ceilingCfg.perDay).forEach(function (k) {
        if (keys.indexOf(k) === -1) fail('ceiling.perDay 里的 "' + k + '" 不是已声明的道具');
        var v = ceilingCfg.perDay[k];
        if (typeof v !== 'number' || !isFinite(v) || v < 0) fail('ceiling.perDay.' + k + ' 必须是非负数');
      });
      if (ceilingCfg.safety !== undefined &&
        (typeof ceilingCfg.safety !== 'number' || !isFinite(ceilingCfg.safety) || ceilingCfg.safety < 1)) {
        fail('ceiling.safety 必须是 >= 1 的数字');
      }
    }
    var safety = ceilingCfg && ceilingCfg.safety !== undefined ? ceilingCfg.safety : 3;

    /* 某道具在开档 ageDays 天后，累计获得量的物理上限；没配上限则返回 null（= 不设限） */
    function ceiling(key, ageDays) {
      var it = item(key);
      if (!ceilingCfg || ceilingCfg.perDay[key] === undefined) return null;
      var days = Math.max(0, num(ageDays));
      return Math.round(num(it.initial) + (days + 1) * ceilingCfg.perDay[key] * safety);
    }

    /* 检查一份存档（通常是刚跟云端/别的标签页合并完的那份）里有没有离谱的累计值。
       返回 { patch, anomalies }：patch 是要削平的字段（空对象 = 没问题），
       anomalies 是给日志/告警用的明细。ageDays 传 null/undefined = 天数不可信，
       此时不做任何 clamp，只把 unknownAge 标出来让上层能看见这条路走了多少次。 */
    function audit(save, ageDays) {
      var out = { patch: {}, anomalies: [], unknownAge: false };
      if (!ceilingCfg) return out;
      if (ageDays === null || ageDays === undefined || !isFinite(ageDays)) {
        out.unknownAge = true;
        return out;
      }
      keys.forEach(function (key) {
        var cap = ceiling(key, ageDays);
        if (cap === null) return;
        var have = num(save && save[item(key).granted]);
        if (have > cap) {
          out.patch[item(key).granted] = cap;
          out.anomalies.push({ key: key, field: item(key).granted, claimed: have, cap: cap, ageDays: ageDays });
        }
      });
      return out;
    }

    /* 发放 n 个（初始赠送 / 通关奖励 / 看广告补充）：granted 只增不减。 */
    function grant(save, key, n) {
      var it = item(key);
      var qty = n === undefined ? 1 : num(n);
      if (qty <= 0) return null;
      var patch = {};
      patch[it.granted] = num(save && save[it.granted]) + qty;
      return patch;
    }

    /* 迁移/初始化补丁（幂等，每次开档都可以跑）：
       - 全新档：granted = initial, spent = 0
       - 旧版本档（只有 legacy 库存数）：granted = spent + legacy 库存，保住玩家手上剩下的量
       返回的补丁只含需要改的字段；无需改动时返回 {}。 */
    function migrate(save) {
      var patch = {};
      var s = save || {};
      keys.forEach(function (key) {
        var it = items[key];
        var hasGranted = s[it.granted] !== undefined && s[it.granted] !== null;
        var spentNow = num(s[it.spent]);
        if (s[it.spent] === undefined || s[it.spent] === null) patch[it.spent] = spentNow;
        if (hasGranted) return;
        var legacyStock = it.legacy !== undefined && s[it.legacy] !== undefined && s[it.legacy] !== null
          ? num(s[it.legacy])
          : (it.initial || 0);
        patch[it.granted] = spentNow + legacyStock;
      });
      return patch;
    }

    /* 兼容回写：把派生库存同步到 legacy 字段，供尚未升级的旧客户端/旧云端列读取。
       新客户端永远只信 granted/spent，不读 legacy（迁移那一次除外）。 */
    function legacyPatch(save) {
      var patch = {};
      keys.forEach(function (key) {
        var it = items[key];
        if (it.legacy === undefined) return;
        patch[it.legacy] = stock(save, key);
      });
      return patch;
    }

    /* 多标签页保护：把「只增账本」字段与另一份存档（通常是磁盘上的现值）逐字段取大。

       为什么需要：同一浏览器开多个标签页时，每个标签页各持一个 save 对象。
       A 标签页花掉 200 金币写盘后，B 标签页手里还是买之前的快照，它下一次写盘
       （体力每秒结算就会触发）会把整份旧存档覆盖回去 —— 已消耗的金币/道具凭空复活。
       granted/spent 都是单调只增的，所以「取大」永远不会丢掉任何一侧的消耗或发放，
       这和云端 merge:"max" 是同一个语义，只是也在本地写盘这一层用一次。

       注意：只对账本字段生效；level/energy 这类非单调字段不在此列（各自另有合并规则）。 */
    function reconcile(save, other) {
      var patch = {};
      if (!other) return patch;
      keys.forEach(function (key) {
        var it = items[key];
        [it.granted, it.spent].forEach(function (field) {
          var mine = num(save && save[field]);
          var theirs = num(other[field]);
          if (theirs > mine) patch[field] = theirs;
        });
      });
      return patch;
    }

    /* 展示元数据（背包窗口用）。三项都可选，缺省有兜底，所以不写也不会崩。 */
    function meta(key) {
      var it = item(key);
      return {
        key: key,
        icon: it.icon || '📦',
        name: it.name || key,
        desc: it.desc || '',
        /* 供页面做多语言：nameKey/descKey 指向 i18n 字典键。
           配了就优先用（页面自己 t() 翻译），没配则退回上面写死的 name/desc。 */
        nameKey: it.nameKey || null,
        descKey: it.descKey || null
      };
    }

    /* 背包清单：每个道具的展示元数据 + 当前库存，按配置声明顺序返回。
       exclude 用来把货币这类「不是道具」的账目排除（如金币自己有独立显示位）。 */
    function list(save, exclude) {
      var skip = {};
      (exclude || []).forEach(function (k) { skip[k] = true; });
      return keys.filter(function (k) { return !skip[k]; }).map(function (k) {
        var m = meta(k);
        m.stock = stock(save, k);
        return m;
      });
    }

    return {
      keys: keys.slice(),
      stock: stock,
      all: all,
      total: total,
      spend: spend,
      grant: grant,
      migrate: migrate,
      legacyPatch: legacyPatch,
      reconcile: reconcile,
      ceiling: ceiling,
      audit: audit,
      meta: meta,
      list: list
    };
  }

  return { create: create };
});
