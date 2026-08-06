/* 道具框架 core 单元测试：注册表/库存/消费事务/渠道账链/解锁谓词 + fail-fast
   （issue #1 · S4/S5/S6 的机制面；场景级断言见 fixtures/S4–S6） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('./powerups.js');

test('声明→注册→入账→消费：core 对 id 零认知，账实一致', () => {
  const pu = P.create([
    { id: 'shuffle', grantOn: [{ trigger: 'levelClear', qty: 1 }, { trigger: 'dailyLogin', qty: 2 }] },
    { id: 'bomb', grantOn: [{ trigger: 'purchase', qty: 5 }, { trigger: 'event', qty: 1 }] }
  ]);
  let fired = 0;
  pu.register('shuffle', () => { fired += 1; return true; });
  pu.register('bomb', () => true);
  pu.fire('levelClear'); pu.fire('dailyLogin'); pu.fire('purchase'); pu.fire('event');
  assert.equal(pu.count('shuffle'), 3);
  assert.equal(pu.count('bomb'), 6);
  assert.deepEqual(pu.consume('shuffle'), { ok: true });
  assert.equal(fired, 1);
  assert.equal(pu.count('shuffle'), 2);
  const sum = pu.ledger().reduce((a, e) => a + e.n, 0);
  assert.equal(sum, pu.count('shuffle') + pu.count('bomb'), '账目求和 = 库存总量');
});

test('消费事务：库存空 / handler 失败均不扣账', () => {
  const pu = P.create([{ id: 'undo' }]);
  pu.register('undo', () => false);
  assert.deepEqual(pu.consume('undo'), { ok: false, reason: 'empty' });
  pu.grant('undo', 1, 'manual');
  assert.deepEqual(pu.consume('undo'), { ok: false, reason: 'handler' }, 'handler 返回 false 视为失败');
  assert.equal(pu.count('undo'), 1, '失败不扣库存');
});

test('解锁谓词：AND 语义，level/ad/currency 三类', () => {
  const pu = P.create([{ id: 'bomb', unlock: [{ type: 'level', n: 5 }, { type: 'ad' }] }]);
  assert.equal(pu.unlocked('bomb', { level: 4, adWatched: true }), false);
  assert.equal(pu.unlocked('bomb', { level: 5 }), false);
  assert.equal(pu.unlocked('bomb', { level: 5, adWatched: true }), true);
  assert.equal(P.evaluateUnlock(P.validateUnlock([{ type: 'currency', n: 100 }]), { coins: 100 }), true);
  assert.equal(P.evaluateUnlock(P.validateUnlock(null), {}), true, '无谓词 = 默认解锁');
});

test('fail-fast：未声明 id/重复 id/未知渠道/未知谓词/非法数量 一律抛错', () => {
  assert.throws(() => P.create('x'), /必须是数组/);
  assert.throws(() => P.create([{ id: 'a' }, { id: 'a' }]), /重复/);
  assert.throws(() => P.create([{ id: 'x', grantOn: [{ trigger: 'lootbox', qty: 1 }] }]), /未知获取渠道/);
  assert.throws(() => P.create([{ id: 'x', grantOn: [{ trigger: 'event', qty: 0 }] }]), /qty 必须是 >0/);
  assert.throws(() => P.create([{ id: 'x', unlock: [{ type: 'vip' }] }]), /未知谓词类型/);
  assert.throws(() => P.create([{ id: 'x', effect: 'boom' }]), /未知键/);
  const pu = P.create([{ id: 'undo' }]);
  assert.throws(() => pu.grant('hint', 1, 'purchase'), /未声明/);
  assert.throws(() => pu.grant('undo', 0, 'purchase'), /必须是 >0/);
  assert.throws(() => pu.consume('undo'), /未注册效果 handler/);
  assert.throws(() => pu.register('undo', 'not-fn'), /必须是函数/);
  assert.throws(() => pu.fire('lootbox'), /未知渠道触发/);
});
