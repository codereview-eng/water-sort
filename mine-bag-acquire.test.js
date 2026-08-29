'use strict';
/* 背包「+」获取入口的接线门禁（2026-08-29）。
   需求：首页道具窗里每个道具都要能当场补货——花金币买，或看一段广告免费拿。

   为什么不是只测 core 纯函数：core 的 buy/grantByAd 早就全绿，真正会坏的是页面这一层
   （按钮没画出来、点了没反应、广告没看完就发道具、买不起时静默失败、窗口关不掉）。
   教训见 repo memory「页面接线要单独测」：core 全绿挡不住 HTML 读错字段。
   所以这里从 mine.html 里把 openBag / openAcquire / acquireName 三个具名函数原样抠出来，
   配真实的 core/stock.js + core/coins.js + games/mine/game.config.json 真跑，
   只把 DOM / 弹窗 / 广告链换成可观测的替身。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const ROOT = __dirname;
const HTML = readFileSync(join(ROOT, 'mine.html'), 'utf8');
const CFG = JSON.parse(readFileSync(join(ROOT, 'games/mine/game.config.json'), 'utf8'));
const StockCore = require('./core/stock.js');
const CoinsCore = require('./core/coins.js');

/* 按大括号配平抠出一个具名函数（教训：按行数截窗会把函数尾巴切掉，见 ad-pause 门禁注释） */
function fnSource(name) {
  const anchor = 'function ' + name + '(';
  const i = HTML.indexOf(anchor);
  assert.ok(i > 0, `mine.html 里找不到 ${name}()`);
  let depth = 0, started = false;
  for (let j = HTML.indexOf('{', i); j < HTML.length; j++) {
    if (HTML[j] === '{') { depth++; started = true; }
    else if (HTML[j] === '}') {
      depth--;
      if (started && depth === 0) return HTML.slice(i, j + 1);
    }
  }
  throw new Error(name + ' 的大括号不配平');
}

const ZH = CFG.i18n.locales.zh;

function makeCtx(opts) {
  const o = opts || {};
  const stock = StockCore.create(CFG.stock);
  const coins = CoinsCore.create(CFG.coins, stock);
  const save = Object.assign({}, stock.migrate({}), o.save || {});
  const el = { innerHTML: '', hidden: true, onclick: null };
  const ctx = {
    Stock: stock,
    Coins: coins,
    save: save,
    dialogs: [],
    toasts: [],
    ads: [],
    persisted: 0,
    rendered: 0,
    el: el,
    JSON: JSON,
    Object: Object,
    Math: Math,
    String: String,
    $: function () { return el; },
    escHtml: function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); },
    /* 真字典 + 真插值：占位符名写错会在断言里以残留的 {xxx} 暴露出来 */
    t: function (key, vars) {
      assert.ok(Object.prototype.hasOwnProperty.call(ZH, key), '字典缺 key：' + key);
      const s = ZH[key];
      if (!vars) return s;
      return s.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] !== undefined ? String(vars[n]) : m; });
    },
    persist: function () { ctx.persisted += 1; },
    renderHome: function () { ctx.rendered += 1; },
    toast: function (m) { ctx.toasts.push(m); },
    dialog: function (title, body, mainText, onMain, subText, onSub, onDismiss) {
      ctx.dialogs.push({ title, body, mainText, onMain, subText, onSub, onDismiss });
    },
    /* 广告替身：默认「看完了」才回调；granted=false 时回调根本不该被调用 */
    watchAdFor: function (placement, onReward) {
      ctx.ads.push(placement);
      if (o.adGranted !== false) onReward();
    }
  };
  vm.createContext(ctx);
  vm.runInContext([fnSource('openBag'), fnSource('acquireName'), fnSource('openAcquire')].join('\n'), ctx);
  return ctx;
}

const last = (a) => a[a.length - 1];
/** 模拟点击背包里某个道具的「+」（走的是页面真正的事件委托，不是直接调 openAcquire） */
function clickPlus(ctx, key) {
  const target = { getAttribute: (n) => (n === 'data-get' ? key : null), parentNode: null };
  ctx.el.onclick({ target });
}

test('每个可买道具都画出「+」，无障碍标签已翻译且不留占位符', () => {
  const ctx = makeCtx();
  vm.runInContext('openBag()', ctx);
  const html = ctx.el.innerHTML;
  for (const key of ctx.Coins.shopKeys) {
    assert.ok(html.includes('data-get="' + key + '"'), key + ' 这一行缺「+」获取入口');
  }
  assert.ok(!/data-get="coins"/.test(html), '金币自己不是道具，不该出现在背包行里');
  assert.ok(/aria-label="获取[^"]+"/.test(html), '「+」必须有无障碍标签');
  assert.ok(!/\{\w+\}/.test(html), '文案里不许残留 {占位符}');
});

