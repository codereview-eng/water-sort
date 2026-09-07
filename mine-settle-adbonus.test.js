'use strict';
/* 门禁：「看视频领 N 倍金币」的页面接线（2026-09-07 用户实报「这个功能没有了」）

   复盘结论比 bug 本身更值得钉死：这个功能**从来没被实现过**，但配置里一直写着
   `settle.adBonus.enabled = true`，core/settle.js 也把 adApply / 日上限 / 冷却都实现了
   并有单测全绿 —— 断的是页面这一层，`git log -S adApply -- mine.html` 全历史零命中。
   也就是说：core 单测 + 配置校验双双绿灯，玩家侧却什么都没有。

   所以这里有两类断言，缺一不可：
     ① 契约断言：配置声称 enabled ⇒ 页面必须真的调用内核（防「配置 on、零接线」重演）；
     ② 行为断言：把 mine.html 的函数原文抠出来，配真配置与真 core **真跑**一遍
        （见 repo memory「页面接线要单独测」——core 纯函数全绿挡不住页面接错）。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const SettleCore = require('./core/settle.js');
const StockCore = require('./core/stock.js');
const CoinsCore = require('./core/coins.js');

const html = fs.readFileSync(path.join(__dirname, 'mine.html'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/mine/game.config.json'), 'utf8'));

function htmlFunction(name) {
  const head = 'function ' + name + '(';
  const i = html.indexOf(head);
  assert.ok(i > 0, '找不到 mine.html 里的 ' + name);
  let depth = 0, started = false;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') { depth++; started = true; }
    else if (html[j] === '}') { depth--; if (started && depth === 0) return html.slice(i, j + 1); }
  }
  throw new Error('大括号不配平: ' + name);
}

const DAY = 86400000;
function sandbox(over) {
  const store = {};
  const ctx = {
    Settle: SettleCore.create(cfg.settle),
    Stock: null, Coins: null,
    save: { coinsEarned: 0, coinsSpent: 0 },
    traces: [], toasts: [], persisted: 0, ads: [],
    SB_KEY: 'mine_settle_bonus_v1',
    SB_DIAG: { offered: 0, skipped: 0, granted: 0, lost: 0 },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    trace: (e, d) => ctx.traces.push(Object.assign({ e }, d)),
    toast: (m) => ctx.toasts.push(m),
    t: (k, d) => k + JSON.stringify(d || {}),
    persist: () => { ctx.persisted++; },
    renderHome: () => {},
    // 广告桩：默认「看完了」——没看完的分支由 onFail=deny 的配置与 watchAdFor 自己覆盖
    watchAdFor: (id, onReward, onSettled) => {
      ctx.ads.push(id);
      if (ctx.adWatched !== false) onReward();
      if (onSettled) onSettled();
    },
    adWatched: true,
    /* 可控时钟：领取那一刻的时间由 claimSettleBonus 自己从 Date.now() 取（广告播完才算数，
       这是对的），所以测试要能驱动它 —— 否则日上限/冷却/跨日这三条都只能靠真实时间碰运气。 */
    clock: Date.parse('2026-09-07T10:00:00Z'),
  };
  ctx.Date = { now: () => ctx.clock, parse: Date.parse };
  ctx.Stock = StockCore.create(cfg.stock);
  ctx.Coins = CoinsCore.create(cfg.coins, ctx.Stock);
  Object.assign(ctx, over || {});
  vm.createContext(ctx);
  vm.runInContext([
    htmlFunction('sbLoad'), htmlFunction('sbSave'),
    htmlFunction('settleBonusOffer'), htmlFunction('claimSettleBonus'),
  ].join('\n'), ctx);
  return ctx;
}

