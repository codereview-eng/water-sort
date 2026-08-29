'use strict';
/* core/coins.js 单测：可配置 + 缺配置走默认 + 买不起不扣 + 花掉的金币不会被云端旧值复活 */
const test = require('node:test');
const assert = require('node:assert');
const Stock = require('./stock.js');
const Coins = require('./coins.js');
const Platform = require('./platform.js');

const STOCK_CFG = {
  items: {
    coins: { granted: 'coinsEarned', spent: 'coinsSpent', initial: 0 },
    toolMine: { granted: 'toolMineGranted', spent: 'toolMineSpent', initial: 2 },
    toolSafe: { granted: 'toolSafeGranted', spent: 'toolSafeSpent', initial: 2 }
  }
};
const mkStock = () => Stock.create(STOCK_CFG);
const fresh = (stock, extra) => Object.assign({}, stock.migrate({}), extra || {});

test('整段不配置：通关 +1 金币，所有道具 200 金币换 1 个', () => {
  const stock = mkStock();
  const coins = Coins.create(undefined, stock);
  assert.strictEqual(coins.earnPerClear, 1, '默认通关奖励');
  assert.deepStrictEqual(coins.shopKeys.sort(), ['toolMine', 'toolSafe'], '金币本身不进货架');
  assert.strictEqual(coins.priceOf('toolMine'), 200);
  assert.strictEqual(coins.amountOf('toolSafe'), 1);
});

test('每个游戏可自配：奖励与单个道具的价格/数量都能改', () => {
  const stock = mkStock();
  const coins = Coins.create({
    earnPerClear: 3,
    shop: { toolMine: { price: 500, amount: 2 }, toolSafe: {} }   // toolSafe 省略 → 走默认
  }, stock);
  assert.strictEqual(coins.earnPerClear, 3);
  assert.deepStrictEqual(coins.sku('toolMine'), { price: 500, amount: 2, adAmount: 1 });
  assert.deepStrictEqual(coins.sku('toolSafe'), { price: 200, amount: 1, adAmount: 1 }, '条目内缺省字段也要兜底');
});

test('配了 shop 就只卖列出来的：未列出的道具不可买', () => {
  const stock = mkStock();
  const coins = Coins.create({ shop: { toolMine: { price: 100 } } }, stock);
  assert.deepStrictEqual(coins.shopKeys, ['toolMine']);
  assert.strictEqual(coins.sku('toolSafe'), null);
  assert.strictEqual(coins.canBuy(fresh(stock, { coinsEarned: 9999 }), 'toolSafe'), false);
});

test('通关攒金币：rewardClear 只加累计数', () => {
  const stock = mkStock();
  const coins = Coins.create({ earnPerClear: 2 }, stock);
  const save = fresh(stock);
  assert.strictEqual(coins.balance(save), 0);
  Object.assign(save, coins.rewardClear(save));
  assert.strictEqual(coins.balance(save), 2, '通关一盘 +2');
  Object.assign(save, coins.rewardClear(save, 3));   // 一次补发 3 盘
  assert.strictEqual(coins.balance(save), 8);
  assert.strictEqual(save.coinsSpent, 0, '奖励不该动 spent');
});

test('earnPerClear 配 0 = 关掉奖励', () => {
  const stock = mkStock();
  const coins = Coins.create({ earnPerClear: 0 }, stock);
  assert.strictEqual(coins.rewardClear(fresh(stock)), null);
});

test('金币不够：canBuy=false，buy 返回 null，一分钱都不扣', () => {
  const stock = mkStock();
  const coins = Coins.create(undefined, stock);
  const save = fresh(stock, { coinsEarned: 199 });
  assert.strictEqual(coins.canBuy(save, 'toolMine'), false);
  assert.strictEqual(coins.buy(save, 'toolMine'), null);
  assert.strictEqual(coins.balance(save), 199, '失败的购买不能扣钱');
  assert.strictEqual(stock.stock(save, 'toolMine'), 2, '也不能发货');
});

test('买得起：扣 200 金币、道具 +1，两笔都是只增计数', () => {
  const stock = mkStock();
  const coins = Coins.create(undefined, stock);
  const save = fresh(stock, { coinsEarned: 250 });
  const patch = coins.buy(save, 'toolMine');
  assert.ok(patch, '应当成交');
  Object.assign(save, patch);
  assert.strictEqual(coins.balance(save), 50, '250 - 200');
  assert.strictEqual(stock.stock(save, 'toolMine'), 3, '初始 2 + 买到 1');
  assert.strictEqual(save.coinsSpent, 200);
  assert.strictEqual(save.coinsEarned, 250, 'earned 不动，只增 spent');
});

