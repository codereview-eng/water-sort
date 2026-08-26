/* mine-engine.js —— 彩色扫雷引擎(纯函数,零 DOM)
   规则:N×N 盘面切成 N 个连通色块,藏 N 颗雷——每行/每列/每个色块恰好一颗,
   且任意两颗雷不相邻(含斜角,周围 8 格无雷)。
   generate(size, seed) 确定性生成「解唯一」的盘面(同 seed 永远同盘)。
   Node(module.exports)与浏览器(window.MineEngine)双装配,同仓 water-engine.js 风格。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MineEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZES = [5, 7, 9, 11];
  const MAX_ATTEMPTS = 800;

  /* mulberry32(与 engine.js 的 rng 同源):同 seed 同序列 */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(n, rand) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* 放雷:每行选一列(=列排列保证每行/每列恰一颗);
     一行一颗时,相邻只可能发生在相邻两行之间,约束 |col[r]-col[r+1]|>=2 即等价于
     「任意两雷切比雪夫距离 >= 2(周围 8 格无雷)」。随机回溯,失败返回 null。 */
  function placeMines(size, rand) {
    const cols = [];
    const used = new Array(size).fill(false);
    function bt(row) {
      if (row === size) return true;
      const order = shuffled(size, rand);
      for (let i = 0; i < size; i++) {
        const c = order[i];
        if (used[c]) continue;
        if (row > 0 && Math.abs(c - cols[row - 1]) < 2) continue;
        used[c] = true; cols.push(c);
        if (bt(row + 1)) return true;
        used[c] = false; cols.pop();
      }
      return false;
    }
    return bt(0) ? cols : null;
  }

  /* 长色块:以每颗雷为种子做多源随机生长(4 邻接),把整盘长满 N 个连通色块;
     种子即雷,天然保证「每色块恰一雷」。候选只减不增,所以被摘除的色块不会复活,
     且只要还有空位就必有色块可扩,必然长满。 */
  function growRegions(size, mineCols, rand) {
    const total = size * size;
    const region = new Array(total).fill(-1);
    for (let r = 0; r < size; r++) region[r * size + mineCols[r]] = r;
    const active = [];
    for (let i = 0; i < size; i++) active.push(i);
    let filled = size;
    while (filled < total && active.length) {
      const ai = Math.floor(rand() * active.length);
      const id = active[ai];
      const cand = [];
      for (let idx = 0; idx < total; idx++) {
        if (region[idx] !== id) continue;
        const r = (idx / size) | 0, c = idx % size;
        if (r > 0 && region[idx - size] === -1) cand.push(idx - size);
        if (r < size - 1 && region[idx + size] === -1) cand.push(idx + size);
        if (c > 0 && region[idx - 1] === -1) cand.push(idx - 1);
        if (c < size - 1 && region[idx + 1] === -1) cand.push(idx + 1);
      }
      if (!cand.length) { active.splice(ai, 1); continue; }
      region[cand[Math.floor(rand() * cand.length)]] = id;
      filled++;
    }
    return filled === total ? region : null;
  }

  /* 数解:回溯统计满足「每行/每列/每色块恰一雷 + 相邻行列差>=2」的解数,到 limit 截断。
     N 雷落进 N 个「各至多一雷」的色块且行全放满 => 鸽笼保证每色块恰一雷。 */
  function countSolutions(size, region, limit) {
    const cap = limit || 2;
    let count = 0;
    const usedCol = new Array(size).fill(false);
    const usedReg = new Array(size).fill(false);
    const cols = [];
    (function bt(row) {
      if (count >= cap) return;
      if (row === size) { count++; return; }
      for (let c = 0; c < size; c++) {
        if (usedCol[c]) continue;
        if (row > 0 && Math.abs(c - cols[row - 1]) < 2) continue;
        const rg = region[row * size + c];
        if (usedReg[rg]) continue;
        usedCol[c] = true; usedReg[rg] = true; cols.push(c);
        bt(row + 1);
        usedCol[c] = false; usedReg[rg] = false; cols.pop();
      }
    })(0);
    return count;
  }

  /* 色块连通性校验(测试/防御用):每个色块 BFS 一次 */
  function regionsConnected(size, region) {
    const total = size * size;
    const seen = new Array(total).fill(false);
    for (let id = 0; id < size; id++) {
      let start = -1, cnt = 0;
      for (let i = 0; i < total; i++) if (region[i] === id) { cnt++; if (start === -1) start = i; }
      if (cnt === 0) return false;
      const q = [start];
      seen[start] = true;
      let reach = 0;
      while (q.length) {
        const idx = q.pop();
        reach++;
        const r = (idx / size) | 0, c = idx % size;
        const nb = [];
        if (r > 0) nb.push(idx - size);
        if (r < size - 1) nb.push(idx + size);
        if (c > 0) nb.push(idx - 1);
        if (c < size - 1) nb.push(idx + 1);
        for (let k = 0; k < nb.length; k++) {
          if (!seen[nb[k]] && region[nb[k]] === id) { seen[nb[k]] = true; q.push(nb[k]); }
        }
      }
      if (reach !== cnt) return false;
    }
    return true;
  }

  /* 枚举解(至多 cap 个),解 = 每行的雷列号;约束与 countSolutions 同源 */
  function enumSolutions(size, region, cap) {
    const sols = [];
    const usedCol = new Array(size).fill(false);
    const usedReg = {};
    const cols = [];
    (function bt(row) {
      if (sols.length >= cap) return;
      if (row === size) { sols.push(cols.slice()); return; }
      for (let c = 0; c < size; c++) {
        if (usedCol[c]) continue;
        if (row > 0 && Math.abs(c - cols[row - 1]) < 2) continue;
        const g = region[row * size + c];
        if (usedReg[g]) continue;
        usedCol[c] = true; usedReg[g] = true; cols.push(c);
        bt(row + 1);
        cols.pop(); usedReg[g] = false; usedCol[c] = false;
        if (sols.length >= cap) return;
      }
    }(0));
    return sols;
  }

  /* 色块摘掉一格后剩余部分是否仍连通(摘格不许把源色块拆开/掏空) */
  function connectedAfterRemove(size, region, idx) {
    const id = region[idx];
    const cells = [];
    for (let i = 0; i < size * size; i++) {
      if (i !== idx && region[i] === id) cells.push(i);
    }
    if (!cells.length) return false;
    const seen = {};
    seen[cells[0]] = 1;
    const q = [cells[0]];
    let reach = 1;
    while (q.length) {
      const cur = q.pop();
      const r = Math.floor(cur / size), c = cur % size;
      const nb = [];
      if (r > 0) nb.push(cur - size);
      if (r < size - 1) nb.push(cur + size);
      if (c > 0) nb.push(cur - 1);
      if (c < size - 1) nb.push(cur + 1);
      for (let k = 0; k < nb.length; k++) {
        const t = nb[k];
        if (t === idx || region[t] !== id || seen[t]) continue;
        seen[t] = 1; reach++; q.push(t);
      }
    }
    return reach === cells.length;
  }

  /* 修复式收敛(spike 实证:5×5 全过、7×7 98%、11×11 留给离线预生成):
     把多余解的一个「非真雷」格挪进相邻异色块——该色块在多余解里就挤进两颗雷,
     多余解被染死;真雷/行列约束/色块连通全程不动。收敛失败返回 null(换盘) */
  function repairUnique(size, region, mines, rand, maxIter) {
    const iters = maxIter || 400;
    const reg = region.slice();
    const mineSet = {};
    for (let r = 0; r < size; r++) mineSet[r * size + mines[r]] = 1;
    for (let it = 0; it < iters; it++) {
      const sols = enumSolutions(size, reg, 2);
      if (sols.length === 1) return reg;
      if (!sols.length) return null;
      let alt = null;
      for (let s = 0; s < sols.length; s++) {
        for (let r = 0; r < size; r++) {
          if (sols[s][r] !== mines[r]) { alt = sols[s]; break; }
        }
        if (alt) break;
      }
      if (!alt) return null;
      const cands = [];
      for (let r = 0; r < size; r++) {
        const x = r * size + alt[r];
        if (mineSet[x]) continue;
        const c = x % size;
        const nb = [];
        if (r > 0) nb.push(x - size);
        if (r < size - 1) nb.push(x + size);
        if (c > 0) nb.push(x - 1);
        if (c < size - 1) nb.push(x + 1);
        for (let k = 0; k < nb.length; k++) {
          if (reg[nb[k]] !== reg[x]) cands.push([x, reg[nb[k]]]);
        }
      }
      let moved = false;
      while (cands.length) {
        const j = Math.floor(rand() * cands.length);
        const pick = cands.splice(j, 1)[0];
        if (!connectedAfterRemove(size, reg, pick[0])) continue;
        reg[pick[0]] = pick[1];
        moved = true;
        break;
      }
      if (!moved) return null;
    }
    return null;
  }

  /* 确定性生成:seed 派生尝试序列,放雷+长块后走修复式收敛拿「解唯一」盘面;
     找不到返回 null(关卡表测试会兜住) */
  function generate(size, seed) {
    if (SIZES.indexOf(size) === -1) throw new Error('unsupported size: ' + size);
    for (let att = 0; att < MAX_ATTEMPTS; att++) {
      const rand = rng((seed + att * 0x9E3779B9) >>> 0);
      const mines = placeMines(size, rand);
      if (!mines) continue;
      const region = growRegions(size, mines, rand);
      if (!region) continue;
      if (!regionsConnected(size, region)) continue;
      const fixed = repairUnique(size, region, mines, rand);
      if (!fixed) continue;
      return { size: size, seed: seed >>> 0, attempt: att, mines: mines, region: fixed };
    }
    return null;
  }

  function mineIndexes(board) {
    const out = [];
    for (let r = 0; r < board.size; r++) out.push(r * board.size + board.mines[r]);
    return out;
  }

  function contains(indexes, value) {
    if (!indexes) return false;
    if (typeof indexes.has === 'function') return indexes.has(value);
    return indexes.indexOf(value) !== -1;
  }

  /* 道具1:从还没找到的雷里挑一颗(rand 可注入,默认 Math.random);全找完返回 -1 */
  function pickUnfoundMine(board, foundIdx, rand) {
    const left = [];
    const all = mineIndexes(board);
    for (let i = 0; i < all.length; i++) {
      if (!contains(foundIdx, all[i])) left.push(all[i]);
    }
    if (!left.length) return -1;
    return left[Math.floor((rand || Math.random)() * left.length)];
  }

  /* 道具2:从「非雷、且不在 excludedIdx(已标记/已翻开)里」的格子挑一个提示安全;没有返回 -1 */
  function pickSafeCell(board, excludedIdx, rand) {
    const isMine = {};
    const all = mineIndexes(board);
    for (let i = 0; i < all.length; i++) isMine[all[i]] = 1;
    const cand = [];
    for (let i = 0; i < board.size * board.size; i++) {
      if (isMine[i]) continue;
      if (contains(excludedIdx, i)) continue;
      cand.push(i);
    }
    if (!cand.length) return -1;
    return cand[Math.floor((rand || Math.random)() * cand.length)];
  }

  /* ============ 线索推理（道具「找线索」的内核，2026-08-26） ============
     彩雷没有「周围雷数」这种数字线索，线索全部来自四条硬约束：
       每行一颗 / 每列一颗 / 每个色块一颗 / 任意两雷不相邻(8 邻域)。
     只吃玩家**真正已知的事实**：已挖开的格(确认非雷) + 已确认的雷。
     玩家自己打的 ✕ 标记不算事实——他标错了会让提示跟着错，那比没提示更糟。

     纪律 · 限流写在内核里：一次只返回一条结论。约束传播跑到不动点会一口气
     吐出几十个结论（实测 11×11 中后期平均 48.5 格 / 全盘 121 格），
     一次全给等于一键破关，所以闸门不能交给 UI 层自觉。 */
  var UNKNOWN = 0, KNOWN_SAFE = 1, KNOWN_MINE = 2;

  /* 恰好一颗雷的约束组：每行、每列、每个色块 */
  function hintGroups(size, region) {
    var gs = [], r, c, g, i;
    for (r = 0; r < size; r++) {
      g = [];
      for (c = 0; c < size; c++) g.push(r * size + c);
      gs.push({ kind: 'row', at: r, cells: g });
    }
    for (c = 0; c < size; c++) {
      g = [];
      for (r = 0; r < size; r++) g.push(r * size + c);
      gs.push({ kind: 'col', at: c, cells: g });
    }
    var byReg = {};
    for (i = 0; i < size * size; i++) {
      if (!byReg[region[i]]) byReg[region[i]] = [];
      byReg[region[i]].push(i);
    }
    Object.keys(byReg).forEach(function (id) {
      gs.push({ kind: 'region', at: Number(id), cells: byReg[id] });
    });
    return gs;
  }

  function factState(size, openedIdx, foundIdx) {
    var st = new Uint8Array(size * size), i;
    for (i = 0; i < (openedIdx || []).length; i++) st[openedIdx[i]] = KNOWN_SAFE;
    for (i = 0; i < (foundIdx || []).length; i++) st[foundIdx[i]] = KNOWN_MINE;
    return st;
  }

  function neighbors(size, idx) {
    var r = Math.floor(idx / size), c = idx % size, out = [], dr, dc, rr, cc;
    for (dr = -1; dr <= 1; dr++) {
      for (dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        rr = r + dr; cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        out.push(rr * size + cc);
      }
    }
    return out;
  }

  /* 一步局部推理：返回当前一步就能得出的**一条**结论，按可讲解程度排序——
     「这一组只剩一格 → 必是雷」最好讲，其次「这一组已有雷 → 其余非雷」，
     最后「紧邻已确认的雷 → 非雷」。推不出返回 null（= 玩家真卡住了）。 */
  function deduceStep(size, region, openedIdx, foundIdx) {
    var st = factState(size, openedIdx, foundIdx);
    var gs = hintGroups(size, region), gi, g, i, mine, unk;
    for (gi = 0; gi < gs.length; gi++) {
      g = gs[gi]; mine = -1; unk = [];
      for (i = 0; i < g.cells.length; i++) {
        if (st[g.cells[i]] === KNOWN_MINE) mine = g.cells[i];
        else if (st[g.cells[i]] === UNKNOWN) unk.push(g.cells[i]);
      }
      if (mine < 0 && unk.length === 1) {
        /* 色块可能天生只有一格（生长算法允许），此时理由不是「其它格都排除了」
           而是「这个色块只有这一格」——文案得说实话，否则玩家找不到那些「其它格」。 */
        var only = g.cells.length === 1;
        return { kind: 'mine', idx: unk[0], why: g.kind + (only ? '-only' : '-last'), group: g, depth: 'local' };
      }
    }
    for (gi = 0; gi < gs.length; gi++) {
      g = gs[gi]; mine = -1; unk = [];
      for (i = 0; i < g.cells.length; i++) {
        if (st[g.cells[i]] === KNOWN_MINE) mine = g.cells[i];
        else if (st[g.cells[i]] === UNKNOWN) unk.push(g.cells[i]);
      }
      if (mine >= 0 && unk.length) {
        return { kind: 'safe', idx: unk[0], why: g.kind + '-taken', group: g, src: mine, depth: 'local' };
      }
    }
    for (i = 0; i < size * size; i++) {
      if (st[i] !== KNOWN_MINE) continue;
      var nb = neighbors(size, i);
      for (var k = 0; k < nb.length; k++) {
        if (st[nb[k]] === UNKNOWN) {
          return { kind: 'safe', idx: nb[k], why: 'adjacent', src: i, depth: 'local' };
        }
      }
    }
    return null;
  }

  /* 带已知事实的全解枚举（一行一颗雷 → 逐行选列 + 约束剪枝）。
     卡住时用它定格：某格在所有一致解里都是雷/都不是雷 → 可确定。
     cap 兜住极端盘面的爆炸风险（实测本仓关卡最坏 80ms、解数为 1）。 */
  function decideByEnum(size, region, openedIdx, foundIdx, cap) {
    var st = factState(size, openedIdx, foundIdx);
    cap = cap === undefined ? 200000 : cap;
    var freq = new Int32Array(size * size), count = 0;
    var usedCol = new Array(size), usedReg = {}, pick = new Array(size), r;
    for (r = 0; r < size; r++) { usedCol[r] = false; pick[r] = -1; }
    var forcedOf = new Array(size);
    for (r = 0; r < size; r++) {
      forcedOf[r] = -1;
      for (var c = 0; c < size; c++) if (st[r * size + c] === KNOWN_MINE) forcedOf[r] = c;
    }
    (function bt(row) {
      if (count >= cap) return;
      if (row === size) {
        count++;
        for (var rr = 0; rr < size; rr++) freq[rr * size + pick[rr]]++;
        return;
      }
      for (var c = 0; c < size; c++) {
        var idx = row * size + c;
        if (st[idx] === KNOWN_SAFE) continue;
        if (forcedOf[row] >= 0 && c !== forcedOf[row]) continue;
        if (usedCol[c]) continue;
        if (row > 0 && Math.abs(c - pick[row - 1]) < 2) continue;
        var g = region[idx];
        if (usedReg[g]) continue;
        usedCol[c] = true; usedReg[g] = 1; pick[row] = c;
        bt(row + 1);
        pick[row] = -1; usedReg[g] = 0; usedCol[c] = false;
        if (count >= cap) return;
      }
    }(0));
    if (!count) return null;
    for (var i = 0; i < size * size; i++) {
      if (st[i] !== UNKNOWN) continue;
      if (freq[i] === count) return { kind: 'mine', idx: i, why: 'enum', depth: 'deep', solutions: count };
      if (freq[i] === 0) return { kind: 'safe', idx: i, why: 'enum', depth: 'deep', solutions: count };
    }
    return null;
  }

  /* 道具「找线索」统一入口：三层降级，保证「点了永远有用」——
     ① 一步能推出来的（讲得清理由）→ ② 卡住了用枚举定一格（诚实标注需联立推理）
     → ③ 兜底给一个真安全格（= 老道具的行为，永不返回空手）。 */
  function hintNext(board, openedIdx, foundIdx, rand) {
    var size = board.size, region = board.region;
    var step = deduceStep(size, region, openedIdx, foundIdx);
    if (step) return step;
    var deep = decideByEnum(size, region, openedIdx, foundIdx);
    if (deep) return deep;
    var excluded = (openedIdx || []).concat(foundIdx || []);
    var idx = pickSafeCell(board, excluded, rand);
    if (idx < 0) return null;
    return { kind: 'safe', idx: idx, why: 'fallback', depth: 'fallback' };
  }

  return {
    SIZES: SIZES,
    rng: rng,
    hintGroups: hintGroups,
    deduceStep: deduceStep,
    decideByEnum: decideByEnum,
    hintNext: hintNext,
    placeMines: placeMines,
    growRegions: growRegions,
    countSolutions: countSolutions,
    enumSolutions: enumSolutions,
    regionsConnected: regionsConnected,
    connectedAfterRemove: connectedAfterRemove,
    repairUnique: repairUnique,
    generate: generate,
    mineIndexes: mineIndexes,
    pickUnfoundMine: pickUnfoundMine,
    pickSafeCell: pickSafeCell,
  };
}));
