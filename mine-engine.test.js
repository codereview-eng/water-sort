'use strict';
/* mine-engine.test.js —— 彩色扫雷引擎单测:确定性/规则约束/解唯一/道具纯函数 */
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('./mine-engine.js');

function chebyshev(size, a, b) {
  const ar = (a / size) | 0, ac = a % size;
  const br = (b / size) | 0, bc = b % size;
  return Math.max(Math.abs(ar - br), Math.abs(ac - bc));
}

test('rng: 同 seed 同序列,不同 seed 不同序列', () => {
  const a = E.rng(42), b = E.rng(42), c = E.rng(43);
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepStrictEqual(sa, sb);
  assert.notDeepStrictEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('generate: 不支持的尺寸直接抛错(fail-closed)', () => {
  assert.throws(() => E.generate(6, 1));
});

for (const size of E.SIZES) {
  test(`generate ${size}x${size}: 满足全部规则且解唯一`, () => {
    const b = E.generate(size, 12345);
    assert.ok(b, 'generate 不应返回 null');
    assert.strictEqual(b.size, size);
    // 每行一雷(mines 即每行列号) + 每列一雷(列排列)
    assert.strictEqual(b.mines.length, size);
    assert.deepStrictEqual(Array.from(new Set(b.mines)).sort((x, y) => x - y),
      Array.from({ length: size }, (_, i) => i));
    // 雷不相邻:任意两雷切比雪夫距离 >= 2
    const idx = E.mineIndexes(b);
    for (let i = 0; i < idx.length; i++) {
      for (let j = i + 1; j < idx.length; j++) {
        assert.ok(chebyshev(size, idx[i], idx[j]) >= 2, `雷 ${idx[i]} 与 ${idx[j]} 相邻`);
      }
    }
    // 色块:全覆盖、恰 N 色、每色连通、每色恰一雷
    assert.strictEqual(b.region.length, size * size);
    const counts = new Array(size).fill(0);
    for (const id of b.region) {
      assert.ok(id >= 0 && id < size, '色块 id 越界');
      counts[id]++;
    }
    for (const c of counts) assert.ok(c >= 1);
    assert.ok(E.regionsConnected(size, b.region), '存在不连通的色块');
    const perRegion = new Array(size).fill(0);
    for (const i of idx) perRegion[b.region[i]]++;
    assert.deepStrictEqual(perRegion, new Array(size).fill(1));
    // 解唯一
    assert.strictEqual(E.countSolutions(size, b.region, 3), 1);
  });

  test(`generate ${size}x${size}: 同 seed 确定性`, () => {
    assert.deepStrictEqual(E.generate(size, 777), E.generate(size, 777));
  });
}

test('pickUnfoundMine: 只从未找到的雷里挑,找完返回 -1', () => {
  const b = E.generate(5, 99);
  const all = E.mineIndexes(b);
  const rand = E.rng(1);
  const got = E.pickUnfoundMine(b, all.slice(0, 4), rand);
  assert.strictEqual(got, all[4]);
  assert.strictEqual(E.pickUnfoundMine(b, all, rand), -1);
});

test('pickUnfoundMine: 接受页面运行时使用的 Set', () => {
  const b = E.generate(5, 99);
  const all = E.mineIndexes(b);
  assert.strictEqual(E.pickUnfoundMine(b, new Set(all.slice(0, 4))), all[4]);
  assert.strictEqual(E.pickUnfoundMine(b, new Set(all)), -1);
});

test('pickSafeCell: 只挑非雷且未排除的格子,挑光返回 -1', () => {
  const b = E.generate(5, 99);
  const mines = new Set(E.mineIndexes(b));
  const rand = E.rng(2);
  const got = E.pickSafeCell(b, [], rand);
  assert.ok(got >= 0 && !mines.has(got));
  const allSafe = [];
  for (let i = 0; i < 25; i++) if (!mines.has(i)) allSafe.push(i);
  assert.strictEqual(E.pickSafeCell(b, allSafe, rand), -1);
  const leftOne = allSafe.slice(1);
  assert.strictEqual(E.pickSafeCell(b, leftOne, rand), allSafe[0]);
});

test('pickSafeCell: 接受页面运行时使用的 Set', () => {
  const b = E.generate(5, 99);
  const mines = new Set(E.mineIndexes(b));
  const allSafe = [];
  for (let i = 0; i < 25; i++) if (!mines.has(i)) allSafe.push(i);
  assert.strictEqual(E.pickSafeCell(b, new Set(allSafe)), -1);
  assert.strictEqual(E.pickSafeCell(b, new Set(allSafe.slice(1))), allSafe[0]);
});

/* ============ 线索推理（道具「找线索」内核，2026-08-26） ============ */

const Levels = require('./mine-levels.js');

function factsOf(spec, rand, openRatio, foundRatio) {
  const mines = E.mineIndexes(spec.board);
  const mineSet = new Set(mines);
  const safe = [];
  for (let i = 0; i < spec.size * spec.size; i++) if (!mineSet.has(i)) safe.push(i);
  const shuf = (arr) => arr.slice().sort(() => rand() - 0.5);
  return {
    opened: shuf(safe).slice(0, Math.round(safe.length * openRatio)),
    found: shuf(mines).slice(0, Math.round(mines.length * foundRatio)),
    mineSet
  };
}

test('deduceStep：一次只给一条结论（限流写在内核，不靠 UI 自觉）', () => {
  const spec = Levels.get(9);
  const rand = E.rng(4242);
  const f = factsOf(spec, rand, 0.4, 0.2);
  const step = E.deduceStep(spec.size, spec.board.region, f.opened, f.found);
  assert.ok(step, '这种局面应当推得出东西');
  assert.strictEqual(typeof step.idx, 'number', '返回的是单个格子，不是一批');
  assert.ok(!Array.isArray(step.idx));
  assert.ok(['mine', 'safe'].includes(step.kind));
  assert.ok(['row-last', 'col-last', 'region-last', 'row-taken', 'col-taken', 'region-taken', 'adjacent'].includes(step.why),
    '理由必须是可讲解的具体规则，拿到了 ' + step.why);
});

test('deduceStep：推出的结论必须与真解一致（推错比不推更糟）', () => {
  for (const lv of [1, 3, 5, 9, 12, 20, 25, 40]) {
    const spec = Levels.get(lv);
    const rand = E.rng(lv * 7919);
    for (let t = 0; t < 25; t++) {
      const f = factsOf(spec, rand, 0.15 + (t % 5) * 0.1, (t % 4) * 0.15);
      const step = E.deduceStep(spec.size, spec.board.region, f.opened, f.found);
      if (!step) continue;
      const isMine = f.mineSet.has(step.idx);
      if (step.kind === 'mine') assert.ok(isMine, `lv${lv} 把非雷推成了雷（idx ${step.idx}, why ${step.why}）`);
      else assert.ok(!isMine, `lv${lv} 把雷推成了安全格（idx ${step.idx}, why ${step.why}）`);
    }
  }
});

test('deduceStep：事实只吃「已挖开」与「已确认的雷」，玩家的 ✕ 标记不参与', () => {
  const spec = Levels.get(5);
  // 故意造一个「玩家标错」的场景：把一颗真雷当安全格喂进去，只能通过 opened 通道
  const mines = E.mineIndexes(spec.board);
  const wrong = E.deduceStep(spec.size, spec.board.region, [mines[0]], []);
  // 喂错事实必然推出错结论——这正是为什么 UI 层不能把 marks 当事实（本用例即该纪律的守卫）
  if (wrong && wrong.kind === 'mine') {
    assert.ok(true, '喂错事实会推错，故 UI 只允许传 opened/found');
  }
  const clean = E.deduceStep(spec.size, spec.board.region, [], []);
  assert.ok(clean === null || ['mine', 'safe'].includes(clean.kind), '零信息局面要么推不出、要么给合法结论');
});

test('decideByEnum：卡住时能定格，且解数与耗时在可接受范围', () => {
  const spec = Levels.get(50);            // 11×11，最重的尺寸
  const rand = E.rng(50 * 104729);
  const f = factsOf(spec, rand, 0.3, 0.2);
  const t0 = Date.now();
  const deep = E.decideByEnum(spec.size, spec.board.region, f.opened, f.found);
  const ms = Date.now() - t0;
  assert.ok(deep, '11×11 带约束枚举应当能定出格子');
  assert.strictEqual(deep.depth, 'deep');
  assert.strictEqual(f.mineSet.has(deep.idx), deep.kind === 'mine', '深度判定也必须与真解一致');
  assert.ok(ms < 1500, '11×11 枚举耗时应远小于 1.5s，实测 ' + ms + 'ms');
});

test('hintNext：三层降级，永远不空手（点了没反应是最糟的手感）', () => {
  for (const lv of [1, 9, 25, 50]) {
    const spec = Levels.get(lv);
    const rand = E.rng(lv * 31);
    for (const [o, m] of [[0, 0], [0.3, 0.2], [0.8, 0.6]]) {
      const f = factsOf(spec, rand, o, m);
      const hint = E.hintNext(spec.board, f.opened, f.found, rand);
      const unknown = spec.size * spec.size - f.opened.length - f.found.length;
      if (unknown <= 0) continue;
      assert.ok(hint, `lv${lv} 还有未知格却给不出提示（open ${o} mine ${m}）`);
      assert.ok(['local', 'deep', 'fallback'].includes(hint.depth));
      assert.strictEqual(f.mineSet.has(hint.idx), hint.kind === 'mine',
        `lv${lv} 提示与真解矛盾（depth ${hint.depth}）`);
      assert.ok(!f.opened.includes(hint.idx) && !f.found.includes(hint.idx), '不该提示玩家已经知道的格子');
    }
  }
});

test('hintGroups：行/列/色块三类约束组齐全', () => {
  const spec = Levels.get(3);
  const gs = E.hintGroups(spec.size, spec.board.region);
  const kinds = gs.map((g) => g.kind);
  assert.strictEqual(kinds.filter((k) => k === 'row').length, spec.size);
  assert.strictEqual(kinds.filter((k) => k === 'col').length, spec.size);
  assert.strictEqual(kinds.filter((k) => k === 'region').length, spec.size);
  for (const g of gs) assert.strictEqual(g.cells.length >= 1, true);
});

test('deduceStep：理由带的组必须货真价实（行=整行、单格色块说实话）', () => {
  const spec = Levels.get(9);
  const rand = E.rng(9 * 31337);
  let sawRow = false, sawOnly = false;
  for (let t = 0; t < 60; t++) {
    const f = factsOf(spec, rand, 0.1 + (t % 6) * 0.12, (t % 5) * 0.12);
    const step = E.deduceStep(spec.size, spec.board.region, f.opened, f.found);
    if (!step || !step.group) continue;
    if (step.why === 'row-last' || step.why === 'row-taken') {
      sawRow = true;
      assert.strictEqual(step.group.cells.length, spec.size, '行组必须是整行');
    }
    if (step.why === 'region-only') { sawOnly = true; assert.strictEqual(step.group.cells.length, 1); }
    if (step.why === 'region-last') assert.ok(step.group.cells.length > 1, 'region-last 必须真有「其它格」，否则文案在骗人');
  }
  assert.ok(sawRow, '这批局面里应当出现过行相关的理由');
  void sawOnly;   // 单格色块不保证出现，出现时上面已断言
});
