/* S6 锁定道具解锁条件（issue #1 场景清单 · B 道具框架）
   验收：到第 N 关解锁／看广告解锁——解锁判定引擎复用（同一谓词求值器），
   条件全配置（lockedBottleSlots 雏形的通用化）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../core/powerups.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S6: water 到第 3 关解锁（level 谓词）', () => {
  const pu = P.create(FIX.water);
  assert.equal(pu.unlocked('addBottle', { level: 2 }), false);
  assert.equal(pu.unlocked('addBottle', { level: 3 }), true);
});

test('S6: mock 游戏 C 组合条件（到第 5 关 AND 看广告）——同一谓词引擎', () => {
  const pu = P.create(FIX.mockc);
  assert.equal(pu.unlocked('bomb', { level: 5 }), false, '只到关数不够');
  assert.equal(pu.unlocked('bomb', { level: 4, adWatched: true }), false, '只看广告不够');
  assert.equal(pu.unlocked('bomb', { level: 5, adWatched: true }), true);
});

test('S6: 谓词词汇受限——未知条件类型加载期抛错', () => {
  assert.throws(() => P.create([{ id: 'x', unlock: [{ type: 'vip' }] }]), /未知谓词类型/);
  assert.throws(() => P.validateUnlock([{ type: 'level', n: 0 }]), /n 必须是 >0/);
});

test('S6: 真实游戏 config 解锁声明落地且判定一致', () => {
  const water = P.create(gameCfg('water').powerups);
  assert.equal(water.unlocked('addBottle', { level: 3 }), true);
  assert.equal(water.unlocked('undo', {}), true, '未声明 unlock = 默认解锁');
  const mockc = P.create(gameCfg('mockc').powerups);
  assert.equal(mockc.unlocked('bomb', { level: 5, adWatched: true }), true);
});
