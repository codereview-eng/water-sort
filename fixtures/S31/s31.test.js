/* S31 非法 cosmetics 配置 fail-fast（issue #1 场景清单 · M v2 反例边界）
   验收：引用不存在的皮肤资源、解锁条件引用未声明的连胜阈值等——
   构建期/加载期报错（同 S19 纪律），v2 三模块（cosmetics/streak/
   placements）反例表驱动全量覆盖。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../core/cosmetics.js');
const K = require('../../core/streak.js');
const PL = require('../../core/placements.js');

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'invalid-configs.json'), 'utf8'));

const LOADERS = {
  cosmetics: (cfg) => C.create(cfg, { streakEnabled: true }),
  'cosmetics.noStreak': (cfg) => C.create(cfg, { streakEnabled: false }),
  streak: (cfg) => K.create(cfg),
  placements: (cfg) => PL.create(cfg, () => true)
};

test('S31: v2 反例表全量——每一条非法配置都在加载期被显式拒绝', () => {
  let n = 0;
  for (const c of CASES) {
    const loader = LOADERS[c.module];
    assert.ok(loader, '反例表引用了未知模块 ' + c.module);
    assert.throws(() => loader(c.cfg), new RegExp(c.error), c.module + ': ' + c.why);
    n += 1;
  }
  assert.ok(n >= 12, '反例表至少 12 条（现 ' + n + ' 条）');
});

test('S31: v2 三模块覆盖面——cosmetics/streak/placements 无一漏网', () => {
  const covered = new Set(CASES.map((c) => c.module.split('.')[0]));
  for (const m of ['cosmetics', 'streak', 'placements']) assert.ok(covered.has(m), m + ' 缺反例');
});

test('S31: 合法对照组——三份真实 game config 的 v2 键全部可加载（防误杀）', () => {
  for (const id of ['water', 'sudoku', 'mockc']) {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));
    C.create(cfg.cosmetics, { streakEnabled: cfg.streak.enabled });
    K.create(cfg.streak);
    PL.create(cfg.ads.placements, () => true);
  }
});
