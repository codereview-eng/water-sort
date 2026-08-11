// 倒水关卡：前 5 关固定盘面（全网同题，minMoves 由 BFS 离线标定，water-levels.test.js 锁定快照），
// 第 6 关起按关卡号 seed 确定性生成（反向打乱法：从已解状态逆推，天然保证可解，不依赖端上 BFS）。
// 双环境：Node (module.exports) 与浏览器 (window.WaterLevels)，与 levels.js 同一封装风格。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaterLevels = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CAPACITY = 4;

  // 液体色板：前三色取自 sudoku 主题变量（--accent / --podium / --bad），其余同色系扩展
  const PALETTE = {
    mint: '#7FC29B', gold: '#D4B36A', coral: '#DE7A70', sky: '#6FA8D6',
    violet: '#9B8BD0', amber: '#D2A05C', rose: '#D982A8', teal: '#5FBFB0',
  };
  const COLOR_ORDER = ['mint', 'gold', 'coral', 'sky', 'violet', 'amber', 'rose', 'teal'];

  // mulberry32 可复现随机（与 engine.js 的 rng 同款）
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const levelSeed = (level) => (Math.imul(level, 2654435761) ^ 0x5D0C0) >>> 1;

  // 难度曲线：颜色数 3→8 递增，空管恒定 2 根。
  // 为什么不把空管收到 1：8 色 + 1 空管的随机盘面几乎全部不可解（实测第 23 关连摇 60 次零命中），
  // 那不是难度而是生成不出关。真要再加难度，后续走「加深管容量」而不是「砍空管」。
  function levelSpec(level) {
    const colors = Math.min(3 + Math.floor((level - 1) / 3), COLOR_ORDER.length);
    return { capacity: CAPACITY, colors, empty: 2 };
  }

  // ---- 反向打乱：从已解状态出发做「逆倒水」，结果必然可解 ----
  // 逆操作 = 把 from 顶部 k 层同色搬到 to（to 顶色与之不同才算真打乱），
  // 正向回放时它就是一次合法的「顶色相同/倒进空管」移动。
  function scramble(state, steps, rand) {
    const cap = CAPACITY;
    for (let s = 0; s < steps; s += 1) {
      const cand = [];
      for (let i = 0; i < state.length; i += 1) {
        const src = state[i];
        if (!src.length) continue;
        const c = src[src.length - 1];
        let run = 1;
        for (let k = src.length - 2; k >= 0 && src[k] === c; k -= 1) run += 1;
        for (let j = 0; j < state.length; j += 1) {
          if (i === j) continue;
          const dst = state[j];
          const room = cap - dst.length;
          if (room <= 0) continue;
          if (dst.length && dst[dst.length - 1] === c) continue; // 同色叠加＝没打乱
          const maxK = Math.min(run, room);
          for (let k = 1; k <= maxK; k += 1) {
            // 整管平移到空管＝换个位置放，没打乱（但部分倒进空管是有效打乱，必须保留：
            // 否则「全满管 + 空管」的已解态第一步就没有候选，scramble 直接空转）
            if (dst.length === 0 && k === src.length) continue;
            cand.push([i, j, k]);
          }
        }
      }
      if (!cand.length) break;
      const mv = cand[Math.floor(rand() * cand.length)];
      for (let k = 0; k < mv[2]; k += 1) state[mv[1]].push(state[mv[0]].pop());
    }
    return state;
  }

  // 盘面「整齐」约束：非空管必须根根装满，且空管数恰好等于设计值，且不是已解态。
  // 参差不齐（半管、多余空位）的盘面既难看也让难度不可控，一律重摇。
  function isTidy(state, colors, empty, capacity) {
    const cap = capacity || CAPACITY;
    let full = 0, blank = 0, solvedTubes = 0;
    for (const t of state) {
      if (t.length === 0) { blank += 1; continue; }
      if (t.length !== cap) return false;
      full += 1;
      if (t.every((c) => c === t[0])) solvedTubes += 1;
    }
    if (full !== colors || blank !== empty) return false;
    return solvedTubes < colors;   // 已解态不算关卡
  }

  // 洗牌构造整齐盘面：每色 capacity 份丢进池子 → Fisher-Yates（seeded）→ 切成 colors 根满管 + empty 根空管。
  // 「根根装满」由构造方式天然保证（逆向打乱做不到这点：它会停在半管形态，管一多就摇不出整齐盘面）。
  // 可解性不由构造保证，交给调用方用求解器验证。
  function buildLayout(colors, empty, seed, capacity) {
    const cap = capacity || CAPACITY;
    const rand = rng(seed >>> 0);
    const pool = [];
    for (let c = 0; c < colors; c += 1) {
      for (let k = 0; k < cap; k += 1) pool.push(COLOR_ORDER[c]);
    }
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    const state = [];
    for (let c = 0; c < colors; c += 1) state.push(pool.slice(c * cap, c * cap + cap));
    for (let e = 0; e < empty; e += 1) state.push([]);
    return isTidy(state, colors, empty, cap) ? state : null;   // 洗出已解态则判废
  }

  // 锁配置只认「合法、去重、且当前为空瓶」的零基索引；缺省即不锁，绝不从空瓶自动推导。
  function normalizeLockedBottleIndexes(indexes, layout) {
    if (!Array.isArray(indexes) || !Array.isArray(layout)) return [];
    const seen = new Set();
    const out = [];
    for (const index of indexes) {
      if (!Number.isInteger(index) || index < 0 || index >= layout.length ||
          !Array.isArray(layout[index]) || layout[index].length !== 0 || seen.has(index)) continue;
      seen.add(index);
      out.push(index);
    }
    return out;
  }

  // 生成关最多锁一根空瓶；只有移除该瓶后仍可解才配置，避免把解锁做成强制付费门。
  function generatedLockedBottleIndexes(layout, solveFn, capacity) {
    if (typeof solveFn !== 'function') return [];
    const empty = [];
    for (let i = 0; i < layout.length; i += 1) {
      if (layout[i].length === 0) empty.push(i);
    }
    for (let i = empty.length - 1; i >= 0; i -= 1) {
      const index = empty[i];
      const playable = layout.filter((_, tubeIndex) => tubeIndex !== index);
      const result = solveFn(playable, { capacity, maxVisited: 120000 });
      if (result && result.solvable) return [index];
    }
    return [];
  }

  // 生成第 level 关（确定性：同一 level 全网同题）。
  // solveFn 可选：传入求解器则逐个盘面验证可解，不可解就换 seed 重摇（端上开局跑一次，实测 6 色约 0.1s）。
  function genLevel(level, solveFn) {
    const spec = levelSpec(level);
    const base = levelSeed(level);
    let layout = null;
    let empty = spec.empty;
    let degraded = null;

    // 逐级放宽：先按设计空管数摇，摇不出可解盘面就多给一根空管（宁可简单一点，也不能发不可解的关）。
    // 降级不是静默的：结果里带 degraded 字段 + 控制台告警，便于发现「某段关卡长期摇不出来」。
    for (let relax = 0; relax <= 2 && !layout; relax += 1) {
      empty = spec.empty + relax;
      for (let attempt = 0; attempt < 60 && !layout; attempt += 1) {
        const seed = (base + relax * 0x85EBCA6B + attempt * 0x9E3779B1) >>> 0;
        const cand = buildLayout(spec.colors, empty, seed, spec.capacity);
        if (!cand) continue;
        if (!solveFn) { layout = cand; break; }
        const r = solveFn(cand, { capacity: spec.capacity, maxVisited: 120000 });
        if (r && r.solvable) layout = cand;
      }
      if (layout && relax > 0) {
        degraded = '第 ' + level + ' 关按 ' + spec.empty + ' 根空管摇了 60 次都不可解，放宽到 ' + empty + ' 根';
        if (typeof console !== 'undefined' && console.warn) console.warn('[water-levels] ' + degraded);
      }
    }
    if (!layout) throw new Error('无法为第 ' + level + ' 关生成可用盘面（含放宽空管后）');

    const lockedBottleIndexes = generatedLockedBottleIndexes(layout, solveFn, spec.capacity);
    return {
      id: level,
      capacity: spec.capacity,
      colors: COLOR_ORDER.slice(0, spec.colors),
      empty,
      layout,
      lockedBottleIndexes,
      minMoves: null,                            // 生成关不标定最短解（端上不跑全量 BFS）
      generated: true,
      degraded,
    };
  }

  // ---- 前 5 关：固定盘面（教学爬坡），minMoves 由离线 BFS 标定 ----
  // 由 pick-fixed-levels.mjs 挑选（整齐盘面 + BFS 标定 minMoves 落在目标区间），
  // water-levels.test.js 锁定快照：改动这里必须同步重跑标定。
  const FIXED_LEVELS = [
    { // 第 1 关 · 3 色 2 空管 · seed 17
      colors: 3, empty: 2, minMoves: 5, lockedBottleIndexes: [4],
      layout: [
        ['mint', 'mint', 'mint', 'coral'],
        ['coral', 'gold', 'gold', 'gold'],
        ['coral', 'coral', 'gold', 'mint'],
        [], [],
      ],
    },
    { // 第 2 关 · 3 色 2 空管 · seed 6
      colors: 3, empty: 2, minMoves: 8, lockedBottleIndexes: [3],
      layout: [
        ['mint', 'gold', 'coral', 'coral'],
        ['gold', 'mint', 'gold', 'coral'],
        ['coral', 'gold', 'mint', 'mint'],
        [], [],
      ],
    },
    { // 第 3 关 · 4 色 2 空管 · seed 3
      colors: 4, empty: 2, minMoves: 10, lockedBottleIndexes: [5],
      layout: [
        ['mint', 'coral', 'mint', 'gold'],
        ['coral', 'mint', 'sky', 'sky'],
        ['sky', 'sky', 'gold', 'gold'],
        ['mint', 'coral', 'gold', 'coral'],
        [], [],
      ],
    },
    { // 第 4 关 · 4 色 2 空管 · seed 1
      colors: 4, empty: 2, minMoves: 14, lockedBottleIndexes: [],
      layout: [
        ['sky', 'mint', 'sky', 'coral'],
        ['gold', 'sky', 'gold', 'coral'],
        ['sky', 'coral', 'gold', 'mint'],
        ['coral', 'mint', 'gold', 'mint'],
        [], [],
      ],
    },
    { // 第 5 关 · 5 色 2 空管 · seed 1
      colors: 5, empty: 2, minMoves: 15, lockedBottleIndexes: [],
      layout: [
        ['coral', 'sky', 'gold', 'gold'],
        ['gold', 'mint', 'coral', 'mint'],
        ['gold', 'violet', 'coral', 'violet'],
        ['sky', 'sky', 'mint', 'sky'],
        ['violet', 'mint', 'coral', 'violet'],
        [], [],
      ],
    },
      { // 第 6 关 · basic · 4 色 2 空管 · 锁 5 · seed 600001
      theme: 'basic', colors: 4, empty: 2,
      minMoves: 12, minMovesLocked: 12, lockedBottleIndexes: [5],
      layout: [
        ['mint', 'sky', 'sky', 'coral'],
        ['sky', 'coral', 'gold', 'mint'],
        ['gold', 'mint', 'coral', 'gold'],
        ['mint', 'gold', 'coral', 'sky'],
        [],
        [],
      ],
    },   // 扫 1 个盘面 / 466ms
    { // 第 7 关 · basic · 4 色 2 空管 · 锁 5 · seed 700004
      theme: 'basic', colors: 4, empty: 2,
      minMoves: 14, minMovesLocked: 14, lockedBottleIndexes: [5],
      layout: [
        ['sky', 'mint', 'coral', 'mint'],
        ['mint', 'coral', 'gold', 'sky'],
        ['sky', 'coral', 'sky', 'gold'],
        ['gold', 'mint', 'gold', 'coral'],
        [],
        [],
      ],
    },   // 扫 4 个盘面 / 525ms
    { // 第 8 关 · basic · 5 色 2 空管 · 锁 6 · seed 800003
      theme: 'basic', colors: 5, empty: 2,
      minMoves: 17, minMovesLocked: 17, lockedBottleIndexes: [6],
      layout: [
        ['violet', 'mint', 'gold', 'coral'],
        ['violet', 'mint', 'violet', 'sky'],
        ['mint', 'gold', 'mint', 'coral'],
        ['sky', 'gold', 'coral', 'sky'],
        ['violet', 'gold', 'sky', 'coral'],
        [],
        [],
      ],
    },   // 扫 3 个盘面 / 925ms
    { // 第 9 关 · basic · 5 色 2 空管 · 锁 6 · seed 900214
      theme: 'basic', colors: 5, empty: 2,
      minMoves: 17, minMovesLocked: 18, lockedBottleIndexes: [6],
      layout: [
        ['mint', 'gold', 'mint', 'coral'],
        ['violet', 'coral', 'gold', 'mint'],
        ['gold', 'violet', 'sky', 'coral'],
        ['gold', 'violet', 'sky', 'violet'],
        ['sky', 'coral', 'sky', 'mint'],
        [],
        [],
      ],
    },   // 扫 214 个盘面 / 42672ms
    { // 第 10 关 · basic · 5 色 2 空管 · 锁 6 · seed 1000080 · 离带 2 步
      theme: 'basic', colors: 5, empty: 2,
      minMoves: 16, minMovesLocked: 17, lockedBottleIndexes: [6],
      layout: [
        ['mint', 'violet', 'mint', 'gold'],
        ['sky', 'gold', 'coral', 'gold'],
        ['sky', 'coral', 'mint', 'coral'],
        ['mint', 'sky', 'gold', 'violet'],
        ['violet', 'violet', 'sky', 'coral'],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 91332ms
    { // 第 11 关 · tight · 5 色 3 空管 · 锁 6,7 · seed 1100136
      theme: 'tight', colors: 5, empty: 3,
      minMoves: 16, minMovesLocked: 17, lockedBottleIndexes: [6, 7],
      layout: [
        ['violet', 'mint', 'coral', 'gold'],
        ['violet', 'coral', 'violet', 'sky'],
        ['gold', 'sky', 'gold', 'mint'],
        ['mint', 'mint', 'coral', 'sky'],
        ['gold', 'sky', 'coral', 'violet'],
        [],
        [],
        [],
      ],
    },   // 扫 136 个盘面 / 84683ms
    { // 第 12 关 · tight · 5 色 3 空管 · 锁 6,7 · seed 1200016 · 离带 2 步
      theme: 'tight', colors: 5, empty: 3,
      minMoves: 16, minMovesLocked: 17, lockedBottleIndexes: [6, 7],
      layout: [
        ['violet', 'sky', 'gold', 'violet'],
        ['sky', 'violet', 'sky', 'violet'],
        ['gold', 'coral', 'sky', 'mint'],
        ['coral', 'gold', 'mint', 'gold'],
        ['mint', 'coral', 'coral', 'mint'],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 173110ms
    { // 第 13 关 · tight · 6 色 3 空管 · 锁 8 · seed 1300356
      theme: 'tight', colors: 6, empty: 3,
      minMoves: 19, minMovesLocked: 20, lockedBottleIndexes: [8],
      layout: [
        ['violet', 'violet', 'amber', 'coral'],
        ['violet', 'mint', 'mint', 'sky'],
        ['violet', 'mint', 'gold', 'coral'],
        ['coral', 'amber', 'gold', 'sky'],
        ['coral', 'gold', 'amber', 'sky'],
        ['sky', 'amber', 'gold', 'mint'],
        [],
        [],
        [],
      ],
    },   // 扫 356 个盘面 / 431113ms
    { // 第 14 关 · tight · 6 色 3 空管 · 锁 8 · seed 1400052
      theme: 'tight', colors: 6, empty: 3,
      minMoves: 21, minMovesLocked: 21, lockedBottleIndexes: [8],
      layout: [
        ['coral', 'amber', 'gold', 'violet'],
        ['coral', 'mint', 'coral', 'sky'],
        ['violet', 'sky', 'gold', 'sky'],
        ['coral', 'amber', 'violet', 'mint'],
        ['gold', 'violet', 'amber', 'gold'],
        ['mint', 'amber', 'sky', 'mint'],
        [],
        [],
        [],
      ],
    },   // 扫 52 个盘面 / 49264ms
    { // 第 15 关 · tight · 6 色 3 空管 · 锁 7,8 · seed 1500410 · 离带 3 步
      theme: 'tight', colors: 6, empty: 3,
      minMoves: 19, minMovesLocked: 20, lockedBottleIndexes: [7, 8],
      layout: [
        ['gold', 'sky', 'coral', 'coral'],
        ['gold', 'violet', 'amber', 'mint'],
        ['violet', 'gold', 'mint', 'sky'],
        ['violet', 'violet', 'amber', 'sky'],
        ['coral', 'sky', 'coral', 'amber'],
        ['mint', 'amber', 'mint', 'gold'],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 54915ms
    { // 第 16 关 · crowd · 6 色 3 空管 · 锁 7,8 · seed 1600251 · 离带 1 步
      theme: 'crowd', colors: 6, empty: 3,
      minMoves: 21, minMovesLocked: 22, lockedBottleIndexes: [7, 8],
      layout: [
        ['violet', 'coral', 'mint', 'amber'],
        ['mint', 'gold', 'coral', 'sky'],
        ['sky', 'amber', 'gold', 'amber'],
        ['amber', 'sky', 'violet', 'coral'],
        ['violet', 'gold', 'mint', 'coral'],
        ['mint', 'violet', 'sky', 'gold'],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 279938ms
    { // 第 17 关 · crowd · 6 色 3 空管 · 锁 7,8 · seed 1700374 · 离带 3 步
      theme: 'crowd', colors: 6, empty: 3,
      minMoves: 20, minMovesLocked: 21, lockedBottleIndexes: [7, 8],
      layout: [
        ['gold', 'mint', 'sky', 'mint'],
        ['amber', 'sky', 'coral', 'violet'],
        ['coral', 'amber', 'violet', 'amber'],
        ['violet', 'amber', 'sky', 'gold'],
        ['mint', 'sky', 'violet', 'coral'],
        ['coral', 'gold', 'mint', 'gold'],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 103842ms
    { // 第 18 关 · crowd · 6 色 3 空管 · 锁 7,8 · seed 1800026 · 离带 5 步
      theme: 'crowd', colors: 6, empty: 3,
      minMoves: 19, minMovesLocked: 20, lockedBottleIndexes: [7, 8],
      layout: [
        ['amber', 'mint', 'violet', 'coral'],
        ['mint', 'coral', 'sky', 'coral'],
        ['amber', 'mint', 'amber', 'violet'],
        ['gold', 'gold', 'sky', 'coral'],
        ['sky', 'violet', 'gold', 'mint'],
        ['sky', 'amber', 'gold', 'violet'],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 89171ms
    { // 第 19 关 · crowd · 6 色 4 空管 · 锁 7,8,9 · seed 1900058 · 离带 6 步
      theme: 'crowd', colors: 6, empty: 4,
      minMoves: 18, minMovesLocked: 20, lockedBottleIndexes: [7, 8, 9],
      layout: [
        ['violet', 'sky', 'amber', 'coral'],
        ['gold', 'coral', 'amber', 'violet'],
        ['coral', 'gold', 'sky', 'violet'],
        ['sky', 'amber', 'violet', 'coral'],
        ['sky', 'mint', 'gold', 'gold'],
        ['mint', 'mint', 'amber', 'mint'],
        [],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 317743ms
    { // 第 20 关 · crowd · 6 色 4 空管 · 锁 7,8,9 · seed 2000314 · 离带 6 步
      theme: 'crowd', colors: 6, empty: 4,
      minMoves: 19, minMovesLocked: 21, lockedBottleIndexes: [7, 8, 9],
      layout: [
        ['violet', 'sky', 'gold', 'amber'],
        ['amber', 'violet', 'mint', 'mint'],
        ['sky', 'violet', 'sky', 'gold'],
        ['sky', 'amber', 'gold', 'coral'],
        ['mint', 'coral', 'violet', 'gold'],
        ['mint', 'coral', 'amber', 'coral'],
        [],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 380848ms
    { // 第 21 关 · crowd · 6 色 4 空管 · 锁 7,8,9 · seed 2100462 · 离带 6 步
      theme: 'crowd', colors: 6, empty: 4,
      minMoves: 19, minMovesLocked: 21, lockedBottleIndexes: [7, 8, 9],
      layout: [
        ['gold', 'mint', 'gold', 'amber'],
        ['violet', 'mint', 'violet', 'mint'],
        ['coral', 'sky', 'gold', 'sky'],
        ['coral', 'amber', 'amber', 'violet'],
        ['amber', 'coral', 'violet', 'sky'],
        ['gold', 'mint', 'coral', 'sky'],
        [],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 394965ms
    { // 第 22 关 · crowd · 6 色 4 空管 · 锁 7,8,9 · seed 2200492 · 离带 9 步
      theme: 'crowd', colors: 6, empty: 4,
      minMoves: 17, minMovesLocked: 19, lockedBottleIndexes: [7, 8, 9],
      layout: [
        ['mint', 'mint', 'coral', 'amber'],
        ['coral', 'amber', 'amber', 'gold'],
        ['mint', 'gold', 'violet', 'mint'],
        ['sky', 'coral', 'sky', 'amber'],
        ['coral', 'sky', 'violet', 'violet'],
        ['violet', 'gold', 'sky', 'gold'],
        [],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 358933ms
    { // 第 23 关 · master · 6 色 3 空管 · 锁 7,8 · seed 2300259 · 离带 5 步
      theme: 'master', colors: 6, empty: 3,
      minMoves: 20, minMovesLocked: 21, lockedBottleIndexes: [7, 8],
      layout: [
        ['coral', 'amber', 'sky', 'coral'],
        ['violet', 'gold', 'violet', 'sky'],
        ['mint', 'coral', 'mint', 'amber'],
        ['coral', 'gold', 'amber', 'gold'],
        ['violet', 'mint', 'sky', 'mint'],
        ['sky', 'violet', 'amber', 'gold'],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 93029ms
    { // 第 24 关 · master · 6 色 3 空管 · 锁 7,8 · seed 2400025 · 离带 7 步
      theme: 'master', colors: 6, empty: 3,
      minMoves: 19, minMovesLocked: 20, lockedBottleIndexes: [7, 8],
      layout: [
        ['mint', 'amber', 'gold', 'amber'],
        ['sky', 'gold', 'sky', 'amber'],
        ['mint', 'violet', 'sky', 'amber'],
        ['coral', 'violet', 'violet', 'gold'],
        ['gold', 'sky', 'coral', 'violet'],
        ['coral', 'mint', 'coral', 'mint'],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 78929ms
    { // 第 25 关 · master · 6 色 4 空管 · 锁 7,8,9 · seed 2500290 · 离带 8 步
      theme: 'master', colors: 6, empty: 4,
      minMoves: 18, minMovesLocked: 19, lockedBottleIndexes: [7, 8, 9],
      layout: [
        ['gold', 'mint', 'coral', 'sky'],
        ['coral', 'mint', 'mint', 'gold'],
        ['sky', 'coral', 'gold', 'amber'],
        ['sky', 'violet', 'gold', 'coral'],
        ['violet', 'mint', 'sky', 'amber'],
        ['violet', 'amber', 'amber', 'violet'],
        [],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 370199ms
    { // 第 26 关 · master · 6 色 4 空管 · 锁 7,8,9 · seed 2600055 · 离带 7 步
      theme: 'master', colors: 6, empty: 4,
      minMoves: 20, minMovesLocked: 21, lockedBottleIndexes: [7, 8, 9],
      layout: [
        ['coral', 'gold', 'violet', 'sky'],
        ['gold', 'amber', 'violet', 'mint'],
        ['coral', 'sky', 'gold', 'violet'],
        ['amber', 'sky', 'mint', 'violet'],
        ['mint', 'coral', 'gold', 'sky'],
        ['amber', 'mint', 'amber', 'coral'],
        [],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 344219ms
    { // 第 27 关 · master · 6 色 4 空管 · 锁 7,8,9 · seed 2700177 · 离带 7 步
      theme: 'master', colors: 6, empty: 4,
      minMoves: 20, minMovesLocked: 21, lockedBottleIndexes: [7, 8, 9],
      layout: [
        ['sky', 'amber', 'mint', 'coral'],
        ['gold', 'mint', 'violet', 'coral'],
        ['amber', 'violet', 'gold', 'sky'],
        ['sky', 'mint', 'gold', 'amber'],
        ['gold', 'sky', 'amber', 'violet'],
        ['mint', 'coral', 'violet', 'coral'],
        [],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 326859ms
    { // 第 28 关 · master · 6 色 4 空管 · 锁 7,8,9 · seed 2800352 · 离带 8 步
      theme: 'master', colors: 6, empty: 4,
      minMoves: 20, minMovesLocked: 21, lockedBottleIndexes: [7, 8, 9],
      layout: [
        ['gold', 'sky', 'mint', 'coral'],
        ['mint', 'amber', 'gold', 'violet'],
        ['mint', 'violet', 'sky', 'gold'],
        ['coral', 'mint', 'amber', 'sky'],
        ['amber', 'gold', 'sky', 'violet'],
        ['coral', 'violet', 'coral', 'amber'],
        [],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 251516ms
    { // 第 29 关 · master · 6 色 4 空管 · 锁 7,8,9 · seed 2900272 · 离带 10 步
      theme: 'master', colors: 6, empty: 4,
      minMoves: 18, minMovesLocked: 19, lockedBottleIndexes: [7, 8, 9],
      layout: [
        ['sky', 'coral', 'gold', 'coral'],
        ['gold', 'mint', 'coral', 'violet'],
        ['amber', 'violet', 'gold', 'sky'],
        ['violet', 'sky', 'sky', 'amber'],
        ['amber', 'coral', 'mint', 'mint'],
        ['mint', 'gold', 'amber', 'violet'],
        [],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 276862ms
    { // 第 30 关 · master · 6 色 4 空管 · 锁 7,8,9 · seed 3000255 · 离带 10 步
      theme: 'master', colors: 6, empty: 4,
      minMoves: 19, minMovesLocked: 20, lockedBottleIndexes: [7, 8, 9],
      layout: [
        ['gold', 'sky', 'coral', 'gold'],
        ['sky', 'gold', 'coral', 'violet'],
        ['mint', 'amber', 'amber', 'mint'],
        ['coral', 'mint', 'amber', 'violet'],
        ['coral', 'violet', 'gold', 'sky'],
        ['violet', 'mint', 'sky', 'amber'],
        [],
        [],
        [],
        [],
      ],
    },   // 扫 500 个盘面 / 208920ms
];

  // 关卡入口：1-5 固定，6+ 生成。返回的 layout 是可变副本，UI 可直接改。
  // solveFn 透传给生成器做可解性验证（浏览器侧传 WaterEngine.solve）。
  function forLevel(level, solveFn) {
    const n = Math.max(1, level | 0);
    if (n <= FIXED_LEVELS.length) {
      const fx = FIXED_LEVELS[n - 1];
      return {
        id: n,
        capacity: CAPACITY,
        colors: COLOR_ORDER.slice(0, fx.colors),
        empty: fx.empty,
        layout: fx.layout.map((t) => t.slice()),
        lockedBottleIndexes: normalizeLockedBottleIndexes(fx.lockedBottleIndexes, fx.layout),
        minMoves: fx.minMoves,
        generated: false,
      };
    }
    return genLevel(n, solveFn);
  }

  return {
    CAPACITY, PALETTE, COLOR_ORDER, FIXED_LEVELS,
    levelSpec, levelSeed, rng, scramble, isTidy, buildLayout,
    normalizeLockedBottleIndexes, generatedLockedBottleIndexes, genLevel, forLevel,
  };
}));