test('连买两次：余额与库存都正确累加', () => {
  const stock = mkStock();
  const coins = Coins.create({ shop: { toolSafe: { price: 100, amount: 3 } } }, stock);
  const save = fresh(stock, { coinsEarned: 250 });
  Object.assign(save, coins.buy(save, 'toolSafe'));
  Object.assign(save, coins.buy(save, 'toolSafe'));
  assert.strictEqual(coins.balance(save), 50);
  assert.strictEqual(stock.stock(save, 'toolSafe'), 2 + 6);
  assert.strictEqual(coins.buy(save, 'toolSafe'), null, '第三次买不起');
});

test('回归：花掉的金币不会被云端旧存档复活（max 合并）', () => {
  const stock = mkStock();
  const coins = Coins.create(undefined, stock);
  const local = fresh(stock, { coinsEarned: 400 });
  Object.assign(local, coins.buy(local, 'toolMine'));      // 花掉 200，余额 200
  const platform = Platform.create({
    entity: 'Save',
    fields: {
      coinsEarned: { col: 'coins_earned', merge: 'max' },
      coinsSpent: { col: 'coins_spent', merge: 'max' },
      toolMineGranted: { col: 'tool_mine_granted', merge: 'max' },
      toolMineSpent: { col: 'tool_mine_spent', merge: 'max' }
    }
  });
  // 云端是一台「还没花钱」的旧设备写上去的行，时间戳还更新
  const staleCloud = { coins_earned: 400, coins_spent: 0, tool_mine_granted: 2, tool_mine_spent: 0,
    updated_ms: Date.now() + 60000 };
  const merged = platform.mergeSave(local, staleCloud).save;
  assert.strictEqual(coins.balance(merged), 200, '花掉的 200 不能被云端旧值退回来');
  assert.strictEqual(stock.stock(merged, 'toolMine'), 3, '买到的道具也不能被抹掉');
});

/* 「看广告免费拿」与「金币买」共用同一张货架：不在货架上的道具两条路都没有入口，
   页面据此决定要不要画「+」（避免页面另存一份可获取清单，加道具时两处漂移）。 */
test('看广告获取：默认 +1，只发道具不动金币', () => {
  const stock = mkStock();
  const coins = Coins.create(undefined, stock);
  const save = fresh(stock, { coinsEarned: 300 });
  assert.strictEqual(coins.adAmountOf('toolMine'), 1, '缺省一次广告给 1 个');
  Object.assign(save, coins.grantByAd(save, 'toolMine'));
  assert.strictEqual(stock.stock(save, 'toolMine'), 3);
  assert.strictEqual(coins.balance(save), 300, '广告路径不许动金币');
});

test('看广告发放量可配，货架外的道具没有获取入口', () => {
  const stock = mkStock();
  const coins = Coins.create({ shop: { toolSafe: { price: 120, amount: 2, adAmount: 3 } } }, stock);
  const save = fresh(stock, {});
  assert.strictEqual(coins.adAmountOf('toolSafe'), 3);
  Object.assign(save, coins.grantByAd(save, 'toolSafe'));
  assert.strictEqual(stock.stock(save, 'toolSafe'), 2 + 3);
  assert.strictEqual(coins.adAmountOf('toolMine'), null, '没上架 = 没有获取入口');
  assert.strictEqual(coins.priceOf('toolMine'), null);
  assert.strictEqual(coins.grantByAd(save, 'toolMine'), null, '没上架就不能靠广告白拿');
});

test('配置写错就直接报错，不静默兜底', () => {
  const stock = mkStock();
  assert.throws(() => Coins.create({ earnPerClear: -1 }, stock), /earnPerClear/);
  assert.throws(() => Coins.create({ earnPerClear: 1.5 }, stock), /earnPerClear/);
  assert.throws(() => Coins.create({ shop: { nope: {} } }, stock), /不是可购买道具/);
  assert.throws(() => Coins.create({ shop: { coins: {} } }, stock), /不是可购买道具/);
  assert.throws(() => Coins.create({ shop: {} }, stock), /空对象/);
  assert.throws(() => Coins.create({ shop: { toolMine: { price: 0 } } }, stock), /price/);
  assert.throws(() => Coins.create({ shop: { toolMine: { amount: -2 } } }, stock), /amount/);
  assert.throws(() => Coins.create({ shop: { toolMine: { adAmount: 0 } } }, stock), /adAmount/);
  assert.throws(() => Coins.create({ coinsKey: 'gold' }, stock), /不在 stock\.items/);
  assert.throws(() => Coins.create({}, null), /StockCore 实例/);
});
