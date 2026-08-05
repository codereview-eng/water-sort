// 关卡层测试：固定关快照 + 生成关「可解性硬门」（与 levels.test.js 同风格）
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('./water-engine.js');
const L = require('./water-levels.js');

test('固定关：数量与形态（非空管根根装满，空管数符合设计）', () => {
  assert.strictEqual(L.FIXED_LEVELS.length, 5);
  const expectedLocks = [[4], [3], [5], [], []];
  for (let i = 1; i <= L.FIXED_LEVELS.length; i += 1) {
    const lv = L.forLevel(i);
    assert.strictEqual(lv.generated, false);
    E.assertInvariants(lv.layout, lv.capacity);
    const full = lv.layout.filter((t) => t.length);
    const blank = lv.layout.filter((t) => !t.length);
    assert.strictEqual(full.length, lv.colors.length, `L${i} 非空管数`);
    assert.strictEqual(blank.length, lv.empty, `L${i} 空管数`);
    for (const t of full) assert.strictEqual(t.length, lv.capacity, `L${i} 有半满管`);
    assert.deepStrictEqual(lv.lockedBottleIndexes, expectedLocks[i - 1], `L${i} 锁配置`);
    for (const index of lv.lockedBottleIndexes) {
      assert.strictEqual(lv.layout[index].length, 0, `L${i} 只能锁空瓶`);
    }
  }
});

test('固定关：锁配置返回独立副本，旧关卡缺省时不自动锁空瓶', () => {
  const lv = L.forLevel(1);
  lv.lockedBottleIndexes.push(3);
  assert.deepStrictEqual(L.forLevel(1).lockedBottleIndexes, [4]);
  assert.deepStrictEqual(L.normalizeLockedBottleIndexes([], [['mint'], []]), []);
  assert.deepStrictEqual(L.normalizeLockedBottleIndexes(undefined, [['mint'], []]), []);
  assert.deepStrictEqual(
    L.normalizeLockedBottleIndexes([1, 0, 1, -1, 2, 1.5], [['mint'], [], []]),
    [1, 2],
  );
});

test('固定关：可解，且 minMoves 快照与 BFS 标定一致（改盘面必须重跑标定）', () => {
  const expect = [5, 8, 10, 14, 15];
  for (let i = 1; i <= L.FIXED_LEVELS.length; i += 1) {
    const lv = L.forLevel(i);
    const r = E.solve(lv.layout, { capacity: lv.capacity });
    assert.strictEqual(r.solvable, true, `L${i} 不可解`);
    assert.strictEqual(r.minMoves, lv.minMoves, `L${i} 标定漂移`);
    assert.strictEqual(lv.minMoves, expect[i - 1], `L${i} 快照变了`);
    for (const lockedIndex of lv.lockedBottleIndexes) {
      const playable = lv.layout.filter((_, tubeIndex) => tubeIndex !== lockedIndex);
      const withoutLockedBottle = E.solve(playable, { capacity: lv.capacity });
      assert.strictEqual(withoutLockedBottle.solvable, true, `L${i} 锁瓶后不可解`);
      assert.strictEqual(withoutLockedBottle.minMoves, lv.minMoves, `L${i} 锁瓶改变最少步数`);
    }
  }
});

test('固定关：难度单调递增（教学爬坡不能倒挂）', () => {
  const mm = L.FIXED_LEVELS.map((l) => l.minMoves);
  for (let i = 1; i < mm.length; i += 1) assert.ok(mm[i] > mm[i - 1], `L${i + 1} 比上一关简单`);
});

test('生成关硬门：6-16 关必须可解、形态整齐、颜色守恒', () => {
  for (let i = 6; i <= 16; i += 1) {
    const lv = L.forLevel(i, E.solve);
    E.assertInvariants(lv.layout, lv.capacity);
    const full = lv.layout.filter((t) => t.length);
    assert.strictEqual(full.length, lv.colors.length, `L${i} 非空管数`);
    for (const t of full) assert.strictEqual(t.length, lv.capacity, `L${i} 有半满管`);
    const r = E.solve(lv.layout, { capacity: lv.capacity, maxVisited: 150000 });
    assert.strictEqual(r.solvable, true, `L${i} 生成了不可解的关`);
    assert.ok(lv.lockedBottleIndexes.length <= 1, `L${i} 最多配置一根锁瓶`);
    for (const index of lv.lockedBottleIndexes) {
      assert.strictEqual(lv.layout[index].length, 0, `L${i} 只能锁空瓶`);
      const playable = lv.layout.filter((_, tubeIndex) => tubeIndex !== index);
      assert.strictEqual(
        E.solve(playable, { capacity: lv.capacity, maxVisited: 150000 }).solvable,
        true,
        `L${i} 锁瓶后必须仍可解`,
      );
    }
  }
});

test('生成关确定性：同一关号两次生成完全相同（全网同题）', () => {
  for (const n of [7, 12, 18]) {
    const a = L.forLevel(n, E.solve);
    const b = L.forLevel(n, E.solve);
    assert.deepStrictEqual(a.layout, b.layout, `L${n} 生成不确定`);
  }
});

test('难度曲线：颜色数随关卡递增并在 8 色封顶，空管恒为 2', () => {
  assert.strictEqual(L.levelSpec(1).colors, 3);
  assert.strictEqual(L.levelSpec(10).colors, 6);
  assert.strictEqual(L.levelSpec(50).colors, 8);
  for (const n of [1, 10, 23, 50]) assert.strictEqual(L.levelSpec(n).empty, 2);
});

test('生成器降级可观测：正常关 degraded 为 null（不是静默兜底）', () => {
  const lv = L.forLevel(9, E.solve);
  assert.strictEqual(lv.degraded, null);
  assert.strictEqual(lv.generated, true);
});

test('洗牌构造：洗出已解态判废（返回 null 而不是发一关白给的）', () => {
  // 单色单管必然洗成已解态
  assert.strictEqual(L.buildLayout(1, 1, 12345, 4), null);
});
