/* 皮肤系统 core：目录/解锁谓词/theme token 级联/进度背景/购买复用
   （issue #1 · S25/S26/S27/S28）
   纪律：解锁条件 = 统一谓词集（level/ad/currency 复用 S6 powerups 框架，
   新增 streak 谓词走同一注册表求值，core 不为任何条件写 if 分支）；
   皮肤只是「资源清单 + 映射表」，渲染层按 theme token 换肤（皮肤覆盖 >
   主题 > 默认 三层级联）；进度背景 = 递增断点表；购买 = wallet.spend +
   inventory.grant，无新支付/库存代码。非法配置一律加载期抛错。
   浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./powerups.js'));
  } else {
    root.CosmeticsCore = factory(root.PowerupsCore);
  }
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';

  function fail(msg) { throw new Error('cosmetics config: ' + msg); }

  var CFG_KEYS = ['catalog', 'themes', 'progressBackgrounds'];
  var ITEM_KEYS = ['id', 'kind', 'themeId', 'unlock', 'price'];
  var KINDS = ['theme', 'skin', 'background'];
  var PRICE_KEYS = ['coins'];

  // 谓词求值注册表：与 S6 同一套框架（level/ad/currency 直接委托 powerups），
  // streak 是本组新增维度——注册表驱动，无条件分支散落
  var PRED_EVAL = {
    level: null, ad: null, currency: null, // 委托 P.evaluateUnlock
    streak: function (p, state) { return (state.streak || 0) >= p.n; }
  };

  function validateUnlock(preds) {
    if (!Array.isArray(preds) || preds.length === 0) fail('unlock 必须是非空谓词数组（AND 语义）');
    preds.forEach(function (p) {
      if (typeof p !== 'object' || p === null || !(p.type in PRED_EVAL)) fail('未知 unlock.type "' + (p && p.type) + '"（合法：' + Object.keys(PRED_EVAL).join('、') + '）');
      if (p.type === 'streak' && (!Number.isInteger(p.n) || p.n <= 0)) fail('streak 谓词的 n 必须是 >0 整数');
      if (p.type !== 'streak') P.validateUnlock([p]); // 复用 S6 校验
    });
    return preds;
  }

  function create(cfg, opts) {
    opts = opts || {};
    if (cfg == null) {
      return { enabled: false, ids: function () { return []; }, isUnlocked: function () { throw new Error('cosmetics: 未配置'); } };
    }
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('必须是对象');
    for (var k in cfg) if (CFG_KEYS.indexOf(k) === -1) fail('未知键 "' + k + '"（合法键：' + CFG_KEYS.join('、') + '）');
    var catalog = cfg.catalog === undefined ? [] : cfg.catalog;
    if (!Array.isArray(catalog)) fail('catalog 必须是数组');
    var byId = new Map();
    catalog.forEach(function (c) {
      if (typeof c !== 'object' || c === null) fail('catalog 项必须是对象');
      for (var ck in c) if (ITEM_KEYS.indexOf(ck) === -1) fail('catalog["' + c.id + '"] 未知键 "' + ck + '"');
      if (typeof c.id !== 'string' || !c.id) fail('catalog 项缺 id');
      if (byId.has(c.id)) fail('catalog id "' + c.id + '" 重复');
      if (c.kind !== undefined && KINDS.indexOf(c.kind) === -1) fail('catalog["' + c.id + '"] 未知 kind');
      if (!c.unlock && !c.price) fail('catalog["' + c.id + '"] price 与 unlock 双缺（必须至少一种获取途径）');
      if (c.unlock) {
        validateUnlock(c.unlock);
        if (c.unlock.some(function (u) { return u.type === 'streak'; }) && !opts.streakEnabled) fail('catalog["' + c.id + '"] 用 streak 解锁但该游戏未启用 streak');
      }
      if (c.price) {
        for (var pk in c.price) if (PRICE_KEYS.indexOf(pk) === -1) fail('catalog["' + c.id + '"] price 引用不存在货币 "' + pk + '"');
        if (!Number.isInteger(c.price.coins) || c.price.coins <= 0) fail('catalog["' + c.id + '"] price.coins 必须是 >0 整数');
      }
      byId.set(c.id, c);
    });
    var themes = cfg.themes === undefined ? {} : cfg.themes;
    if (typeof themes !== 'object' || Array.isArray(themes)) fail('themes 必须是对象');
    var themeIds = Object.keys(themes);
    if (themeIds.length && !themes['default']) fail('缺 default 主题（token 全量基准）');
    themeIds.forEach(function (tid) {
      var t = themes[tid];
      if (typeof t !== 'object' || t === null || Array.isArray(t)) fail('主题 "' + tid + '" 必须是 token 对象');
      if (tid === 'default') return;
      Object.keys(t).forEach(function (tok) {
        if (!(tok in themes['default'])) fail('主题 "' + tid + '" 有基准外 token "' + tok + '"（default 必须全量声明）');
      });
    });
    var bgs = cfg.progressBackgrounds === undefined ? [] : cfg.progressBackgrounds;
    if (!Array.isArray(bgs)) fail('progressBackgrounds 必须是数组');
    var lastFrom = 0;
    bgs.forEach(function (b) {
      Object.keys(b).forEach(function (bk) { if (bk !== 'fromLevel' && bk !== 'themeId') fail('progressBackgrounds 未知键 "' + bk + '"'); });
      if (!Number.isInteger(b.fromLevel) || b.fromLevel <= lastFrom) fail('progressBackgrounds 断点必须严格递增（' + b.fromLevel + '）');
      if (!themes[b.themeId]) fail('progressBackgrounds 引用不存在 themeId "' + b.themeId + '"');
      lastFrom = b.fromLevel;
    });

    function mustGet(id) {
      var c = byId.get(id);
      if (!c) throw new Error('cosmetics: 未声明 id "' + id + '"');
      return c;
    }

    return {
      enabled: true,
      ids: function () { return Array.from(byId.keys()); },
      // S25：统一谓词单点求值（AND），拥有即解锁的购买品走 inventory
      isUnlocked: function (id, state) {
        var c = mustGet(id);
        if (!c.unlock) return false; // 纯购买品：以库存持有为准（见 buy/owns）
        state = state || {};
        return c.unlock.every(function (u) {
          if (u.type === 'streak') return PRED_EVAL.streak(u, state);
          return P.evaluateUnlock(P.validateUnlock([u]), state);
        });
      },
      // S26：token 级联——皮肤覆盖 > 主题 > 默认；渲染层只读语义 token
      resolveTokens: function (themeId, skinOverrides) {
        if (!themes[themeId]) throw new Error('cosmetics: 未知主题 "' + themeId + '"');
        var out = {};
        Object.keys(themes['default']).forEach(function (tok) { out[tok] = themes['default'][tok]; });
        Object.keys(themes[themeId]).forEach(function (tok) { out[tok] = themes[themeId][tok]; });
        if (skinOverrides) Object.keys(skinOverrides).forEach(function (tok) {
          if (!(tok in themes['default'])) throw new Error('cosmetics: 皮肤覆盖了基准外 token "' + tok + '"');
          out[tok] = skinOverrides[tok];
        });
        return out;
      },
      // S27：进度背景——断点表查档，纯函数、不触发玩法重载
      themeByProgress: function (level) {
        if (!Number.isInteger(level) || level < 0) throw new Error('cosmetics: level 必须是 >=0 整数');
        var cur = 'default';
        bgs.forEach(function (b) { if (level >= b.fromLevel) cur = b.themeId; });
        return cur;
      },
      // S28：购买复用——wallet.spend + inventory.grant，同一事务、重复购买/余额不足被挡
      buy: function (id, wallet, inventory) {
        var c = mustGet(id);
        if (!c.price) return { ok: false, reason: 'not-for-sale' };
        if (inventory.count(id) > 0) return { ok: false, reason: 'owned' };
        if (typeof wallet.coins !== 'number' || wallet.coins < c.price.coins) return { ok: false, reason: 'poor' };
        wallet.coins -= c.price.coins;
        inventory.grant(id, 1, 'purchase');
        return { ok: true };
      }
    };
  }

  return { create: create, validateUnlock: validateUnlock, KINDS: KINDS };
});