test('契约：配置声称 adBonus.enabled 就必须真的接线（这次回归的根因）', () => {
  if (!cfg.settle.adBonus || !cfg.settle.adBonus.enabled) return;   // 关掉了就不要求接线
  assert.ok(/SettleCore\.create\(CFG\.settle\)/.test(html),
    'settle.adBonus.enabled=true，但页面没有创建 Settle 实例 —— 配置声称的能力必须真的接上');
  assert.ok(/Settle\.adApply\(/.test(html),
    'settle.adBonus.enabled=true，但页面从不调用 adApply —— 配置 on、零接线正是本次回归');
  assert.ok(/<script src="\.\/core\/settle\.js"><\/script>/.test(html),
    'core/settle.js 必须被页面引入，否则 SettleCore 未定义');
  assert.ok(cfg.ads.placements['settle-bonus'], '翻倍要有自己的广告位，别蹭别人的频控');
  assert.strictEqual(cfg.ads.placements['settle-bonus'].onFail, 'deny', '没看完广告不许发奖');
});

test('结算窗把翻倍按钮接进第三槽，且连胜票优先（一个窗只放一个广告按钮）', () => {
  assert.ok(/t\('winAdBonus', \{ mult: bonus\.mult, n: bonus\.gain \}\)/.test(html),
    '按钮文案要用 winAdBonus 并带 mult/gain');
  assert.ok(/claimSettleBonus\(bonus\.base, function \(\) \{ winDialog\(\); \}\)/.test(html),
    '领完必须把结算窗放回来，不能把玩家扣在没有出口的已结束棋盘上');
  const win = htmlFunction('onWin');
  const ticketIdx = win.indexOf('WinStreak.hasTicket(wsGet())\n');
  assert.ok(win.indexOf('bonus') > 0, 'onWin 里要现算 bonus');
  assert.ok(/wsReady \? null : settleBonusOffer\(/.test(win), '有连胜票时不给翻倍按钮');
  void ticketIdx;
});

test('可用时给出正确的倍数与差额（差额 = 基数 ×(mult−1)）', () => {
  const ctx = sandbox();
  const offer = ctx.settleBonusOffer(1, Date.parse('2026-09-07T10:00:00Z'));
  assert.strictEqual(offer.mult, cfg.settle.adBonus.multiplier);
  assert.strictEqual(offer.base, 1);
  assert.strictEqual(offer.gain, 1 * cfg.settle.adBonus.multiplier - 1);
  assert.strictEqual(ctx.SB_DIAG.offered, 1);
});

test('本关没给金币时不给翻倍入口（0 的 5 倍还是 0，不能骗玩家看广告）', () => {
  const ctx = sandbox();
  assert.strictEqual(ctx.settleBonusOffer(0, Date.now()), null);
  assert.strictEqual(ctx.SB_DIAG.offered, 0);
});

test('领取：看完广告才补差额，走只增账本，并按 UTC 日计次', () => {
  const ctx = sandbox();
  const now = ctx.clock;
  ctx.settleBonusOffer(1, now);
  ctx.claimSettleBonus(1);
  const mult = cfg.settle.adBonus.multiplier;
  assert.deepStrictEqual(ctx.ads, ['settle-bonus'], '必须走自己的广告位');
  assert.strictEqual(ctx.save.coinsEarned, mult - 1, '只补差额（基础金币在通关时已入账）');
  assert.ok(ctx.persisted >= 1, '发完要落盘');
  const st = JSON.parse(ctx.localStorage.getItem('mine_settle_bonus_v1'));
  assert.strictEqual(st.used, 1);
  const grant = ctx.traces.find((x) => x.e === 'settle_bonus_grant');
  assert.ok(grant && grant.gain === mult - 1, '发放要留痕，日志能算出发了多少');
});

test('到日上限后不再给入口，且「为什么不给」进日志（静默降级要可聚合）', () => {
  const ctx = sandbox();
  const cap = cfg.settle.adBonus.dailyCap;
  const base = ctx.clock;
  for (let i = 0; i < cap; i++) {
    ctx.clock = base + i * (cfg.settle.adBonus.cooldownMs + 1000);
    assert.ok(ctx.settleBonusOffer(1, ctx.clock), '第 ' + (i + 1) + ' 次应当可用');
    ctx.claimSettleBonus(1);
  }
  ctx.clock = base + (cap + 5) * (cfg.settle.adBonus.cooldownMs + 1000);
  assert.strictEqual(ctx.settleBonusOffer(1, ctx.clock), null, '到上限就不给入口');
  const skip = ctx.traces.filter((x) => x.e === 'settle_bonus_skip').pop();
  assert.strictEqual(skip.why, 'daily-cap');
  assert.strictEqual(skip.cap, cap);
  assert.strictEqual(ctx.save.coinsEarned, cap * (cfg.settle.adBonus.multiplier - 1));
});

test('冷却中不给入口，理由与已等待时长都记进日志', () => {
  const ctx = sandbox();
  const now = ctx.clock;
  ctx.settleBonusOffer(1, now);
  ctx.claimSettleBonus(1);
  ctx.clock = now + 1000;
  assert.strictEqual(ctx.settleBonusOffer(1, ctx.clock), null);
  const skip = ctx.traces.filter((x) => x.e === 'settle_bonus_skip').pop();
  assert.strictEqual(skip.why, 'cooldown');
  assert.ok(skip.sinceMs >= 0 && skip.sinceMs < cfg.settle.adBonus.cooldownMs);
});

test('次日归零：UTC 跨日后又能领', () => {
  const ctx = sandbox();
  const d1 = Date.parse('2026-09-07T23:00:00Z');
  ctx.clock = d1;
  ctx.settleBonusOffer(1, d1);
  ctx.claimSettleBonus(1);
  ctx.clock = d1 + DAY;
  assert.ok(ctx.settleBonusOffer(1, ctx.clock), 'UTC 次日应当恢复');
});

test('看广告期间被别的标签页用完额度：如实告知，不静默吞掉这段广告', () => {
  const ctx = sandbox();
  ctx.settleBonusOffer(1, ctx.clock);
  // 模拟另一个标签页把额度用光：广告回来时状态已不可用
  ctx.watchAdFor = (id, onReward, onSettled) => {
    ctx.ads.push(id);
    ctx.sbSave({ day: Math.floor(ctx.clock / DAY), used: cfg.settle.adBonus.dailyCap, lastAt: ctx.clock });
    onReward();
    if (onSettled) onSettled();
  };
  ctx.claimSettleBonus(1);
  assert.strictEqual(ctx.save.coinsEarned, 0, '不可用时不发奖');
  assert.match(ctx.toasts.join('|'), /adBonusUsedUp/, '必须给出可见解释');
  assert.ok(ctx.traces.some((x) => x.e === 'settle_bonus_lost'), '这条分支要计数，不能静默');
});

test('文案键齐全且占位符一致（防 i18n 占位符漂移）', () => {
  const zh = cfg.i18n.locales.zh, en = cfg.i18n.locales.en;
  ['winAdBonus', 'adBonusGot', 'adBonusUsedUp'].forEach((k) => {
    assert.ok(zh[k], 'zh 缺 ' + k);
    assert.ok(en[k], 'en 缺 ' + k);
    const ph = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',');
    assert.strictEqual(ph(zh[k]), ph(en[k]), k + ' 的中英占位符必须一致');
  });
  // 调用点传的变量名要和字典里的占位符对得上（漂移不报错，只会把 {mult} 原样显示给玩家）
  assert.strictEqual((zh.winAdBonus.match(/\{(\w+)\}/g) || []).sort().join(','), '{mult},{n}');
  assert.strictEqual((zh.adBonusGot.match(/\{(\w+)\}/g) || []).sort().join(','), '{mult},{n},{total}');
});
