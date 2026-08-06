/* S19 反例硬闸：非法配置一律加载期抛错——全量覆盖八个 core 模块
   （issue #1 场景清单 · I；对应行业调研反模式：静默吞错/soft-coding）。
   反例表驱动：fixtures/S19/invalid-configs.json，每条 = 模块 + 非法
   config + 期望错误特征；任何模块「静默接受」即测试失败。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Settle = require('../../core/settle.js');
const Powerups = require('../../core/powerups.js');
const EventCore = require('../../core/event.js');
const Ads = require('../../core/ads.js');
const Stats = require('../../core/stats.js');
const Locale = require('../../core/locale.js');
const Shell = require('../../core/shell.js');
const Bridge = require('../../core/bridge.js');

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'invalid-configs.json'), 'utf8'));

// 模块名 → 加载入口（与 CASES 的 module 字段一一对应）
const LOADERS = {
  settle: (cfg) => Settle.create(cfg),
  powerups: (cfg) => Powerups.create(cfg),
  event: (cfg) => EventCore.create(cfg),
  'ads.interstitial': (cfg) => Ads.createInterstitial(cfg),
  'ads.geo': (cfg) => Ads.createGeoGate(cfg),
  'stats.archive': (cfg) => Stats.createArchive(cfg),
  'stats.rank': (cfg) => Stats.createRank(cfg.leaderboards, cfg.statKeys),
  'locale.i18n': (cfg) => Locale.createI18n(cfg),
  'locale.geo': (cfg) => Locale.createGeoAllow(cfg),
  shell: (cfg) => Shell.create(new Map([['known', () => 'ok']]), cfg),
  'bridge.save': (cfg) => Bridge.createSaveStore(cfg, Bridge.createWebHost({ getItem: () => null, setItem: () => {} }, {}))
};

test('S19: 反例表全量——每一条非法配置都在加载期被显式拒绝', () => {
  let n = 0;
  for (const c of CASES) {
    const loader = LOADERS[c.module];
    assert.ok(loader, '反例表引用了未知模块 ' + c.module);
    assert.throws(() => loader(c.cfg), new RegExp(c.error), c.module + ': ' + c.why);
    n += 1;
  }
  assert.ok(n >= 20, '反例表至少 20 条（现 ' + n + ' 条），覆盖八个 core 模块');
});

test('S19: 反例表覆盖面——八个 core 模块无一漏网', () => {
  const covered = new Set(CASES.map((c) => c.module.split('.')[0]));
  for (const m of ['settle', 'powerups', 'event', 'ads', 'stats', 'locale', 'shell', 'bridge']) {
    assert.ok(covered.has(m), '模块 ' + m + ' 缺反例');
  }
});

test('S19: 合法配置对照组——三份真实 game config 全部可加载（防误杀）', () => {
  for (const id of ['water', 'sudoku', 'mockc']) {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));
    Settle.create(cfg.settle);
    Powerups.create(cfg.powerups);
    EventCore.create(cfg.weeklyEvent);
    Ads.createInterstitial(cfg.ads.interstitial);
    Ads.createGeoGate(cfg.geo);
    Stats.createArchive(cfg.lifetimeStats);
    Stats.createRank(cfg.leaderboards, cfg.lifetimeStats.map((s) => s.key));
    Locale.createI18n(cfg.i18n);
    Locale.createGeoAllow(cfg.geoAccess);
    Bridge.createSaveStore(cfg.save, Bridge.createWebHost({ getItem: () => null, setItem: () => {} }, cfg.host));
  }
});
