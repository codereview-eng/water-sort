// 关卡层测试：固定关快照 + 生成关「可解性硬门」（与 levels.test.js 同风格）
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('./water-engine.js');
const L = require('./water-levels.js');

test('固定关：数量与形态（非空管根根装满，空管数符合设计）', () => {
  // 5 关教学爬坡 + 25 关主题关（basic/tight/crowd/master，pick-theme-levels.mjs 产出）
  assert.strictEqual(L.FIXED_LEVELS.length, 30);
  // 辅助位地板：每关至少 2 根锁定空瓶（不足的由 withAssistBottles 在盘面末尾追加），
  // 让非最优解玩家能靠「看广告解锁空瓶」降难通关，而不是必须打出最优解。
  const expectedLocks = [[4, 5], [3, 5], [5, 6], [6, 7], [7, 8]];
  for (let i = 1; i <= L.FIXED_LEVELS.length; i += 1) {
    const lv = L.forLevel(i);
    assert.strictEqual(lv.generated, false);
    E.assertInvariants(lv.layout, lv.capacity);
    const full = lv.layout.filter((t) => t.length);
    const blank = lv.layout.filter((t) => !t.length);
    assert.strictEqual(full.length, lv.colors.length, `L${i} 非空管数`);
    assert.strictEqual(blank.length, lv.empty, `L${i} 空管数`);
    for (const t of full) assert.strictEqual(t.length, lv.capacity, `L${i} 有半满管`);
    if (i <= expectedLocks.length) {
      assert.deepStrictEqual(lv.lockedBottleIndexes, expectedLocks[i - 1], `L${i} 锁配置`);
    } else {
      // L6-30 主题关：锁瓶是挑关脚本的构造约束——只锁盘面末尾的空管，
      // 1-3 根随章节爬坡（对应「看广告解锁空瓶」的可选辅助位）。
      const n = lv.lockedBottleIndexes.length;
      assert.ok(n >= L.ASSIST_LOCKED_MIN && n <= 3, `L${i} 锁瓶数出设计带（辅助位地板=2）`);
      const tail = Array.from({ length: n }, (_, k) => lv.layout.length - n + k);
      assert.deepStrictEqual(lv.lockedBottleIndexes, tail, `L${i} 锁必须落在盘面末尾`);
    }
    for (const index of lv.lockedBottleIndexes) {
      assert.strictEqual(lv.layout[index].length, 0, `L${i} 只能锁空瓶`);
    }
  }
});

test('固定关：锁配置返回独立副本，旧关卡缺省时不自动锁空瓶', () => {
  const lv = L.forLevel(1);
  lv.lockedBottleIndexes.push(3);
  assert.deepStrictEqual(L.forLevel(1).lockedBottleIndexes, [4, 5]);
  assert.deepStrictEqual(L.normalizeLockedBottleIndexes([], [['mint'], []]), []);
  assert.deepStrictEqual(L.normalizeLockedBottleIndexes(undefined, [['mint'], []]), []);
  assert.deepStrictEqual(
    L.normalizeLockedBottleIndexes([1, 0, 1, -1, 2, 1.5], [['mint'], [], []]),
    [1, 2],
  );
});

test('固定关：可解，且 minMoves 快照与 BFS 标定一致（改盘面必须重跑标定）', () => {
  // 只覆盖 L1-5 教学关：开盘全量 BFS 便宜。L6-30 主题关的开盘标定在挑关脚本里
  // 已做过（6 色开盘单解秒级，25 关全量重解会把测试拖到分钟级），由下面的
  // 锁态硬门测试兜底：锁态可解 ⇒ 开盘必可解（开盘只是多几根空管）。
  const expect = [5, 8, 10, 14, 15];
  for (let i = 1; i <= expect.length; i += 1) {
    const lv = L.forLevel(i);
    // 标定口径 = 不开瓶盘面（排除全部锁定辅助位），与游戏内 par 同口径
    const playable = lv.layout.filter((_, tubeIndex) => !lv.lockedBottleIndexes.includes(tubeIndex));
    const r = E.solve(playable, { capacity: lv.capacity });
    assert.strictEqual(r.solvable, true, `L${i} 不开瓶不可解——广告开瓶成了通关必需`);
    assert.strictEqual(r.minMoves, lv.minMoves, `L${i} 标定漂移`);
    assert.strictEqual(lv.minMoves, expect[i - 1], `L${i} 快照变了`);
    // 开瓶（解锁全部辅助位）只会更容易：仍可解，且最少步数不变多
    const open = E.solve(lv.layout, { capacity: lv.capacity });
    assert.strictEqual(open.solvable, true, `L${i} 开瓶后反而不可解`);
    assert.ok(open.minMoves <= lv.minMoves, `L${i} 开瓶反而更难`);
  }
});

