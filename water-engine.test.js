// 倒水引擎测试（先写测试：节点内置 test runner，与 engine.test.js 同风格）
const { test } = require('node:test');
const assert = require('node:assert');
const {
  CAPACITY, canMove, canonical, isSolved, legalMoves, pour, pourAmount, topRun,
  assertInvariants, solve, hint,
} = require('./water-engine.js');
const L = require('./water-levels.js');
const initialState = (n) => L.forLevel(n).layout;   // 关卡层的快照/可解性断言在 water-levels.test.js

test('topRun: 顶部同色连续段长度', () => {
  assert.strictEqual(topRun([]), 0);
  assert.strictEqual(topRun(['r']), 1);
  assert.strictEqual(topRun(['g', 'r', 'r', 'r']), 3);
  assert.strictEqual(topRun(['r', 'r', 'g']), 1);
});

test('canMove: i==j / 源空 / 目标满 / 顶色不同 全部非法', () => {
  const s = [['r', 'r'], ['g'], [], ['b', 'b', 'b', 'b']];
  assert.strictEqual(canMove(s, 0, 0), false, 'i==j');
  assert.strictEqual(canMove(s, 2, 0), false, '源空');
  assert.strictEqual(canMove(s, 0, 3), false, '目标满');
  assert.strictEqual(canMove(s, 0, 1), false, '顶色不同');
});

test('canMove: 顶色相同 / 倒入空管 合法', () => {
  assert.strictEqual(canMove([['r', 'g'], ['g']], 0, 1), true);
  assert.strictEqual(canMove([['r', 'g'], []], 0, 1), true);
});

test('canMove: 单色管→空管 判非法（无意义平移，也砍掉求解器无效分支）', () => {
  assert.strictEqual(canMove([['r', 'r'], []], 0, 1), false);
  assert.strictEqual(canMove([['r', 'r', 'r', 'r'], []], 0, 1), false);
});

test('pourAmount / pour: 整段倒入, 空位不足的移动直接非法', () => {
  const s = [['g', 'r', 'r'], ['r'], []];
  assert.strictEqual(pourAmount(s, 0, 1), 2); // 顶段整段长度
  const r = pour(s, 0, 1);
  assert.strictEqual(r.amount, 2);
  assert.strictEqual(r.color, 'r');
  assert.deepStrictEqual(r.state[0], ['g']);
  assert.deepStrictEqual(r.state[1], ['r', 'r', 'r']);
  // 空位(1) < 源顶同色段(2): canMove 拦下, pour 返回 null
  assert.strictEqual(pour([['g', 'r', 'r'], ['r', 'r', 'r'], []], 0, 1), null);
});

test('pour: 纯函数不改入参；非法移动返回 null', () => {
  const s = [['g', 'r'], []];
  const snapshot = JSON.stringify(s);
  pour(s, 0, 1);
  assert.strictEqual(JSON.stringify(s), snapshot);
  assert.strictEqual(pour([['r'], ['g']], 0, 1), null);
});

test('isSolved: 全满单色/含空管为胜；差一层不算', () => {
  assert.strictEqual(isSolved([['r', 'r', 'r', 'r'], []]), true);
  assert.strictEqual(isSolved([['r', 'r', 'r'], ['r']]), false);
  assert.strictEqual(isSolved([['r', 'r', 'r', 'g'], ['r']]), false);
});

test('canonical: 管序无关（求解器去重的地基）', () => {
  assert.strictEqual(canonical([['r', 'g'], []]), canonical([[], ['r', 'g']]));
  assert.notStrictEqual(canonical([['r', 'g'], []]), canonical([['g', 'r'], []]));
});

test('颜色守恒：随机走 3000 步，每步每色恰好 CAPACITY 层', () => {
  let s = initialState(1);
  for (let n = 0; n < 3000; n += 1) {
    const moves = legalMoves(s);
    if (!moves.length) break;
    const mv = moves[Math.floor(Math.random() * moves.length)];
    s = pour(s, mv[0], mv[1]).state;
    assertInvariants(s);
  }
});

test('第一关：沿最优解回放必胜，步数等于标定的最短解', () => {
  const lv = L.forLevel(1);
  const r = solve(lv.layout, { capacity: lv.capacity });
  assert.strictEqual(r.minMoves, lv.minMoves);
  let s = initialState(1);
  for (const mv of r.moves) {
    const step = pour(s, mv[0], mv[1], lv.capacity);
    assert.ok(step, `回放出现非法移动 ${mv}`);
    s = step.state;
  }
  assert.strictEqual(isSolved(s, lv.capacity), true);
});

test('hint: 第一关首步提示合法且不为空', () => {
  const mv = hint(initialState(1));
  assert.ok(Array.isArray(mv));
  assert.strictEqual(canMove(initialState(1), mv[0], mv[1]), true);
});

test('死局：4 色满管零空管，无合法移动且被判不可解', () => {
  const stuck = [
    ['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a'], ['c', 'd', 'a', 'b'], ['d', 'a', 'b', 'c'],
  ];
  assert.strictEqual(legalMoves(stuck).length, 0);
  assert.strictEqual(solve(stuck).solvable, false);
  assert.strictEqual(CAPACITY, 4);
});

test('pour: 整段倒入——源顶连续同色段一次全部倒入', () => {
  const s = [['g', 'r', 'r'], ['r'], []];
  const r1 = pour(s, 0, 1, 4);
  assert.strictEqual(r1.amount, 2);
  assert.deepStrictEqual(r1.state[0], ['g']);
  assert.deepStrictEqual(r1.state[1], ['r', 'r', 'r']);
  assert.deepStrictEqual(s, [['g', 'r', 'r'], ['r'], []]); // 纯函数不改入参
});

test('pour: 目标空位不足整段时禁倒(canMove=false 且 pour=null); 恰好等于整段可倒', () => {
  const lack = [['g', 'r', 'r'], ['r', 'r', 'r'], []]; // 空位1 < 顶段2
  assert.strictEqual(canMove(lack, 0, 1, 4), false);
  assert.strictEqual(pour(lack, 0, 1, 4), null);
  const fit = [['g', 'r', 'r'], ['r', 'r'], []]; // 空位2 === 顶段2
  const r = pour(fit, 0, 1, 4);
  assert.strictEqual(r.amount, 2);
  assert.deepStrictEqual(r.state[1], ['r', 'r', 'r', 'r']);
});
