/* 广告位泛化 core 单元测试：声明式 placement + 独立频控 + fail-fast
   （issue #1 · S29/S30 的机制面；场景级断言见 fixtures/S29–S30） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const PL = require('./placements.js');

const DAY = 86400000;

test('默认配置 = 无此系统（空表，任何引用即拒）', () => {
  const pl = PL.create(null, () => true);
  assert.deepEqual(pl.ids(), []);
  assert.throws(() => pl.show('any', {}, 0), /引用不存在 placement/);
});

test('通用播放链：interstitial 不发奖；rewarded 按 provider 结果 + onFail 决定', () => {
  const results = { ok: () => true, bad: () => false };
  let mode = 'ok';
  const pl = PL.create({
    pre: { format: 'interstitial' },
    claim: { format: 'rewarded', onFail: 'grant' },
    unlock: { format: 'rewarded', onFail: 'deny' },
    revive: { format: 'rewarded', onFail: 'retry' }
  }, () => results[mode]());
  assert.deepEqual(pl.show('pre', {}, 0).granted, false, '插屏永不发奖');
  assert.equal(pl.show('claim', {}, 0).granted, true);
  mode = 'bad';
  assert.equal(pl.show('claim', {}, 0).granted, true, 'onFail:grant 失败兜底发放');
  assert.equal(pl.show('unlock', {}, 0).granted, false, 'onFail:deny 失败不发');
  const r = pl.show('revive', {}, 0);
  assert.equal(r.granted, false);
  assert.equal(r.retry, true, 'onFail:retry 提示重试');
});

test('S30 频控四维独立：间隔/会话/天/起始关，canShow 供 UI 显隐', () => {
  const pl = PL.create({
    a: { format: 'interstitial', capping: { minIntervalSec: 60, maxPerSession: 2, maxPerDay: 3, startAfterLevel: 5 } }
  }, () => true);
  assert.equal(pl.canShow('a', { level: 4 }, 0), false, '起始关未到');
  let st = { level: 5 };
  const r1 = pl.show('a', st, 0);
  assert.equal(r1.shown, true);
  assert.equal(pl.canShow('a', r1.state, 30000), false, '间隔不够');
  const r2 = pl.show('a', r1.state, 61000);
  assert.equal(r2.shown, true);
  assert.equal(pl.canShow('a', r2.state, 200000), false, '会话上限（2）');
  const newSession = { ...r2.state, sessionN: 0 };
  const r3 = pl.show('a', newSession, 200000);
  assert.equal(r3.shown, true);
  assert.equal(pl.canShow('a', { ...r3.state, sessionN: 0 }, 300000), false, '同日 3 次到顶');
  assert.equal(pl.canShow('a', { ...r3.state, sessionN: 0 }, DAY + 300000), true, '跨 UTC 日恢复');
});

test('计数状态由调用方持久化，跨日 dayN 归零重计', () => {
  const pl = PL.create({ a: { format: 'interstitial', capping: { maxPerDay: 1 } } }, () => true);
  const r1 = pl.show('a', {}, 0);
  assert.equal(r1.state.dayN, 1);
  const r2 = pl.show('a', r1.state, DAY + 1);
  assert.equal(r2.shown, true);
  assert.equal(r2.state.dayN, 1, '新的一天重新从 1 计');
});

test('fail-fast：未知 format/rewarded 缺 onFail/插屏带 onFail/负值/矛盾 cap/未知键/无 provider', () => {
  assert.throws(() => PL.create({ a: { format: 'banner' } }, () => true), /未知 format/);
  assert.throws(() => PL.create({ a: { format: 'rewarded' } }, () => true), /缺 onFail/);
  assert.throws(() => PL.create({ a: { format: 'interstitial', onFail: 'grant' } }, () => true), /不接受 onFail/);
  assert.throws(() => PL.create({ a: { format: 'interstitial', capping: { minIntervalSec: -1 } } }, () => true), /必须是 >=0/);
  assert.throws(() => PL.create({ a: { format: 'interstitial', capping: { maxPerSession: 5, maxPerDay: 2 } } }, () => true), /矛盾/);
  assert.throws(() => PL.create({ a: { format: 'interstitial', priority: 1 } }, () => true), /未知键/);
  assert.throws(() => PL.create({}, null), /需要 provider/);
});
