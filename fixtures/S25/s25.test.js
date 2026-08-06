/* S25 背景/皮肤解锁条件差异（issue #1 场景清单 · K 皮肤系统）
   验收：A 按关卡进度；B 看广告；C 货币购买；D 连胜达标——解锁条件是
   统一谓词集（与 S5/S6 锁瓶解锁同一套框架），cosmetics core 不为任何
   条件写 if。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../core/cosmetics.js');
const P = require('../../core/powerups.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S25: A 进度解锁——level 谓词与 S6 同源', () => {
  const c = C.create(FIX.water);
  assert.equal(c.isUnlocked('ocean-bg', { level: 19 }), false);
  assert.equal(c.isUnlocked('ocean-bg', { level: 20 }), true);
});

test('S25: B 广告解锁——ad 谓词纯配置', () => {
  const c = C.create(FIX.sudoku);
  assert.equal(c.isUnlocked('dark-skin', {}), false);
  assert.equal(c.isUnlocked('dark-skin', { adWatched: true }), true);
});

test('S25: C 货币购买——走 S28 购买链，拥有即解锁', () => {
  const c = C.create(FIX.mockcBuy);
  const inv = P.create([{ id: 'gold-skin', grantOn: [{ trigger: 'purchase', qty: 1 }] }]);
  assert.equal(c.isUnlocked('gold-skin', {}), false, '纯购买品无谓词');
  assert.deepEqual(c.buy('gold-skin', { coins: 10 }, inv), { ok: true });
  assert.equal(inv.count('gold-skin'), 1, '拥有态在库存（同 S5/S6 道具同源）');
});

test('S25: D 连胜达标——streak 谓词进同一注册表；未启用 streak 的游戏拒绝声明', () => {
  const c = C.create(FIX.mockcStreak, { streakEnabled: true });
  assert.equal(c.isUnlocked('fire-bg', { streak: 2 }), false);
  assert.equal(c.isUnlocked('fire-bg', { streak: 3 }), true);
  assert.throws(() => C.create(FIX.mockcStreak, { streakEnabled: false }), /未启用 streak/);
});

test('S25: 真实游戏 config 解锁条件差异化落地且可加载', () => {
  for (const id of ['water', 'sudoku', 'mockc']) {
    C.create(gameCfg(id).cosmetics, { streakEnabled: gameCfg(id).streak.enabled });
  }
  const w = gameCfg('water').cosmetics.catalog;
  assert.ok(w.some((x) => x.unlock && x.unlock[0].type === 'level'), 'water 有进度解锁项');
});
