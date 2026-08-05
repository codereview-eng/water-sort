// 倒水排序引擎：合法移动 / 倒出量 / 胜利判定 + BFS 求解器（唯一规则真相）
// 双环境：Node (module.exports) 与浏览器 (window.WaterEngine)，与 engine.js 同一封装风格。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaterEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CAPACITY = 4;

  const clone = (state) => state.map((t) => t.slice());
  const top = (tube) => (tube.length ? tube[tube.length - 1] : null);

  // 顶部同色连续段长度
  function topRun(tube) {
    if (!tube.length) return 0;
    const c = tube[tube.length - 1];
    let n = 1;
    for (let k = tube.length - 2; k >= 0; k -= 1) {
      if (tube[k] !== c) break;
      n += 1;
    }
    return n;
  }

  const isMonochrome = (tube) => tube.every((c) => c === tube[0]);

  // 已完成的管：空，或装满且单色
  const isDone = (tube, capacity) =>
    tube.length === 0 || (tube.length === (capacity || CAPACITY) && isMonochrome(tube));

  // 合法移动 5 条判据（issue #6683 §2.2）
  function canMove(state, i, j, capacity) {
    const cap = capacity || CAPACITY;
    if (i === j) return false;
    const src = state[i];
    const dst = state[j];
    if (!src || !dst) return false;
    if (src.length === 0) return false;
    if (dst.length >= cap) return false;
    if (dst.length > 0 && top(dst) !== top(src)) return false;
    // 无意义平移：源已单色 且 目标为空
    if (dst.length === 0 && isMonochrome(src)) return false;
    return true;
  }

  // 方案 A：部分倒出 —— 倒出量受目标剩余容量限制
  const pourAmount = (state, i, j, capacity) =>
    Math.min(topRun(state[i]), (capacity || CAPACITY) - state[j].length);

  // 纯函数：不改入参；非法移动返回 null
  function pour(state, i, j, capacity, maxAmount) {
    const cap = capacity || CAPACITY;
    if (!canMove(state, i, j, cap)) return null;
    const next = clone(state);
    const room = pourAmount(next, i, j, cap);
    // maxAmount(可选): 单次最多倒几格——玩法侧传 1 实现「每次只倒一格」;不传保持整段语义(求解器/提示用)
    const amount = Number.isInteger(maxAmount) && maxAmount > 0 ? Math.min(room, maxAmount) : room;
    const color = top(next[i]);
    for (let k = 0; k < amount; k += 1) next[j].push(next[i].pop());
    return { state: next, amount, color };
  }

  const isSolved = (state, capacity) => state.every((t) => isDone(t, capacity));

  function legalMoves(state, capacity) {
    const out = [];
    for (let i = 0; i < state.length; i += 1) {
      for (let j = 0; j < state.length; j += 1) {
        if (canMove(state, i, j, capacity)) out.push([i, j]);
      }
    }
    return out;
  }

  // 规范化键：管序无关，供求解器去重
  const canonical = (state) => state.map((t) => t.join(',')).sort().join('|');

  // 颜色守恒：每色恰好 capacity 层
  function assertInvariants(state, capacity) {
    const cap = capacity || CAPACITY;
    const count = new Map();
    for (const t of state) {
      if (t.length > cap) throw new Error('tube overflow: ' + t.join(','));
      for (const c of t) count.set(c, (count.get(c) || 0) + 1);
    }
    for (const [c, n] of count) {
      if (n !== cap) throw new Error('color ' + c + ' appears ' + n + 'x, expected ' + cap);
    }
    return true;
  }

  // BFS 最短解：关卡可解性硬门 + 难度标定 + 提示
  function solve(state, opts) {
    const o = opts || {};
    const capacity = o.capacity || CAPACITY;
    const maxVisited = o.maxVisited || 400000;
    if (isSolved(state, capacity)) return { solvable: true, moves: [], minMoves: 0, visited: 0 };

    const seen = new Set([canonical(state)]);
    let frontier = [{ state, path: [] }];
    let visited = 0;

    while (frontier.length) {
      const next = [];
      for (const node of frontier) {
        for (const mv of legalMoves(node.state, capacity)) {
          const res = pour(node.state, mv[0], mv[1], capacity);
          if (!res) continue;
          const key = canonical(res.state);
          if (seen.has(key)) continue;
          seen.add(key);
          visited += 1;
          const path = node.path.concat([mv]);
          if (isSolved(res.state, capacity)) {
            return { solvable: true, moves: path, minMoves: path.length, visited };
          }
          if (visited > maxVisited) return { solvable: false, moves: [], minMoves: -1, visited };
          next.push({ state: res.state, path });
        }
      }
      frontier = next;
    }
    return { solvable: false, moves: [], minMoves: -1, visited };
  }

  // 提示：当前局面的下一步最优移动
  function hint(state, opts) {
    const r = solve(state, opts);
    return r.solvable && r.moves.length ? r.moves[0] : null;
  }

  return {
    CAPACITY, clone, top, topRun, isMonochrome, isDone,
    canMove, pourAmount, pour, isSolved, legalMoves, canonical, assertInvariants,
    solve, hint,
  };
});
