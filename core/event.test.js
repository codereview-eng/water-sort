/* 每周活动 core 单元测试：口径/周期/梯度 + fail-fast
   （issue #1 · S7/S8 机制面；场景级断言见 fixtures/S7–S8） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('./event.js');

test('默认配置 = 不开活动：入口不渲染、活动 API 调用即拒（附加式）', () => {
  const e = E.create(null);
  assert.equal(e.active, false);
  assert.equal(e.visible(), false);
  assert.throws(() => e.score({}), /未开活动/);
  assert.throws(() => e.settleRewards({}), /未开活动/);
});

test('积分口径与周期：clears/stars × weekly/biweekly', () => {
  const a = E.create({ enabled: true, metric: 'clears' });
  const b = E.create({ enabled: true, metric: 'stars', period: 'biweekly' });
  assert.equal(a.score({ cleared: true, stars: 3 }), 1);
  assert.equal(a.score({ cleared: false, stars: 3 }), 0);
  assert.equal(b.score({ cleared: true, stars: 3 }), 3);
  const t = 14 * 86400000;
  assert.equal(a.periodIndex(t), 2, '单周期第 2 周');
  assert.equal(b.periodIndex(t), 1, '双周期第 1 期');
});

test('奖励梯度：milestone 取最高达标档；top10 按名次、超出梯度为 0', () => {
  const m = E.create({ enabled: true, rewards: { kind: 'milestone', tiers: [{ at: 10, coins: 5 }, { at: 50, coins: 30 }] } });
  assert.equal(m.settleRewards({ points: 9 }), 0);
  assert.equal(m.settleRewards({ points: 10 }), 5);
  assert.equal(m.settleRewards({ points: 55 }), 30);
  const t = E.create({ enabled: true, rewards: { kind: 'top10', tiers: [{ coins: 100 }, { coins: 50 }] } });
  assert.equal(t.settleRewards({ rank: 1 }), 100);
  assert.equal(t.settleRewards({ rank: 2 }), 50);
  assert.equal(t.settleRewards({ rank: 3 }), 0);
});

test('fail-fast：未知键/metric/period/kind、非法 tiers、非递增 milestone 全部加载期抛错', () => {
  assert.throws(() => E.create({ enabled: true, metric: 'time' }), /未知 metric/);
  assert.throws(() => E.create({ enabled: true, period: 'daily' }), /未知 period/);
  assert.throws(() => E.create({ enabled: true, rewards: { kind: 'raffle', tiers: [{ coins: 1 }] } }), /未知 rewards\.kind/);
  assert.throws(() => E.create({ enabled: true, rewards: { kind: 'milestone', tiers: [] } }), /非空数组/);
  assert.throws(() => E.create({ enabled: true, rewards: { kind: 'milestone', tiers: [{ at: 5, coins: -1 }] } }), /coins/);
  assert.throws(() => E.create({ enabled: true, rewards: { kind: 'milestone', tiers: [{ at: 5, coins: 1 }, { at: 5, coins: 2 }] } }), /严格递增/);
  assert.throws(() => E.create({ theme: 'halloween' }), /未知键/);
  assert.throws(() => E.create({ enabled: 'yes' }), /boolean/);
});
