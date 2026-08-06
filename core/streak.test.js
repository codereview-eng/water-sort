/* 连胜系统 core 单元测试：状态机三事件入口 + 宽恕顺序 + fail-fast
   （issue #1 · S21/S22/S24 的机制面；场景级断言见 fixtures/S21–S24） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const K = require('./streak.js');

const DAY = 86400000;

test('默认配置 = 无此系统（入口不渲染、API 调用即拒）', () => {
  for (const s of [K.create(null), K.create({ enabled: false })]) {
    assert.equal(s.visible(), false);
    assert.throws(() => s.win({}), /未开启/);
    assert.deepEqual(s.tiers(), []);
  }
});

test('win：数到 N 发里程碑描述符，best 跟随，claim 方式随 config', () => {
  const s = K.create({ enabled: true, claimMode: 'ad', tiers: [{ streak: 2, reward: { type: 'coins', amount: 100 } }, { streak: 3, reward: { type: 'item', id: 'undo' } }] });
  let st = s.init();
  assert.deepEqual(s.win(st).rewards, [], '第 1 胜无里程碑');
  st = s.win(st).state;
  const r2 = s.win(st);
  assert.deepEqual(r2.rewards, [{ streak: 2, reward: { type: 'coins', amount: 100 }, claim: 'ad' }]);
  const r3 = s.win(r2.state);
  assert.equal(r3.rewards[0].reward.id, 'undo', 'core 只透传描述符，不认识奖励内容');
  assert.equal(r3.state.best, 3);
});

test('lose 宽恕顺序 core 定死：①每日首败豁免 ②广告续命 ③清零', () => {
  const s = K.create({
    enabled: true, claimMode: 'direct',
    policy: { dailyFirstLossForgiven: true, adRevive: { enabled: true, maxPerStreak: 1 } },
    tiers: []
  });
  let st = s.win(s.init()).state;
  const l1 = s.lose(st, 1000);
  assert.equal(l1.outcome, 'forgiven', '同日首败豁免优先');
  const l2 = s.lose(l1.state, 2000);
  assert.equal(l2.outcome, 'revivable', '同日第二败进入续命');
  const frozen = s.freeze(l2.state);
  assert.equal(frozen.current, 1, '续命保连胜');
  const l3 = s.lose(frozen, 3000);
  assert.equal(l3.outcome, 'reset', '续命次数用尽即清零');
  assert.equal(l3.state.current, 0);
  const l4 = s.lose({ ...l3.state, current: 5 }, DAY + 1);
  assert.equal(l4.outcome, 'forgiven', '新的一天豁免额度恢复');
});

test('lose/freeze/confirmLoss 状态约束：未决失败必须先处理', () => {
  const s = K.create({ enabled: true, claimMode: 'direct', policy: { adRevive: { enabled: true, maxPerStreak: 2 } }, tiers: [] });
  let st = s.win(s.init()).state;
  const l = s.lose(st, 0);
  assert.equal(l.outcome, 'revivable');
  assert.throws(() => s.win(l.state), /未决的失败/);
  assert.throws(() => s.freeze(st), /无待续命/);
  const dropped = s.confirmLoss(l.state);
  assert.equal(dropped.current, 0, '放弃续命按清零策略落地');
  assert.throws(() => s.confirmLoss(dropped), /无待确认/);
  assert.throws(() => s.lose(st, -1), /now 时间戳/);
});

test('resetOnLoss:false 纯配置——失败保留连胜（kept）', () => {
  const s = K.create({ enabled: true, claimMode: 'direct', policy: { resetOnLoss: false }, tiers: [] });
  const st = s.win(s.init()).state;
  const l = s.lose(st, 0);
  assert.equal(l.outcome, 'kept');
  assert.equal(l.state.current, 1);
});

test('fail-fast：未知键/未知 claimMode/tiers 非递增/非法 reward/非法 adRevive 一律加载期抛错', () => {
  assert.throws(() => K.create({ enabled: true, claimMode: 'ad', theme: 'x' }), /未知键/);
  assert.throws(() => K.create({ enabled: 'yes' }), /boolean/);
  assert.throws(() => K.create({ enabled: true, claimMode: 'auto' }), /未知 claimMode/);
  assert.throws(() => K.create({ enabled: true, claimMode: 'ad', tiers: [{ streak: 5, reward: { type: 'coins', amount: 1 } }, { streak: 5, reward: { type: 'coins', amount: 2 } }] }), /严格递增/);
  assert.throws(() => K.create({ enabled: true, claimMode: 'ad', tiers: [{ streak: 3, reward: { type: 'nft' } }] }), /未知 reward\.type/);
  assert.throws(() => K.create({ enabled: true, claimMode: 'ad', tiers: [{ streak: 3, reward: { type: 'coins', amount: 0 } }] }), /必须是 >0 整数/);
  assert.throws(() => K.create({ enabled: true, claimMode: 'ad', tiers: [{ streak: 3, reward: { type: 'item' } }] }), /按 id 引用/);
  assert.throws(() => K.create({ enabled: true, claimMode: 'ad', tiers: [{ streak: 3, reward: { type: 'coins', amount: 1 }, note: 'x' }] }), /未知键/);
  assert.throws(() => K.create({ enabled: true, claimMode: 'ad', policy: { adRevive: { enabled: true, maxPerStreak: 0 } } }), /必须是 >0 整数/);
  assert.throws(() => K.create({ enabled: true, claimMode: 'ad', policy: { vip: true } }), /未知键/);
});