test('主题关硬门（L6-30）：不开瓶也必须可解，且与离线标定一致', () => {
  for (let i = 6; i <= L.FIXED_LEVELS.length; i += 1) {
    const spec = L.FIXED_LEVELS[i - 1]; // minMovesLocked 不经 forLevel 透传，从源规格取
    const lv = L.forLevel(i);
    const playable = lv.layout.filter((_, tubeIndex) => !lv.lockedBottleIndexes.includes(tubeIndex));
    const r = E.solve(playable, { capacity: lv.capacity, maxVisited: 900000 });
    assert.strictEqual(r.solvable, true, `L${i} 不开瓶不可解——广告开瓶成了通关必需`);
    assert.strictEqual(r.minMoves, spec.minMovesLocked, `L${i} 锁态标定漂移（改盘面必须重跑标定）`);
    assert.ok(spec.minMoves <= spec.minMovesLocked, `L${i} 开瓶反而更难`);
  }
});

test('固定关：难度曲线（教学爬坡不倒挂，主题章节均值递增）', () => {
  const mm = L.FIXED_LEVELS.map((l) => l.minMoves);
  for (let i = 1; i < 5; i += 1) assert.ok(mm[i] > mm[i - 1], `L${i + 1} 比上一关简单`);
  // L6-30 是离线挑的盘面，单关允许小幅回落；爬坡以章节为单位锁死：
  // 每章平均 minMoves 必须严格高于上一章（实测 15.2 → 18.2 → 19.0 → 19.25）。
  const themes = ['basic', 'tight', 'crowd', 'master'];
  const avg = themes.map((theme) => {
    const ms = L.FIXED_LEVELS.filter((l) => l.theme === theme).map((l) => l.minMoves);
    assert.ok(ms.length >= 4, `${theme} 章节关数不足`);
    return ms.reduce((a, b) => a + b, 0) / ms.length;
  });
  for (let i = 1; i < avg.length; i += 1) {
    assert.ok(avg[i] > avg[i - 1], `${themes[i]} 章节均值未超过 ${themes[i - 1]}`);
  }
});

test('生成关硬门：31-41 关必须可解、形态整齐、颜色守恒', () => {
  for (let i = 31; i <= 41; i += 1) {
    const lv = L.forLevel(i, E.solve);
    E.assertInvariants(lv.layout, lv.capacity);
    const full = lv.layout.filter((t) => t.length);
    assert.strictEqual(full.length, lv.colors.length, `L${i} 非空管数`);
    for (const t of full) assert.strictEqual(t.length, lv.capacity, `L${i} 有半满管`);
    // 开盘可解不再单独全量 BFS：辅助位地板追加 2 根空管后，开盘（8 色 + 4 空管）
    // 分支爆炸会让 150k visited 假阴性；由下面的「不开瓶可解」硬门蕴含
    // （开盘只是多几根空管，解集只增不减）。
    assert.strictEqual(
      lv.lockedBottleIndexes.length, L.ASSIST_LOCKED_MIN,
      `L${i} 辅助位地板漂移（生成关=盘面内锁瓶≤1 + 追加补足到 2）`,
    );
    for (const index of lv.lockedBottleIndexes) {
      assert.strictEqual(lv.layout[index].length, 0, `L${i} 只能锁空瓶`);
    }
    const playable = lv.layout.filter((_, tubeIndex) => !lv.lockedBottleIndexes.includes(tubeIndex));
    assert.strictEqual(
      E.solve(playable, { capacity: lv.capacity, maxVisited: 150000 }).solvable,
      true,
      `L${i} 不开瓶必须仍可解——广告开瓶成了通关必需`,
    );
  }
});

test('生成关确定性：同一关号两次生成完全相同（全网同题）', () => {
  for (const n of [31, 36, 45]) {
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
  const lv = L.forLevel(31, E.solve); // 生成关从 L31 起（L6-30 已固定化）
  assert.strictEqual(lv.degraded, null);
  assert.strictEqual(lv.generated, true);
});

test('洗牌构造：洗出已解态判废（返回 null 而不是发一关白给的）', () => {
  // 单色单管必然洗成已解态
  assert.strictEqual(L.buildLayout(1, 1, 12345, 4), null);
});