test('点「+」打开获取窗：两条路都在，且能退回背包（不许把玩家困住）', () => {
  const ctx = makeCtx();
  vm.runInContext('openBag()', ctx);
  clickPlus(ctx, 'toolMine');
  const d = last(ctx.dialogs);
  assert.ok(d.mainText.includes(String(ctx.Coins.priceOf('toolMine'))), '主按钮要写清金币价');
  assert.ok(d.subText.includes(String(ctx.Coins.adAmountOf('toolMine'))), '副按钮要写清看广告给几个');
  assert.ok(!/\{\w+\}/.test(d.title + d.body + d.mainText + d.subText), '文案里不许残留 {占位符}');
  assert.strictEqual(typeof d.onDismiss, 'function', '✕/遮罩/Esc 必须有去处');
  const before = ctx.dialogs.length;
  d.onDismiss();
  assert.strictEqual(last(ctx.dialogs).title, ctx.t('bagTitle'), '关掉获取窗应回到背包窗');
  assert.ok(ctx.dialogs.length > before);
});

test('金币够：买一次扣钱、进货、落盘、刷新首页余额', () => {
  const price = 200;
  const ctx = makeCtx({ save: { coinsEarned: price } });
  const stockBefore = ctx.Stock.stock(ctx.save, 'toolMine');
  vm.runInContext('openBag()', ctx);
  clickPlus(ctx, 'toolMine');
  last(ctx.dialogs).onMain();
  assert.strictEqual(ctx.Coins.balance(ctx.save), 0, '金币要真的扣掉');
  assert.strictEqual(ctx.Stock.stock(ctx.save, 'toolMine'), stockBefore + ctx.Coins.amountOf('toolMine'));
  assert.ok(ctx.persisted > 0, '买完必须落盘，否则刷新就回退');
  assert.ok(ctx.rendered > 0, '首页金币显示要跟着变');
  assert.ok(last(ctx.toasts).includes('×' + ctx.Coins.amountOf('toolMine')));
  assert.strictEqual(last(ctx.dialogs).title, ctx.t('bagTitle'), '买完回背包，数量当场看得到');
});

test('金币不够：说清还差多少，一分钱不扣、一件不发，窗口还在原地', () => {
  const ctx = makeCtx({ save: { coinsEarned: 30 } });
  const stockBefore = ctx.Stock.stock(ctx.save, 'toolMine');
  vm.runInContext('openBag()', ctx);
  clickPlus(ctx, 'toolMine');
  last(ctx.dialogs).onMain();
  assert.strictEqual(ctx.Coins.balance(ctx.save), 30, '买不起不能扣钱');
  assert.strictEqual(ctx.Stock.stock(ctx.save, 'toolMine'), stockBefore, '买不起不能发货');
  assert.ok(last(ctx.toasts).includes(String(ctx.Coins.priceOf('toolMine') - 30)), '要说清还差多少金币');
  assert.strictEqual(last(ctx.dialogs).title, ctx.t('getTitle', { name: '找一个雷' }), '失败后停在获取窗，不把人踢走');
});

test('看广告：走 tool-refill 广告位，看完才发货、且不扣金币', () => {
  const ctx = makeCtx({ save: { coinsEarned: 1000 } });
  const stockBefore = ctx.Stock.stock(ctx.save, 'toolSafe');
  vm.runInContext('openBag()', ctx);
  clickPlus(ctx, 'toolSafe');
  last(ctx.dialogs).onSub();
  assert.deepStrictEqual(ctx.ads, ['tool-refill'], '必须走 core 广告链的激励位');
  assert.strictEqual(ctx.Stock.stock(ctx.save, 'toolSafe'), stockBefore + ctx.Coins.adAmountOf('toolSafe'));
  assert.strictEqual(ctx.Coins.balance(ctx.save), 1000, '广告路径不许动金币');
  assert.ok(ctx.persisted > 0);
});

test('广告没看完：一件都不发，也不谎报「已获得」', () => {
  const ctx = makeCtx({ adGranted: false });
  const stockBefore = ctx.Stock.stock(ctx.save, 'toolSafe');
  vm.runInContext('openBag()', ctx);
  clickPlus(ctx, 'toolSafe');
  last(ctx.dialogs).onSub();
  assert.strictEqual(ctx.Stock.stock(ctx.save, 'toolSafe'), stockBefore);
  assert.deepStrictEqual(ctx.toasts, [], '没看完不该有任何「已获得」提示');
});
