'use strict';
/* 门禁：多个浏览器登录同一账号时，金币必须靠「定期从服务器读」收敛。
   用户实报（2026-09-01）：「一个用户在多个浏览器都打开，金币经常变化，不同浏览器就不一样，
   有时突然变多，有时突然变少 —— 就是因为多个客户端都自己算自己的，每次都用自己的结果更新服务器」。

   本门禁盯两件事：
     ① 合并口径：云端行合进本地只走 applyCloudRow 一处，账目单调取大，
        别端的消费要如实反映为余额下降（不是把它抹掉），且要报出 delta / balance；
     ② 拉取时机接线：启动后进入定期同步、回前台补拉、首页/背包/买不起时各补一次。
   调度规则本身（周期、退避、频控、超时）由 core/cloudsync.test.js 覆盖。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, 'mine.html'), 'utf8');
const StockCore = require('./core/stock.js');
const CoinsCore = require('./core/coins.js');
const PlatformCore = require('./core/platform.js');

function slice(head) {
  const i = html.indexOf(head);
  assert.ok(i > 0, `找不到 ${head}`);
  let depth = 0, started = false;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    const c = html[j];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return html.slice(i, j + 1); }
  }
  throw new Error('大括号不配平: ' + head);
}

// 用页面自己的配置造 Stock/Coins/Platform（不在测试里另抄一份配置，避免自证）
const CFG = JSON.parse(html.match(/<script id="gameConfig" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const Stock = StockCore.create(CFG.stock);
const Coins = CoinsCore.create(CFG.coins, Stock);
const P = PlatformCore.create(CFG.platform);

function makeCtx(local) {
  const ctx = {
    save: Object.assign({ level: 3, clears: 5, updatedMs: 1000 }, local),
    Stock, Coins,
    Plat: { core: P, mode: 'online', user: { id: 'u1' } },
    S: null,
    toasts: [],
    traces: [],
    persisted: 0,
    rendered: 0,
    toast: (m) => ctx.toasts.push(m),
    t: (k, d) => k + JSON.stringify(d || {}),
    trace: (e, d) => ctx.traces.push(Object.assign({ e }, d)),
    persist: () => { ctx.persisted++; },
    renderHome: () => { ctx.rendered++; },
    renderHud: () => { ctx.rendered++; },
    $: () => ({ hidden: false }),
  };
  vm.createContext(ctx);
  vm.runInContext(slice('function applyCloudRow') + '\n' + slice('function onSyncApplied'), ctx);
  return ctx;
}
const row = (o) => Object.assign({ updated_ms: 9_000_000, level: 3, clears: 5 }, o);

test('别端花掉的金币会如实同步过来（余额下降，不是被抹掉）', () => {
  // 本地：赚过 100、没花过 → 余额 100；云端：同一账号在另一台设备花掉了 80
  const ctx = makeCtx({ coinsEarned: 100, coinsSpent: 0 });
  const out = vm.runInContext(`applyCloudRow(${JSON.stringify(row({ coins_earned: 100, coins_spent: 80 }))}, {})`, ctx);
  assert.strictEqual(out.changed, true);
  assert.strictEqual(out.balance, 20, '另一台设备花掉的 80 必须体现出来');
  assert.strictEqual(out.delta, -80, 'delta 要能告诉玩家/日志「少了多少」');
  assert.strictEqual(ctx.save.coinsSpent, 80);
  assert.ok(ctx.persisted >= 1, '合并结果要落盘，否则刷新又变回去');
});

test('别端赚到的金币也会同步过来（余额上升）', () => {
  const ctx = makeCtx({ coinsEarned: 100, coinsSpent: 20 });
  const out = vm.runInContext(`applyCloudRow(${JSON.stringify(row({ coins_earned: 160, coins_spent: 20 }))}, {})`, ctx);
  assert.strictEqual(out.balance, 140);
  assert.strictEqual(out.delta, 60);
});

test('单调取大：云端那行比本地旧时，本地已花的钱不许被"复活"', () => {
  // 本地已经花到 spent=80，云端还停在 spent=0（那台设备的旧快照）
  const ctx = makeCtx({ coinsEarned: 100, coinsSpent: 80 });
  const out = vm.runInContext(`applyCloudRow(${JSON.stringify(row({ coins_earned: 100, coins_spent: 0 }))}, {})`, ctx);
  assert.strictEqual(ctx.save.coinsSpent, 80, 'spent 只增：旧行不能把已花的钱退回来');
  assert.strictEqual(out.balance, 20);
  assert.strictEqual(out.delta, 0, '没有实际变化就不该报 delta');
});

test('没有云端行 / 未连接平台时，什么都不动', () => {
  const ctx = makeCtx({ coinsEarned: 100, coinsSpent: 0 });
  assert.strictEqual(vm.runInContext('applyCloudRow(null, {}).changed', ctx), false);
  assert.strictEqual(ctx.persisted, 0);
});

test('余额被别端花掉时给一句提示；变多时不打扰', () => {
  const ctx = makeCtx({ coinsEarned: 100, coinsSpent: 0 });
  vm.runInContext(`onSyncApplied({ delta: -80, balance: 20 })`, ctx);
  assert.strictEqual(ctx.toasts.length, 1, '突然变少必须有解释，否则玩家以为游戏在乱扣');
  assert.match(ctx.toasts[0], /coinsSynced/);
  vm.runInContext(`onSyncApplied({ delta: 60, balance: 160 })`, ctx);
  assert.strictEqual(ctx.toasts.length, 1, '变多是好消息，不需要弹提示');
});

test('接线：登录后进入定期同步，且四个「要用余额」的时机都会补拉', () => {
  assert.ok(/<script src="\.\/core\/cloudsync\.js"><\/script>/.test(html), '页面要引入 core/cloudsync.js');
  assert.ok(/startCloudSync\(session\);/.test(html), '云档载入后必须启动定期同步');
  assert.ok(/CloudSyncCore\.create\(\{[\s\S]{0,400}pull: function \(\) \{ return session\.loadCloud\(\); \}/.test(html),
    '拉取必须走 session.loadCloud（服务器是权威）');
  assert.ok(/syncNow\('home'\)/.test(slice('function showHome')), '回首页要对账（首页显示余额）');
  assert.ok(/syncNow\('bag'\)/.test(slice('function openBag')), '打开背包要对账');
  assert.ok(/syncNow\('after-fail'\)/.test(slice('function buyTool')),
    '买不起时要对账：可能是别的设备刚赚了钱而这台还没同步到');
  assert.ok(/visibilityState === 'visible' && CoinSync\) CoinSync\.onVisible\(\)/.test(html),
    '回到前台要立刻补拉（后台期间别端可能动过账）');
});

test('合并只有一份口径：初始化那次也走 applyCloudRow，不许再自己拼一遍 mergeSave', () => {
  const from = html.indexOf('session.loadCloud().then');
  const boot = html.slice(from, html.indexOf('}).catch(function (err) {', from));
  assert.ok(/applyCloudRow\(row, \{ localFresh: localFresh \}\)/.test(boot), '初始化必须复用同一入口');
  assert.ok(!/mergeSave\(save, row/.test(boot), '初始化里不许再留一份手写合并（口径分家必然漂移）');
});

test('同步事件进埋点：失败/跳过/生效都查得到', () => {
  assert.ok(/onEvent: function \(name, data\) \{ trace\(name, data\)/.test(html),
    'cloudsync 的事件必须接进 trace（手机上排查全靠它）');
  assert.ok(/trace\('sync_off'/.test(html), '未登录/本地模式下「没有同步」这件事本身也要留痕');
});
