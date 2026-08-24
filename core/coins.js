/* core/coins.js — 通用金币系统（通关攒金币 → 金币直接买道具，不必看视频）

   为什么金币也走 core/stock.js 的「只增账本」：金币是可增可减的余额，如果直接存余额，
   跨设备合并只能靠时间戳判新，就会重演 2026-08-20 的线上事故（花掉的又被云端旧值复活）。
   所以金币在存档里同样只存两个**只增不减**的累计数：
     coinsEarned = 累计赚到的金币（通关奖励等）
     coinsSpent  = 累计花掉的金币（购买道具）
     余额 = max(0, earned - spent)
   两个数在云端都用 merge:"max"，于是任何合并顺序下「花掉的一定是花掉了、赚到的不会丢」。
   金币本身就是 StockCore 里的一个 item（key 默认 'coins'），本模块只负责
   「配置解析（含默认值兜底）＋ 价格校验 ＋ 生成购买/奖励补丁」。

   每个游戏自己配置（缺省则走默认）：
     earnPerClear  每通关一盘 +多少金币          默认 1
     shop.<道具>.price   多少金币买一次           默认 200
     shop.<道具>.amount  一次买到几个             默认 1
     shop 整段省略 → 账本里除金币以外的所有道具都可买，一律 200 金币换 1 个。

   纯函数、无 IO，浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CoinsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_EARN_PER_CLEAR = 1;
  var DEFAULT_PRICE = 200;
  var DEFAULT_AMOUNT = 1;
  var DEFAULT_COINS_KEY = 'coins';

  function fail(msg) { throw new Error('coins config: ' + msg); }

  function posInt(v, what) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0 || v !== Math.floor(v)) {
      fail(what + ' 必须是 >0 的整数，得到 ' + JSON.stringify(v));
    }
    return v;
  }

  /* cfg   = { earnPerClear?, shop?, coinsKey? }，整段可省略（undefined/null → 全默认）
     stock = StockCore 实例（金币与道具共用同一本账） */
  function create(cfg, stock) {
    if (cfg === undefined || cfg === null) cfg = {};
    if (typeof cfg !== 'object' || Array.isArray(cfg)) fail('必须是对象或省略，得到 ' + JSON.stringify(cfg));
    if (!stock || typeof stock.stock !== 'function' || !Array.isArray(stock.keys)) {
      fail('需要传入 StockCore 实例作为第二个参数');
    }

    var coinsKey = cfg.coinsKey === undefined ? DEFAULT_COINS_KEY : cfg.coinsKey;
    if (typeof coinsKey !== 'string' || !coinsKey) fail('coinsKey 必须是非空字符串');
    if (stock.keys.indexOf(coinsKey) < 0) {
      fail('金币账目 "' + coinsKey + '" 不在 stock.items 里（现有：' + stock.keys.join(', ') + '）');
    }

    var earnPerClear = cfg.earnPerClear === undefined ? DEFAULT_EARN_PER_CLEAR : cfg.earnPerClear;
    if (typeof earnPerClear !== 'number' || !isFinite(earnPerClear) || earnPerClear < 0
      || earnPerClear !== Math.floor(earnPerClear)) {
      fail('earnPerClear 必须是 >=0 的整数，得到 ' + JSON.stringify(earnPerClear));
    }

    var buyable = stock.keys.filter(function (k) { return k !== coinsKey; });
    var shop = {};
    if (cfg.shop === undefined || cfg.shop === null) {
      // 整段没配：账本里除金币外的道具全部可买，走默认价与默认数量
      buyable.forEach(function (k) { shop[k] = { price: DEFAULT_PRICE, amount: DEFAULT_AMOUNT }; });
    } else {
      if (typeof cfg.shop !== 'object' || Array.isArray(cfg.shop)) fail('shop 必须是对象');
      var listed = Object.keys(cfg.shop);
      if (listed.length === 0) fail('shop 配了但是空对象；要「全部走默认」就整段省略 shop');
      listed.forEach(function (k) {
        if (buyable.indexOf(k) < 0) {
          fail('shop.' + k + ' 不是可购买道具（stock.items 里没有它，或它就是金币本身）；可选：' + buyable.join(', '));
        }
        var e = cfg.shop[k];
        if (typeof e !== 'object' || e === null || Array.isArray(e)) fail('shop.' + k + ' 必须是对象 {price?, amount?}');
        shop[k] = {
          price: e.price === undefined ? DEFAULT_PRICE : posInt(e.price, 'shop.' + k + '.price'),
          amount: e.amount === undefined ? DEFAULT_AMOUNT : posInt(e.amount, 'shop.' + k + '.amount')
        };
      });
    }

    function sku(itemKey) { return shop[itemKey] || null; }
    function balance(save) { return stock.stock(save, coinsKey); }
    function priceOf(itemKey) { var s = sku(itemKey); return s ? s.price : null; }
    function amountOf(itemKey) { var s = sku(itemKey); return s ? s.amount : null; }
    function canBuy(save, itemKey) {
      var s = sku(itemKey);
      return !!s && balance(save) >= s.price;
    }

    /* 购买：一次写入两笔只增计数（花掉的金币 + 拿到的道具）。
       买不起或不在货架上返回 null —— 调用方据此提示「金币不够」而不是静默失败。 */
    function buy(save, itemKey) {
      var s = sku(itemKey);
      if (!s || balance(save) < s.price) return null;
      var spent = stock.spend(save, coinsKey, s.price);
      if (!spent) return null;
      var granted = stock.grant(save, itemKey, s.amount);
      if (!granted) return null;
      var patch = {};
      Object.keys(spent).forEach(function (k) { patch[k] = spent[k]; });
      Object.keys(granted).forEach(function (k) { patch[k] = granted[k]; });
      return patch;
    }

    /* 通关奖励：金币 earned + earnPerClear（earnPerClear 配成 0 就是关掉奖励，返回 null） */
    function rewardClear(save, times) {
      var n = earnPerClear * (times === undefined ? 1 : Math.max(0, Math.floor(times)));
      if (n <= 0) return null;
      return stock.grant(save, coinsKey, n);
    }

    return {
      coinsKey: coinsKey,
      earnPerClear: earnPerClear,
      shopKeys: Object.keys(shop),
      sku: sku,
      priceOf: priceOf,
      amountOf: amountOf,
      balance: balance,
      canBuy: canBuy,
      buy: buy,
      rewardClear: rewardClear
    };
  }

  return { create: create, DEFAULTS: { earnPerClear: DEFAULT_EARN_PER_CLEAR, price: DEFAULT_PRICE, amount: DEFAULT_AMOUNT } };
});
