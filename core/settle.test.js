/* 结算 core 单元测试：默认行为 + 三模型 + adBonus + 首通/衰减 + fail-fast
   （issue #1 · S1/S2/S3 的机制面；场景级断言见 fixtures/S1–S3） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./settle.js');

test('默认配置 = 固定值结算、adBonus 关闭（附加式，不改既有行为）', () => {
  const c = S.create(null);
  assert.equal(c.settle({ diff: 9, streak: 9, clearCount: 5 }), 10);
  assert.equal(c.adVisible(), false);
  assert.equal(c.adAvailable({}, Date.now()), false);
});

test('三种模型：fixed / difficulty / streakRamp（同一 create，输出各异）', () => {
  assert.equal(S.create({ mode: 'fixed', base: 10 }).settle({ diff: 4 }), 10);
  assert.equal(S.create({ mode: 'difficulty', base: 10, coeff: 0.5 }).settle({ diff: 4 }), 30);
  assert.equal(S.create({ mode: 'streakRamp', base: 10, coeff: 1 }).settle({ streak: 3 }), 40);
  assert.equal(S.create({ mode: 'streakRamp', base: 10, coeff: 1, cap: 60 }).settle({ streak: 99 }), 60);
});

test('首通放大与重复衰减到下限', () => {
  const c = S.create({ base: 10, firstClearMult: 3, decay: { rate: 0.5, floor: 2 } });
  assert.equal(c.settle({ clearCount: 0 }), 30);
  assert.equal(c.settle({ clearCount: 1 }), 5);
  assert.equal(c.settle({ clearCount: 10 }), 2);
});

test('adBonus：倍增、UTC 日上限、冷却、次日归零', () => {
  const now = 86400000 * 100;
  const c = S.create({ adBonus: { enabled: true, multiplier: 3, dailyCap: 2, cooldownMs: 1000 } });
  assert.equal(c.adVisible(), true);
  let r = c.adApply(10, {}, now);
  assert.equal(r.coins, 30);
  assert.equal(c.adAvailable(r.state, now + 1), false, '冷却中不可用');
  r = c.adApply(10, r.state, now + 1000);
  assert.equal(c.adAvailable(r.state, now + 5000), false, '到每日上限');
  assert.equal(c.adAvailable(r.state, now + 86400000), true, 'UTC 次日归零');
});

test('fail-fast：未知键/未知模式/非法数值/非法 decay/非法 adBonus 一律加载期抛错', () => {
  assert.throws(() => S.create({ mode: 'exponential' }), /未知 mode/);
  assert.throws(() => S.create({ curve: 'x^2' }), /未知键/);
  assert.throws(() => S.create({ base: -1 }), /必须是 >0/);
  assert.throws(() => S.create({ cap: 0 }), /必须是 >0/);
  assert.throws(() => S.create({ decay: { rate: 2, floor: 0 } }), /decay\.rate/);
  assert.throws(() => S.create({ decay: { rate: 0.5, floor: -1 } }), /decay\.floor/);
  assert.throws(() => S.create({ adBonus: { enabled: true, multiplier: 1 } }), /multiplier/);
  assert.throws(() => S.create({ adBonus: { enabled: true, dailyCap: -3 } }), /dailyCap/);
  assert.throws(() => S.create({ adBonus: { free: true } }), /adBonus 未知键/);
  assert.throws(() => S.create({ adBonus: { enabled: false } }).adApply(10, {}, 0), /不可用/);
});
