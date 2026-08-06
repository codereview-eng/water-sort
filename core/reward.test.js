/* core/reward 配置化测试：与既有入口行为全等 + S1/S2 配置差异化 + S19 fail-fast（issue #1） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('./reward.js');
const legacy = require('../reward.js');

function loadCfg(id) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'games', id, 'game.config.json'), 'utf8'));
}

test('默认实例与既有 reward.js 入口行为全等（golden 矩阵）', () => {
  const def = core.create(null);
  const T0 = 1000000;
  for (const e of [0, 1, 15, 50, 60, 105, 119, 120, 121, 200]) {
    for (const dt of [-5000, 0, 1, 30000, 59999, 60000, 61000, 120000, 3600000, 86400000]) {
      assert.deepEqual(def.restore(e, T0, T0 + dt), legacy.restore(e, T0, T0 + dt));
    }
  }
  for (let l = 1; l <= 300; l++) {
    assert.equal(def.levelDiff(l), legacy.levelDiff(l));
    assert.equal(def.levelSeed(l), legacy.levelSeed(l));
  }
  for (const k of ['E_MAX', 'E_COST', 'E_TICK', 'E_AD']) assert.equal(def[k], legacy[k]);
});

test('S1/S2: water 与 sudoku 配置等于默认值（行为不变）', () => {
  for (const id of ['water', 'sudoku']) {
    const r = core.create(loadCfg(id).reward);
    assert.equal(r.E_MAX, 120);
    assert.equal(r.E_COST, 15);
    assert.equal(r.E_TICK, 60000);
    assert.equal(r.E_AD, 60);
  }
});

test('S1/S2: mock 游戏 C 纯配置差异化（core 代码零改动）', () => {
  const c = core.create(loadCfg('mockc').reward);
  assert.equal(c.restore(199, 0, 30000).energy, 200); // 上限 200 生效
  assert.equal(c.restore(0, 0, 60000).energy, 2); // 30s 一格
  assert.equal(c.E_COST, 10);
  assert.equal(c.E_AD, 0); // 广告补充关闭
  assert.equal(core.create(null).E_MAX, 120); // 默认实例不被污染
});

test('S19: 非法配置一律加载期抛错', () => {
  assert.throws(() => core.create({ eMax: 100, typoKey: 1 }), /未知键/);
  assert.throws(() => core.create({ eCost: -5 }));
  assert.throws(() => core.create({ eAd: 'sixty' }));
  assert.throws(() => core.create({ eMax: NaN }));
  assert.throws(() => core.create([120, 15]));
  assert.throws(() => core.create({ eMax: 0 }));
});

test('S19: 三份 game.config.json 本身全部合法', () => {
  for (const id of ['water', 'sudoku', 'mockc']) assert.ok(core.create(loadCfg(id).reward));
});
