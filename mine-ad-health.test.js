'use strict';
/* 广告健康度的**页面接线**门禁（issue #1 · 广告奖励可信度 4/4）
   core 的 health() 单测全绿，也挡不住页面这层白干：跨会话累计没落盘、
   告警没人调、诊断行没挂上去 —— 那就等于"降级分支依旧没人看得见"，
   本机纪律第 5 条要的东西一条也没兑现。
   所以这里把 mine.html 的三个函数抠出来，配真 core 真跑。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const AdPlayCore = require('./core/adplay.js');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/mine/game.config.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, 'mine.html'), 'utf8');

function htmlFunction(name) {
  const m = html.match(new RegExp('  function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}'));
  assert.ok(m, 'mine.html 缺函数 ' + name);
  return m[0];
}

/* 沙箱：AdPlayCore 是真的；AdPlay 只替换成"本会话 stats 长这样"的最小替身，
   因为这里要测的是页面怎么累计/判定/落盘，不是广告怎么播。 */
function sandbox(sessionStats, stored) {
  const store = {};
  if (stored !== undefined) store.mine_addiag_v1 = JSON.stringify(stored);
  const errors = [];
  const ctx = {
    AdPlayCore,
    AdPlay: { stats: () => sessionStats },
    CFG: cfg,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    console: { error: (m) => errors.push(String(m)), warn: () => {} },
    JSON, Math, Object,
    STOCK_AUDIT: { checked: 0, clamped: 0, unknownAge: 0 },
    AD_DIAG_KEY: 'mine_addiag_v1',
    AD_HEALTH: { ok: true, alerts: [] },
    AD_ALERTED: {},
    store, errors
  };
  vm.createContext(ctx);
  vm.runInContext([
    htmlFunction('readAdDiag'),
    'var AD_DIAG_BASE = readAdDiag();',
    htmlFunction('adTotals'),
    htmlFunction('checkAdHealth'),
    htmlFunction('adDiagText')
  ].join('\n'), ctx);
  return ctx;
}

const clean = { attempts: 4, ok: 4, failed: 0, reasons: {}, reward: { valued: 4, not_valued: 0, unknown: 0 }, bySource: {} };
const allNoLeave = { attempts: 6, ok: 0, failed: 6, reasons: { 'directlink:no-leave': 6 },
  reward: { valued: 0, not_valued: 0, unknown: 0 }, bySource: {} };

test('接线：累计跨会话落盘，本次会话不会把上次的重复计一遍', () => {
  const ctx = sandbox(clean, { attempts: 10, ok: 9, failed: 1, reasons: { 'monetag:no-fill': 1 },
    reward: { valued: 9, not_valued: 0, unknown: 0 }, bySource: {} });
  ctx.checkAdHealth();
  const saved = JSON.parse(ctx.store.mine_addiag_v1);
  assert.strictEqual(saved.attempts, 14, '上次 10 + 本次 4');
  ctx.checkAdHealth();                       // 同一会话再算一次
  assert.strictEqual(JSON.parse(ctx.store.mine_addiag_v1).attempts, 14, '同会话重复调用不能越加越多');
});

test('接线：webview 不触发 visibilitychange → no-leave 常态化，日志必须喊出来', () => {
  /* 这是 A2 最危险的失败形态：看起来"防住了作弊"，实际每个诚实玩家都拿不到奖励。 */
  const ctx = sandbox(allNoLeave, { attempts: 8, ok: 0, failed: 8,
    reasons: { 'directlink:no-leave': 8 }, reward: {}, bySource: {} });
  ctx.checkAdHealth();
  assert.strictEqual(ctx.AD_HEALTH.ok, false);
  const log = ctx.errors.join('\n');
  assert.match(log, /AD-HEALTH-ALERT/, '告警要有独特标记，抓日志才找得到');
  assert.match(log, /directlink:no-leave/, '必须说清是哪条降级路径，不能只报一个"不健康"');
  assert.match(log, /rate=100%/, '要带比例，否则看不出是不是常态化');
  const before = ctx.errors.length;
  ctx.checkAdHealth();
  assert.strictEqual(ctx.errors.length, before, '同一类每会话只喊一次，别把日志刷爆');
});

test('接线：一切正常时不喊，诊断行照样能看到累计与健康结论', () => {
  const ctx = sandbox(clean, { attempts: 20, ok: 19, failed: 1, reasons: { 'monetag:no-fill': 1 },
    reward: { valued: 19, not_valued: 0, unknown: 0 }, bySource: {} });
  ctx.checkAdHealth();
  assert.deepStrictEqual(ctx.errors, []);
  const line = ctx.adDiagText();
  assert.match(line, /ads ok\/fail=23\/1/);
  assert.match(line, /health=ok/);
  assert.match(line, /valued/);
  assert.match(line, /stock=/, '账本体检的计数也要在同一行看得到');
});

test('接线：诊断行真的挂在设置页那行构建号上，且广告结束会触发体检', () => {
  const i = html.indexOf("line.textContent = 'build ' + build + '\\n'");
  assert.ok(i !== -1, '找不到诊断行拼装处');
  assert.ok(html.slice(i, i + 200).includes('adDiagText()'), '诊断行没把广告健康度挂上去');
  const w = html.indexOf('function watchAdFor(');
  assert.ok(html.slice(w, w + 1600).includes('checkAdHealth()'), '广告结束后没有调用体检 = 白写');
});

test('配置：阈值在真配置里声明过（不是只吃 core 默认值）', () => {
  assert.ok(cfg.ads.health, 'games/mine/game.config.json 缺 ads.health');
  for (const k of ['minSamples', 'maxFailRate', 'maxReasonRate', 'minValuedRate']) {
    assert.strictEqual(typeof cfg.ads.health[k], 'number', 'ads.health 缺 ' + k);
  }
});

test('接线：两个游戏的兜底广告卡都改成"只在可见时走表"，不再硬减秒', () => {
  /* issue #1 · S2：切到别的标签表照走 = 什么都不用看就能拿奖。
     这条门禁盯的是"没人偷偷把它改回硬减秒"。 */
  const water = fs.readFileSync(path.join(__dirname, 'water.html'), 'utf8');
  for (const [name, src] of [['mine.html', html], ['water.html', water]]) {
    const i = src.indexOf('function houseAd(');
    assert.ok(i !== -1, name + ' 缺 houseAd');
    const body = src.slice(i, i + 1400);
    assert.ok(body.includes('createWatchClock('), name + ' 的兜底广告卡没用可见性计时器');
    assert.ok(!/left -= 1/.test(body), name + ' 的兜底广告卡还在硬减秒（切后台照走）');
  }
});
