// 数独引擎:求解 / 解数统计 / 出题(唯一解保证 + 难度分档)
// 双环境:Node (module.exports) 与浏览器 (window.SudokuEngine)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SudokuEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 难度档:givens = 保留给定数区间(经典分档)
  const DIFFICULTY = {
    beginner: { givens: [40, 47], label: '新手' },
    easy:     { givens: [34, 39], label: '简单' },
    medium:   { givens: [28, 33], label: '中等' },
    hard:     { givens: [23, 27], label: '困难' },
  };

  // mulberry32 可复现随机
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function conflicts(g, idx, v) {
    const r = Math.floor(idx / 9), c = idx % 9;
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    for (let i = 0; i < 9; i++) {
      if (g[r * 9 + i] === v && r * 9 + i !== idx) return true;
      if (g[i * 9 + c] === v && i * 9 + c !== idx) return true;
      const bi = (br + Math.floor(i / 3)) * 9 + bc + (i % 3);
      if (g[bi] === v && bi !== idx) return true;
    }
    return false;
  }

  // 回溯求解;digitsOrder 供生成器打乱;limit 支持解数统计
  function search(g, digits, count, limit) {
    // 找候选最少的空格(MRV 剪枝)
    let best = -1, bestCands = null;
    for (let i = 0; i < 81; i++) {
      if (g[i] !== 0) continue;
      const cands = [];
      for (const v of digits) if (!conflicts(g, i, v)) cands.push(v);
      if (best === -1 || cands.length < bestCands.length) { best = i; bestCands = cands; }
      if (bestCands.length === 0) return count.n;
      if (bestCands.length === 1) break;
    }
    if (best === -1) { count.n++; if (!count.first) count.first = g.slice(); return count.n; }
    for (const v of bestCands) {
      g[best] = v;
      search(g, digits, count, limit);
      g[best] = 0;
      if (count.n >= limit) return count.n;
    }
    return count.n;
  }

  const D19 = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  function validGivens(grid) {
    for (let i = 0; i < 81; i++) if (grid[i] !== 0 && conflicts(grid, i, grid[i])) return false;
    return true;
  }

  function solve(grid) {
    const g = grid.slice();
    if (!validGivens(g)) return null;
    const count = { n: 0, first: null };
    search(g, D19, count, 1);
    return count.first;
  }

  function countSolutions(grid, limit) {
    const g = grid.slice();
    if (!validGivens(g)) return 0;
    const count = { n: 0, first: null };
    return search(g, D19, count, limit || 2);
  }

  // 生成:先随机造终盘,再对称挖洞并保唯一解,直到 givens 落进档位
  function generate(diff, seed) {
    const spec = DIFFICULTY[diff];
    if (!spec) throw new Error('unknown difficulty: ' + diff);
    const rand = rng(seed === undefined ? (Date.now() & 0x7fffffff) : seed);

    // 造终盘:空盘 + 打乱数字序回溯
    const full = new Array(81).fill(0);
    const digits = shuffled(D19, rand);
    const count = { n: 0, first: null };
    search(full, digits, count, 1);
    const solution = count.first;

    const [lo, hi] = spec.givens;
    const target = lo + Math.floor(rand() * (hi - lo + 1));
    const puzzle = solution.slice();
    let givens = 81;
    // 中心对称成对挖洞;唯一解校验不过就放回
    const order = shuffled(Array.from({ length: 41 }, (_, i) => i), rand);
    for (const i of order) {
      if (givens <= target) break;
      const j = 80 - i;
      const holes = i === j ? [i] : [i, j];
      const saved = holes.map(h => puzzle[h]);
      if (saved.every(v => v === 0)) continue;
      if (givens - holes.length < lo) continue;
      holes.forEach(h => { puzzle[h] = 0; });
      if (countSolutions(puzzle, 2) !== 1) {
        holes.forEach((h, k) => { puzzle[h] = saved[k]; });
      } else {
        givens -= holes.filter((_, k) => saved[k] !== 0).length;
      }
    }
    // 对称挖不够(困难档常见)则退化为单格挖洞补刀
    if (givens > hi) {
      const singles = shuffled(Array.from({ length: 81 }, (_, i) => i), rand);
      for (const i of singles) {
        if (givens <= target) break;
        if (puzzle[i] === 0) continue;
        const v = puzzle[i];
        puzzle[i] = 0;
        if (countSolutions(puzzle, 2) !== 1) puzzle[i] = v;
        else givens--;
      }
    }
    return { puzzle, solution, givens, difficulty: diff };
  }

  return { solve, countSolutions, generate, DIFFICULTY };
});
