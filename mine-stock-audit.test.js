'use strict';
/* 账本体检的**页面接线**门禁（issue #1 · 广告奖励可信度 3/4）
   core/stock.js 的 audit() 单测全绿，也挡不住页面这一层接错：
   比如把服务端的 created_date 读成别的列名、算出来的天数是毫秒、
   或者削平之后忘了落盘 —— 那样线上就是「查了个寂寞」。
   所以这里把 mine.html 里的两个函数原文抠出来，用真的 core/stock.js 与真配置**真跑一遍**。
   （教训见 repo memory「页面接线要单独测」「HTML 门禁 regex 会自我误报」。） */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const StockCore = require('./core/stock.js');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/mine/game.config.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, 'mine.html'), 'utf8');

function htmlFunction(name) {
  const m = html.match(new RegExp('  function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}'));
  assert.ok(m, 'mine.html 缺函数 ' + name);
  return m[0];
}

/* 把两个函数搬进沙箱，依赖（Stock/save/persist/console/STOCK_AUDIT）全部由这里注入，
   注入的是**真** Stock（用真配置建的），不是桩。 */
function sandbox(save) {
  const warns = [];
  const ctx = {
    Stock: StockCore.create(cfg.stock),
    save,
    persisted: 0,
    persist() { ctx.persisted += 1; },
    console: { warn: (m) => warns.push(String(m)) },
    Date,
    JSON,
    isFinite,
    Object,
    STOCK_AUDIT: { checked: 0, clamped: 0, unknownAge: 0, last: null },
    warns
  };
  vm.createContext(ctx);
  vm.runInContext(htmlFunction('accountAgeDays') + '\n' + htmlFunction('auditStock'), ctx);
  return ctx;
}

const DAY = 86400000;
const rowAged = (days) => ({ created_date: new Date(Date.now() - days * DAY).toISOString() });

test('接线：云档里 99999 的道具被削平并落盘，异常明细进日志', () => {
  const save = { toolMineGranted: 99999, toolMineSpent: 3 };
  const ctx = sandbox(save);
  ctx.auditStock(rowAged(3));
  const cap = ctx.Stock.ceiling('toolMine', 3);
  assert.ok(cap > 0 && cap < 99999, '上限要落在正常量级');
  assert.strictEqual(save.toolMineGranted, cap, '削平后的值必须真的写回 save');
  assert.strictEqual(ctx.persisted, 1, '削平之后必须落盘，否则下次同步又被顶回去');
  assert.strictEqual(ctx.STOCK_AUDIT.clamped, 1);
  assert.match(ctx.warns.join('\n'), /ledger-anomaly/, '异常必须可查（不是静默降级）');
  assert.match(ctx.warns.join('\n'), /99999/, '日志要带被声称的原值，否则事后无法判断阈值合不合理');
});

test('接线：正常玩家不被动一根汗毛，也不刷日志', () => {
  const save = { toolMineGranted: 9, toolMineSpent: 4, coinsEarned: 300, coinsSpent: 200 };
  const ctx = sandbox(save);
  ctx.auditStock(rowAged(5));
  assert.strictEqual(save.toolMineGranted, 9);
  assert.strictEqual(ctx.persisted, 0);
  assert.deepStrictEqual(ctx.warns, []);
  assert.strictEqual(ctx.STOCK_AUDIT.checked, 1);
});

test('接线：天数只认服务端 created_date —— 云行没有它就不削，只计数', () => {
  const save = { toolMineGranted: 99999 };
  const ctx = sandbox(save);
  ctx.auditStock({ level: 3 });            // 没有 created_date 的老行
  assert.strictEqual(save.toolMineGranted, 99999, '拿不到可信天数时宁可不削，也不能凭本地时钟削真玩家');
  assert.strictEqual(ctx.STOCK_AUDIT.unknownAge, 1);
  assert.match(ctx.warns.join('\n'), /unknown-age/, '这条路走了多少次必须能看见，否则常态化走空没人知道');
});

test('接线：created_date 是坏值也走 unknown-age，不能算出 NaN 天', () => {
  const ctx = sandbox({ toolMineGranted: 99999 });
  ctx.auditStock({ created_date: '不是时间' });
  assert.strictEqual(ctx.STOCK_AUDIT.unknownAge, 1);
  assert.strictEqual(ctx.STOCK_AUDIT.clamped, 0);
});

test('接线：天数换算的是「天」不是毫秒（算错量纲上限会大到没有意义）', () => {
  const ctx = sandbox({});
  const days = ctx.accountAgeDays(rowAged(10));
  assert.ok(days > 9.9 && days < 10.1, '开档 10 天应算出约 10，得到 ' + days);
});

test('配置：ceiling 已在真配置里声明，且宽到不会误伤正常玩家', () => {
  assert.ok(cfg.stock.ceiling && cfg.stock.ceiling.perDay, 'games/mine/game.config.json 缺 stock.ceiling');
  const S = StockCore.create(cfg.stock);
  // 一天内靠广告最多拿的量（5 个广告位各自的每日上限之和）远低于上限，才不会误伤
  const adsPerDay = Object.values(cfg.ads.placements)
    .reduce((n, p) => n + ((p.capping && p.capping.maxPerDay) || 0), 0);
  assert.ok(S.ceiling('toolMine', 1) > adsPerDay * 2,
    '上限必须显著高于「一天把所有广告位刷满」的量，否则重度玩家会被误判');
});
