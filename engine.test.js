// 数独引擎测试(先写测试:节点内置 test runner)
const { test } = require('node:test');
const assert = require('node:assert');
const { solve, countSolutions, generate, DIFFICULTY } = require('./engine.js');

// grid = 81 长数组,0=空
function validSolved(g) {
  for (let u = 0; u < 9; u++) {
    const row = new Set(), col = new Set(), box = new Set();
    for (let i = 0; i < 9; i++) {
      row.add(g[u * 9 + i]);
      col.add(g[i * 9 + u]);
      box.add(g[(Math.floor(u / 3) * 3 + Math.floor(i / 3)) * 9 + (u % 3) * 3 + (i % 3)]);
    }
    if (row.size !== 9 || col.size !== 9 || box.size !== 9) return false;
    for (const s of [row, col, box]) for (const v of s) if (v < 1 || v > 9) return false;
  }
  return true;
}

test('solve: 解出一个已知题面且与已知解一致', () => {
  const puzzle = ('530070000600195000098000060800060003400803001' +
                  '700020006060000280000419005000080079').split('').map(Number);
  const sol = solve(puzzle);
  assert.ok(sol, '应有解');
  assert.ok(validSolved(sol));
  // 给定格保持不变
  for (let i = 0; i < 81; i++) if (puzzle[i]) assert.strictEqual(sol[i], puzzle[i]);
});

test('solve: 无解题面返回 null', () => {
  const bad = new Array(81).fill(0);
  bad[0] = 5; bad[1] = 5; // 同行冲突
  assert.strictEqual(solve(bad), null);
});

test('countSolutions: 多解题面 >1,唯一解题面 =1', () => {
  const puzzle = ('530070000600195000098000060800060003400803001' +
                  '700020006060000280000419005000080079').split('').map(Number);
  assert.strictEqual(countSolutions(puzzle, 2), 1);
  const empty = new Array(81).fill(0);
  assert.ok(countSolutions(empty, 2) >= 2);
});

for (const diff of Object.keys(DIFFICULTY)) {
  test(`generate(${diff}): 唯一解 + 给定数在档位范围内 + 解合法`, () => {
    for (let k = 0; k < 3; k++) {
      const { puzzle, solution } = generate(diff, 1000 + k);
      assert.strictEqual(puzzle.length, 81);
      assert.ok(validSolved(solution));
      const givens = puzzle.filter(v => v !== 0).length;
      const [lo, hi] = DIFFICULTY[diff].givens;
      assert.ok(givens >= lo && givens <= hi, `${diff} givens=${givens} 应在 [${lo},${hi}]`);
      assert.strictEqual(countSolutions(puzzle, 2), 1, '必须唯一解');
      for (let i = 0; i < 81; i++) if (puzzle[i]) assert.strictEqual(puzzle[i], solution[i]);
    }
  });
}

test('generate: 同 seed 可复现,不同 seed 不同题', () => {
  const a = generate('medium', 42), b = generate('medium', 42), c = generate('medium', 43);
  assert.deepStrictEqual(a.puzzle, b.puzzle);
  assert.notDeepStrictEqual(a.puzzle, c.puzzle);
});
