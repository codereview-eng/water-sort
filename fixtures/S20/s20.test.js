/* S20 反例硬闸：双游戏不串味（issue #1 场景清单 · I）
   验收：同端双游戏（water + sudoku + mock C）实例状态、存档命名空间、
   config 解析互不污染——对应行业反模式「window.* 全局串味」。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Powerups = require('../../core/powerups.js');
const Stats = require('../../core/stats.js');
const Bridge = require('../../core/bridge.js');
const Settle = require('../../core/settle.js');

const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S20: 道具库存实例隔离——water 入账/消费不影响 sudoku', () => {
  const w = Powerups.create(gameCfg('water').powerups);
  const s = Powerups.create(gameCfg('sudoku').powerups);
  w.fire('levelClear');
  assert.ok(w.count('undo') > 0, 'water 有入账');
  assert.equal(s.count('hint'), 0, 'sudoku 库存不动');
  assert.throws(() => s.count('undo'), /未声明/, 'sudoku 根本不认识 water 的道具 id');
});

test('S20: 档案/排行实例隔离——事件流互不串', () => {
  const w = Stats.createArchive(gameCfg('water').lifetimeStats);
  const s = Stats.createArchive(gameCfg('sudoku').lifetimeStats);
  w.onEvent('pour'); w.onEvent('pour');
  assert.equal(w.get('bottles_poured'), 2);
  assert.equal(s.get('cells_filled'), 0, '同名事件流不喂错游戏');
  assert.throws(() => s.get('bottles_poured'), /未声明 statKey/);
});

test('S20: 存档命名空间隔离——同一 storage 双游戏互不覆盖', () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  const stores = {};
  for (const id of ['water', 'sudoku', 'mockc']) {
    const cfg = gameCfg(id);
    stores[id] = Bridge.createSaveStore(cfg.save, Bridge.createWebHost(storage, cfg.host));
    stores[id].save({ tag: id });
  }
  for (const id of ['water', 'sudoku', 'mockc']) {
    assert.equal(stores[id].load().tag, id, id + ' 读回自己的存档');
  }
  assert.equal(m.size, 3, '三游戏三把 key（前缀命名空间），零覆盖');
});

test('S20: 结算实例隔离——mock C 的 streakRamp 状态不漂给 water', () => {
  const w = Settle.create(gameCfg('water').settle);
  const c = Settle.create(gameCfg('mockc').settle);
  const cv = c.settle({ streak: 3, clearCount: 1 });
  const wv = w.settle({ diff: 4, streak: 3, clearCount: 1 });
  assert.notEqual(cv, wv, '两游戏结算互不相同');
  assert.equal(w.settle({ diff: 4, streak: 3, clearCount: 1 }), wv, 'water 结算与 mock C 调用次序无关（无共享可变态）');
});

test('S20: 双游戏 config 解析零共享——同键不同值各自生效', () => {
  const w = gameCfg('water');
  const s = gameCfg('sudoku');
  assert.notDeepEqual(w.powerups.map((p) => p.id), s.powerups.map((p) => p.id));
  assert.notEqual(w.host.storagePrefix, s.host.storagePrefix);
  assert.notDeepEqual(w.i18n.locales, s.i18n.locales);
});
