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

    return {
      id: level,
      capacity: spec.capacity,
      colors: COLOR_ORDER.slice(0, spec.colors),
      empty,
      layout,
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
      colors: 3, empty: 2, minMoves: 5,
      layout: [
        ['mint', 'mint', 'mint', 'coral'],
        ['coral', 'gold', 'gold', 'gold'],
        ['coral', 'coral', 'gold', 'mint'],
        [], [],
      ],
    },
    { // 第 2 关 · 3 色 2 空管 · seed 6
      colors: 3, empty: 2, minMoves: 8,
      layout: [
        ['mint', 'gold', 'coral', 'coral'],
        ['gold', 'mint', 'gold', 'coral'],
        ['coral', 'gold', 'mint', 'mint'],
        [], [],
      ],
    },
    { // 第 3 关 · 4 色 2 空管 · seed 3
      colors: 4, empty: 2, minMoves: 10,
      layout: [
        ['mint', 'coral', 'mint', 'gold'],
        ['coral', 'mint', 'sky', 'sky'],
        ['sky', 'sky', 'gold', 'gold'],
        ['mint', 'coral', 'gold', 'coral'],
        [], [],
      ],
    },
    { // 第 4 关 · 4 色 2 空管 · seed 1
      colors: 4, empty: 2, minMoves: 14,
      layout: [
        ['sky', 'mint', 'sky', 'coral'],
        ['gold', 'sky', 'gold', 'coral'],
        ['sky', 'coral', 'gold', 'mint'],
        ['coral', 'mint', 'gold', 'mint'],
        [], [],
      ],
    },
    { // 第 5 关 · 5 色 2 空管 · seed 1
      colors: 5, empty: 2, minMoves: 15,
      layout: [
        ['coral', 'sky', 'gold', 'gold'],
        ['gold', 'mint', 'coral', 'mint'],
        ['gold', 'violet', 'coral', 'violet'],
        ['sky', 'sky', 'mint', 'sky'],
        ['violet', 'mint', 'coral', 'violet'],
        [], [],
      ],
    },
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
        minMoves: fx.minMoves,
        generated: false,
      };
    }
    return genLevel(n, solveFn);
  }

  return {
    CAPACITY, PALETTE, COLOR_ORDER, FIXED_LEVELS,
    levelSpec, levelSeed, rng, scramble, isTidy, buildLayout, genLevel, forLevel,
  };
}));
