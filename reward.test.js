// 激励循环测试:体力恢复 / 关卡难度映射 / seed 确定性
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restore, levelDiff, levelSeed, E_MAX, E_COST, E_AD } = require('./reward.js');

test('体力: 常量契约 120/-15/+60', () => {
  assert.equal(E_MAX, 120); assert.equal(E_COST, 15); assert.equal(E_AD, 60);
});

test('体力: 离线10分钟 +10', () => {
  assert.equal(restore(50, 1_000_000, 1_000_000 + 600_000).energy, 60);
});

test('体力: 离线一天封顶 120', () => {
  assert.equal(restore(50, 0, 86_400_000).energy, 120);
});

test('体力: 余秒保留 — 90s 加1剩30s, 再30s 凑满第二分钟', () => {
  const t0 = 1_000_000;
  const r1 = restore(50, t0, t0 + 90_000);
  assert.equal(r1.energy, 51);
  assert.equal(r1.lastTs, t0 + 60_000);
  assert.equal(restore(r1.energy, r1.lastTs, t0 + 120_000).energy, 52);
});

test('体力: 高频结算不吞秒 — 59×59s ≈ 58 点', () => {
  let s = { energy: 0, lastTs: 0 };
  for (let i = 1; i <= 59; i++) s = restore(s.energy, s.lastTs, i * 59_000);
  assert.equal(s.energy, 58);
});

test('体力: 时钟回拨安全', () => {
  const r = restore(50, 2_000_000, 1_000_000);
  assert.equal(r.energy, 50); assert.equal(r.lastTs, 1_000_000);
});

test('体力: 超额保留 — 175 经 10 分钟仍 175,不砍回 120', () => {
  const r = restore(175, 1_000_000, 1_000_000 + 600_000);
  assert.equal(r.energy, 175);
  assert.equal(r.lastTs, 1_600_000);
});

test('体力: >=120 自然恢复不生效 — 120 放一天还是 120', () => {
  assert.equal(restore(120, 0, 86_400_000).energy, 120);
});

test('体力: <120 每分钟 +1 且恢复封顶到 120 为止', () => {
  assert.equal(restore(119, 0, 60_000).energy, 120);
  assert.equal(restore(60, 0, 86_400_000).energy, 120);
});

test('体力: 满体力不白嫖历史时长', () => {
  const r = restore(120, 0, 3_600_000);
  assert.equal(r.lastTs, 3_600_000);
  assert.equal(restore(119, r.lastTs, 3_601_000).energy, 119);
});

test('关卡难度映射: 1-20 新手 / 21-60 简单 / 61-150 中等 / 151+ 困难', () => {
  assert.equal(levelDiff(1), 'beginner');
  assert.equal(levelDiff(20), 'beginner');
  assert.equal(levelDiff(21), 'easy');
  assert.equal(levelDiff(60), 'easy');
  assert.equal(levelDiff(61), 'medium');
  assert.equal(levelDiff(150), 'medium');
  assert.equal(levelDiff(151), 'hard');
  assert.equal(levelDiff(9999), 'hard');
});

test('关卡 seed: 确定性 + 相邻关不同 + 非负', () => {
  for (const l of [1, 2, 100, 101, 5000]) {
    assert.equal(levelSeed(l), levelSeed(l));
    assert.ok(levelSeed(l) >= 0);
  }
  assert.notEqual(levelSeed(100), levelSeed(101));
});

test('关卡与引擎集成: 同关同题且唯一解', () => {
  const engine = require('./engine.js');
  const l = 42;
  const a = engine.generate(levelDiff(l), levelSeed(l));
  const b = engine.generate(levelDiff(l), levelSeed(l));
  assert.deepEqual(a.puzzle, b.puzzle);
  assert.equal(engine.countSolutions(a.puzzle, 2), 1);
});
