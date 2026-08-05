const test = require('node:test');
const assert = require('node:assert/strict');
const Powerups = require('./water-powerups');

test('关卡锁配置：只有显式配置的空瓶处于待解锁状态', () => {
  const state = [[0, 1], [], [2], []];
  assert.deepEqual(Powerups.emptyBottleIndexes(state), [1, 3]);
  assert.deepEqual(Powerups.normalizeLockedBottleIndexes(state, [3]), [3]);
  assert.deepEqual(Powerups.normalizeLockedBottleIndexes(state, [3, 1, 3, 0, 99]), [3, 1]);
  assert.deepEqual(Powerups.lockedBottleIndexes(state, [1, 3], []), [1, 3]);
  assert.deepEqual(Powerups.lockedBottleIndexes(state, [1, 3], [1]), [3]);
  assert.deepEqual(Powerups.lockedBottleIndexes(state), []);
});

test('加瓶道具：解锁已有空瓶、扣 1 库存，不新增瓶子也不修改原局面', () => {
  const state = [[0, 1], [], [2], []];
  const before = JSON.stringify(state);
  const result = Powerups.unlockBottle(state, {
    stock: 2, lockedBottleIndexes: [3], unlocked: [], mode: 'item',
  });
  assert.deepEqual(result, {
    state: [[0, 1], [], [2], []],
    stock: 1,
    unlocked: [3],
    index: 3,
  });
  assert.equal(JSON.stringify(state), before);
  assert.equal(result.state.length, state.length);
});

test('广告：按用户点击的位置解锁空瓶，不消耗道具库存', () => {
  const state = [[0], [], []];
  assert.deepEqual(Powerups.unlockBottle(state, {
    stock: 2, lockedBottleIndexes: [2], unlocked: [], mode: 'ad', target: 2,
  }), {
    state: [[0], [], []],
    stock: 2,
    unlocked: [2],
    index: 2,
  });
});

test('空瓶解锁：无库存、重复解锁、非空瓶与全部解锁均拒绝', () => {
  const state = [[0], [], []];
  assert.equal(Powerups.unlockBottle(state, {
    stock: 0, lockedBottleIndexes: [1], unlocked: [], mode: 'item',
  }), null);
  assert.equal(Powerups.unlockBottle(state, {
    stock: 2, lockedBottleIndexes: [1], unlocked: [1], mode: 'item', target: 1,
  }), null);
  assert.equal(Powerups.unlockBottle(state, {
    stock: 2, lockedBottleIndexes: [1], unlocked: [], mode: 'ad', target: 0,
  }), null);
  assert.equal(Powerups.unlockBottle(state, {
    stock: 2, lockedBottleIndexes: [1, 2], unlocked: [1, 2], mode: 'ad',
  }), null);
  assert.equal(Powerups.unlockBottle(state, {
    stock: 2, unlocked: [], mode: 'item',
  }), null);
});
