/* S5 同一道具四种获取渠道（issue #1 场景清单 · B 道具框架）
   验收：通关获取／金币购买／活动发放／每日登录赠送——渠道纯 config 切换，
   core 出入账一套代码（同一 grant 账链，账实一致）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../core/powerups.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S5: mock 游戏 C 四渠道全走同一账链，账目求和 = 库存', () => {
  const pu = P.create(FIX.mockc);
  pu.fire('levelClear');
  pu.fire('purchase');
  pu.fire('event');
  pu.fire('dailyLogin');
  assert.equal(pu.count('shuffle'), 1 + 5 + 1 + 2);
  const bySource = {};
  for (const e of pu.ledger()) bySource[e.source] = (bySource[e.source] || 0) + e.n;
  assert.deepEqual(bySource, { levelClear: 1, purchase: 5, event: 1, dailyLogin: 2 }, '每渠道入账可追溯');
});

test('S5: 渠道开关 = config 差异——water 只声明 levelClear，其余渠道触发不入账', () => {
  const pu = P.create(FIX.water);
  pu.fire('purchase');
  pu.fire('dailyLogin');
  assert.equal(pu.count('undo'), 0, '未声明渠道零入账');
  pu.fire('levelClear');
  assert.equal(pu.count('undo'), 1);
});

test('S5: 真实游戏 config 渠道声明可加载且触发行为一致', () => {
  const pu = P.create(gameCfg('mockc').powerups);
  pu.fire('purchase');
  assert.equal(pu.count('bomb'), 5, 'mockc bomb 购买渠道 qty=5');
  assert.equal(pu.count('shuffle'), 0, 'shuffle 未声明 purchase 渠道');
});
