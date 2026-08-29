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

  /* ============ 「找线索」v2（2026-08-27 重做） ============
     用户实报：道具反复弹「这一格肯定不是雷」，指的还是同一行/同一列/雷旁边，
     已经 ✕ 掉的格子照样反复提示 —— 基本没用。
     Spike 实测（test/manual/mine-clue-spike.mjs，40 关 2400 次）坐实了：
       解卡率 0.0% / 冗余率 99.3% / 重复率 98.3% / 每次提示带来的可标雷 0.00。

     根因两条，都在事实口径与目标上：
     ① 玩法里**只有双击挖雷才算进度**，挖错要扣血 —— 所以理性玩家的 S.opened 永远是空的，
        引擎拿到的事实只剩「已找到的雷」，于是它只能反复输出「××行已有雷 → 其余安全」。
        玩家真正的进度全记在 S.marks（他自己打的 ✕）里，而 v1 把 marks 当猜测整个丢掉。
     ② 「安全格」对玩家没有价值：赢的条件是找出全部雷，而它给的安全格恰恰是玩家一眼就知道的
        （同行/同列/紧贴已知雷）。

     v2 的口径：**每一次提示都必须指向一个能被标成雷的落点**，并按「玩家自己验算得动的程度」
     分层给理由。marks 参与推理，但只认**真的不是雷**的那些；打在真雷上的记号只是不采信，
     **不当成「玩家标错了」去纠正**（owner 拍板 2026-08-29，见 clueNext 头注）。 */

  /* ---- 排除记账（2026-08-27）----
     v2 的推理是「全传播 + 最多 12 跳限区」的多步过程，但每一步都只是就地把 st 改成
     KNOWN_SAFE，改完就被下一步覆盖。于是玩家只拿到最后一句结论，组里那些他自己还没
     ✕ 掉的格「为什么不是雷」一个字都没有 —— 用户实报的「线索不完整」就是这么来的。
     解法：每次把一格判成安全，都把「凭哪条规则、依据哪颗雷/哪一组」记进 reason[idx]，
     第一次记的那条为准（最早=最浅的理由最好讲）。reason 不传就完全不记，老调用方零影响。 */
  function noteReason(reason, idx, info) {
    if (!reason || reason[idx]) return;
    reason[idx] = info;
  }

  /* 同一条规则、同一个依据排掉的格子要合并成一句话讲，别一格一句刷屏 */
  function reasonKey(r) {
    if (r.rule === 'group-mine') return 'group-mine|' + r.group.kind + '|' + r.group.at + '|' + r.at;
    if (r.rule === 'touch-mine') return 'touch-mine|' + r.at;
    if (r.rule === 'confine') return 'confine|' + r.from.kind + '|' + r.from.at + '|' + r.into.kind + '|' + r.into.at;
    if (r.rule === 'cover') {
      return 'cover|' + r.from.map(function (g) { return g.kind + g.at; }).join(',')
        + '|' + r.into.map(function (g) { return g.kind + g.at; }).join(',');
    }
    return 'squeeze|' + r.lineKind + '|' + r.from + '|' + r.into;
  }

  /* 只传播「安全」结论，绝不在这里派生新的雷 —— 限流仍然写在内核里：
     一次调用只吐一个雷。规则都是玩家肉眼可验的：组里已有雷 → 其余安全；紧贴雷 → 安全。 */
  function propagateSafe(size, region, st, reason) {
    var gs = hintGroups(size, region), changed = true, gi, g, i, k, nb, hasMine, mineAt;
    while (changed) {
      changed = false;
      for (gi = 0; gi < gs.length; gi++) {
        g = gs[gi]; hasMine = false; mineAt = -1;
        for (i = 0; i < g.cells.length; i++) if (st[g.cells[i]] === KNOWN_MINE) { hasMine = true; mineAt = g.cells[i]; break; }
        if (!hasMine) continue;
        for (i = 0; i < g.cells.length; i++) {
          if (st[g.cells[i]] === UNKNOWN) {
            st[g.cells[i]] = KNOWN_SAFE; changed = true;
            noteReason(reason, g.cells[i], { rule: 'group-mine', group: g, at: mineAt });
          }
        }
      }
      for (i = 0; i < size * size; i++) {
        if (st[i] !== KNOWN_MINE) continue;
        nb = neighbors(size, i);
        for (k = 0; k < nb.length; k++) {
          if (st[nb[k]] === UNKNOWN) {
            st[nb[k]] = KNOWN_SAFE; changed = true;
            noteReason(reason, nb[k], { rule: 'touch-mine', at: i });
          }
        }
      }
    }
    return st;
  }

  /* 限区/限行（Star Battle 的 pointing 规则，本作规则同构：每行/列/色块恰一颗雷）：
     若 A 组还没排除的格子**全都落在** B 组里，则 B 的那颗雷必然就是 A 的那颗 ——
     于是 B 里在 A 之外的格子全部安全。玩家卡在局部不动点时，几乎只有这一步能继续，
     而它仍然是**讲得清、玩家自己能验算**的，不是「天降答案」。 */
  /* k 组覆盖（Star Battle 的 set counting / 数独 hidden pair 同构，k=1 即 confineOnce）：
     取 k 个**同类型**（同为行 / 同为列 / 同为色块，因而两两不相交，雷必然互不相同）且还没有雷的组，
     若它们的候选格全部落在另外 k 个还没有雷的组里，这 k 颗雷就把那 k 个组正好占满 ——
     于是那 k 个组里落在候选之外的格子全部安全。

     **为什么要加这一层**（2026-08-29，用户实报「无端端就给出了最终答案，不理解」）：
     玩家卡住的时刻，confine/squeeze 也常常跑到不动点，引擎只能掉进 enum 兜底层直接查解表给答案。
     实测（test/manual/mine-clue-cover-spike.mjs）兜底层占理性玩家提示的 36.9%；反证式讲解
     （假设雷在这→矛盾）已被实测否掉：2 跳内只讲得清 30.6% 的候选，讲深了等于换个姿势给答案。
     k 组覆盖是玩家能自己数一遍验算的规则，因而是「把答案换成推理」的正确杠杆。

     CELL_CAP 限制候选面：讲解要短才有人看，铺开一大片就失去意义了。 */
  function coverOnce(size, region, st, k, reason) {
    var gs = hintGroups(size, region), info = [], gi, i, c, cells, hasMine, unk;
    for (gi = 0; gi < gs.length; gi++) {
      cells = gs[gi].cells; hasMine = false; unk = [];
      for (i = 0; i < cells.length; i++) {
        c = cells[i];
        if (st[c] === KNOWN_MINE) { hasMine = true; break; }
        if (st[c] === UNKNOWN) unk.push(c);
      }
      if (!hasMine && unk.length) info.push({ g: gs[gi], unk: unk });
    }
    var n = info.length, owners = {}, CELL_CAP = k * 4;
    for (gi = 0; gi < n; gi++) {
      for (i = 0; i < info[gi].unk.length; i++) {
        c = info[gi].unk[i];
        if (!owners[c]) owners[c] = [];
        owners[c].push(gi);
      }
    }
    function has(arr, v) { var j; for (j = 0; j < arr.length; j++) if (arr[j] === v) return true; return false; }

    /* S 固定后找 T：每个还没被盖住的候选格只可能由「含它的组」来盖（≤3 个），
       所以这是一棵很浅的精确覆盖搜索树，不会爆。 */
    function findT(S, U) {
      var T = [], covered = {}, found = null;
      (function pick() {
        if (found) return;
        var next = -1, q;
        for (q = 0; q < U.length; q++) if (!covered[U[q]]) { next = U[q]; break; }
        if (next < 0) { if (T.length === k) found = T.slice(); return; }
        if (T.length === k) return;
        var os = owners[next] || [], oi, gidx, added, w, cc;
        for (oi = 0; oi < os.length; oi++) {
          gidx = os[oi];
          if (has(S, gidx) || has(T, gidx)) continue;
          T.push(gidx); added = [];
          for (w = 0; w < info[gidx].unk.length; w++) {
            cc = info[gidx].unk[w];
            if (!covered[cc]) { covered[cc] = 1; added.push(cc); }
          }
          pick();
          for (w = 0; w < added.length; w++) covered[added[w]] = 0;
          T.pop();
          if (found) return;
        }
      })();
      return found;
    }

    var combo = [], out = null;
    function walk(start) {
      if (out) return;
      if (combo.length === k) {
        var U = [], j, m, cc;
        for (j = 0; j < combo.length; j++) {
          for (m = 0; m < info[combo[j]].unk.length; m++) {
            cc = info[combo[j]].unk[m];
            if (!has(U, cc)) U.push(cc);
          }
        }
        if (U.length < k || U.length > CELL_CAP) return;
        var T = findT(combo, U);
        if (!T) return;
        var cut = [], w, x;
        for (j = 0; j < T.length; j++) {
          for (w = 0; w < info[T[j]].unk.length; w++) {
            x = info[T[j]].unk[w];
            if (!has(U, x) && !has(cut, x)) cut.push(x);
          }
        }
        if (!cut.length) return;
        var from = [], into = [];
        for (j = 0; j < combo.length; j++) from.push(info[combo[j]].g);
        for (j = 0; j < T.length; j++) into.push(info[T[j]].g);
        for (j = 0; j < cut.length; j++) {
          st[cut[j]] = KNOWN_SAFE;
          noteReason(reason, cut[j], { rule: 'cover', k: k, from: from, into: into, cand: U.slice() });
        }
        /* cand 必须一起交出来：讲这一步时要指出「这几组的雷只能落在这些格里」，
           少了它玩家无从验算（门禁 mine-clue-complete 会红）。 */
        out = { from: from, into: into, cut: cut, k: k, cand: U.slice() };
        return;
      }
      var i2, j2, ok;
      for (i2 = start; i2 < n; i2++) {
        /* **候选格两两不相交**是鸽笼成立的前提：两个组若共用候选格，就可能共用同一颗雷，
           k 个组就凑不出 k 颗互不相同的雷（混用行与列最容易踩这个坑）。
           比「必须同类型」更宽，且同样成立：不相交的行 + 色块也能一起用。 */
        ok = true;
        for (j2 = 0; j2 < combo.length && ok; j2++) {
          for (var w2 = 0; w2 < info[i2].unk.length && ok; w2++) {
            if (has(info[combo[j2]].unk, info[i2].unk[w2])) ok = false;
          }
        }
        if (!ok) continue;
        combo.push(i2); walk(i2 + 1); combo.pop();
        if (out) return;
      }
    }
    walk(0);
    return out;
  }

  function confineOnce(size, region, st, reason) {
    var gs = hintGroups(size, region), out = null, ai, bi, A, B, i;
    var unks = [], hasMine = [];
    for (ai = 0; ai < gs.length; ai++) {
      var u = [], hm = false;
      for (i = 0; i < gs[ai].cells.length; i++) {
        if (st[gs[ai].cells[i]] === KNOWN_MINE) { hm = true; break; }
        if (st[gs[ai].cells[i]] === UNKNOWN) u.push(gs[ai].cells[i]);
      }
      unks.push(u); hasMine.push(hm);
    }
    for (ai = 0; ai < gs.length; ai++) {
      if (hasMine[ai] || unks[ai].length < 1) continue;
      for (bi = 0; bi < gs.length; bi++) {
        if (bi === ai || hasMine[bi]) continue;
        A = gs[ai]; B = gs[bi];
        if (A.kind === B.kind) continue;            // 同类组之间不会互相包含出新信息
        var inside = {}, all = true;
        for (i = 0; i < B.cells.length; i++) inside[B.cells[i]] = 1;
        for (i = 0; i < unks[ai].length; i++) if (!inside[unks[ai][i]]) { all = false; break; }
        if (!all) continue;
        var mineOf = {};
        for (i = 0; i < unks[ai].length; i++) mineOf[unks[ai][i]] = 1;
        var cut = [];
        for (i = 0; i < unks[bi].length; i++) if (!mineOf[unks[bi][i]]) cut.push(unks[bi][i]);
        if (!cut.length) continue;
        for (i = 0; i < cut.length; i++) {
          st[cut[i]] = KNOWN_SAFE;
          noteReason(reason, cut[i], { rule: 'confine', from: A, into: B });
        }
        out = { from: A, into: B, cut: cut };
        return out;                                  // 一次只走一步，便于把理由讲给玩家
      }
    }
    return null;
  }

  /* 邻行/邻列夹逼（「两颗雷不相邻」的推广版）：某一行的雷只可能落在很窄的一段列里时，
     相邻行里被这一段整段贴住的格子就不可能是雷 —— 无论那一行的雷落在这段的哪一格，
     都会和它相邻。已确认的雷只是这条规则里 S 只剩一格的特例。 */
  function squeezeOnce(size, region, st, reason) {
    var lines = [], a, b, i, j, k;
    for (a = 0; a < size; a++) {
      var rowU = [], colU = [], rowMine = false, colMine = false;
      for (b = 0; b < size; b++) {
        var ri = a * size + b, ci = b * size + a;
        if (st[ri] === KNOWN_MINE) rowMine = true; else if (st[ri] === UNKNOWN) rowU.push(b);
        if (st[ci] === KNOWN_MINE) colMine = true; else if (st[ci] === UNKNOWN) colU.push(b);
      }
      lines.push({ row: rowMine ? null : rowU, col: colMine ? null : colU });
    }
    for (i = 0; i < size; i++) {
      for (k = -1; k <= 1; k += 2) {
        j = i + k;
        if (j < 0 || j >= size) continue;
        var src = lines[i].row, dst = lines[j].row;
        if (src && src.length && dst) {
          var cut = [];
          for (var t = 0; t < dst.length; t++) {
            var c = dst[t], all = true;
            for (var s = 0; s < src.length; s++) if (Math.abs(c - src[s]) > 1) { all = false; break; }
            if (all) cut.push(j * size + c);
          }
          if (cut.length) {
            for (t = 0; t < cut.length; t++) {
              st[cut[t]] = KNOWN_SAFE;
              noteReason(reason, cut[t], { rule: 'squeeze', lineKind: 'row', from: i, into: j, span: src.length });
            }
            return { kind: 'row', from: i, into: j, span: src.length, cut: cut };
          }
        }
        var srcC = lines[i].col, dstC = lines[j].col;
        if (srcC && srcC.length && dstC) {
          var cutC = [];
          for (var t2 = 0; t2 < dstC.length; t2++) {
            var r = dstC[t2], all2 = true;
            for (var s2 = 0; s2 < srcC.length; s2++) if (Math.abs(r - srcC[s2]) > 1) { all2 = false; break; }
            if (all2) cutC.push(r * size + j);
          }
          if (cutC.length) {
            for (t2 = 0; t2 < cutC.length; t2++) {
              st[cutC[t2]] = KNOWN_SAFE;
              noteReason(reason, cutC[t2], { rule: 'squeeze', lineKind: 'col', from: i, into: j, span: srcC.length });
            }
            return { kind: 'col', from: i, into: j, span: srcC.length, cut: cutC };
          }
        }
      }
    }
    return null;
  }

  /* 在给定事实下找「这一组只剩一格没排除，且这组还没找到雷」→ 那一格必是雷。
     **返回第一个**：只给 v1/老调用方与不关心挑哪颗的场合用。 */
  function soleMineIn(size, region, st) {
    var all = allSolesIn(size, region, st);
    return all.length ? all[0] : null;
  }

  /* 全部「推得出来」的雷，而不是扫到的第一颗。
     Why（owner 拍板 2026-08-29）：hintGroups 的顺序是「先所有行、再所有列、最后色块」，
     只取第一个就等于**按行列顺序**给下一颗雷 —— 玩家的原话是「应该找到能通过推理出来的
     下一个雷，而不是按行或者列计算的下一个雷」。挑哪一颗必须由**讲解成本**决定，不由扫描顺序决定。 */
  function allSolesIn(size, region, st) {
    var gs = hintGroups(size, region), out = [], gi, g, i, unk, hasMine;
    for (gi = 0; gi < gs.length; gi++) {
      g = gs[gi]; hasMine = false; unk = [];
      for (i = 0; i < g.cells.length; i++) {
        if (st[g.cells[i]] === KNOWN_MINE) { hasMine = true; break; }
        if (st[g.cells[i]] === UNKNOWN) unk.push(g.cells[i]);
      }
      if (!hasMine && unk.length === 1) out.push({ idx: unk[0], group: g, only: g.cells.length === 1 });
    }
    return out;
  }

  /* 在同样「推得出来」的几颗雷里，挑**人最容易自己验算**的那颗：
     组里还欠玩家理由的格子越少越好；讲得出理由的格算 1 步，讲不出的（会落进 pending）罚 3 步。
     同分再按格号，保证同一盘面同一答案（提示必须可复现，否则玩家会觉得道具在乱指）。 */
  function pickSole(soles, known, reason) {
    var best = null, i, j, s, cost, cells, c;
    for (i = 0; i < soles.length; i++) {
      s = soles[i]; cells = s.group.cells; cost = 0;
      for (j = 0; j < cells.length; j++) {
        c = cells[j];
        if (c === s.idx || (known && known[c])) continue;
        cost += (reason && reason[c]) ? 1 : 3;
      }
      if (!best || cost < best.cost || (cost === best.cost && s.idx < best.s.idx)) best = { s: s, cost: cost };
    }
    return best ? best.s : null;
  }

  /* 「最接近被推出来」的那颗雷：所在行/列/色块里剩余未排除格最少的一颗。
     卡死时指它，玩家离验算最近，体感也最像「下一步」而不是「天降答案」。 */
  function nearestMine(size, region, st, unfound) {
    var gs = hintGroups(size, region), remain = {}, gi, g, i, unk, hasMine;
    for (gi = 0; gi < gs.length; gi++) {
      g = gs[gi]; hasMine = false; unk = [];
      for (i = 0; i < g.cells.length; i++) {
        if (st[g.cells[i]] === KNOWN_MINE) { hasMine = true; break; }
        if (st[g.cells[i]] === UNKNOWN) unk.push(g.cells[i]);
      }
      if (hasMine || !unk.length) continue;
      for (i = 0; i < unk.length; i++) {
        if (remain[unk[i]] === undefined || unk.length < remain[unk[i]].n) {
          remain[unk[i]] = { n: unk.length, group: g };
        }
      }
    }
    var best = null;
    for (i = 0; i < unfound.length; i++) {
      var info = remain[unfound[i]];
      var score = info ? info.n : size * size;
      if (!best || score < best.score) best = { idx: unfound[i], score: score, group: info ? info.group : null };
    }
    return best;
  }

  /* ---- 反证（v5，2026-08-29，owner 口径：「道具就是把推理过程按顺序显示出来」）----
     假设某格是雷，顺着规则往下推，撞出矛盾 ⇒ 它不是雷。人本来就会这么想，
     而且**每次玩家卡住时它都给得出下一步**：实测 40 关 278 个卡点 278 次给得出
     （test/manual/mine-clue-chain-spike.mjs），矛盾链中位 5 步、最长 13。
     所以查表兜底那一层被它整个替掉了。

     早前 mine-clue-refute-spike 曾判「反证只能讲清 30.6%」——那次把内层推理限死在 2 跳，
     结论是错的。**内层必须放开到完整规则集**（基础三条 + 限区 + 夹逼 + 覆盖）。 */

  /* 内层模拟：只用「组内只剩一格=雷 / 组内有雷=其余安全 / 雷的邻格安全」推到不动点，
     同时检测两类矛盾：某组一格不剩、两雷相邻。返回 { bad, group, at, steps }。 */
  function simulate(size, region, st) {
    var gs = hintGroups(size, region), changed = true, steps = 0, gi, g, i, k, nb, hasMine, unk;
    while (changed) {
      changed = false;
      for (gi = 0; gi < gs.length; gi++) {
        g = gs[gi]; hasMine = false; unk = [];
        for (i = 0; i < g.cells.length; i++) {
          if (st[g.cells[i]] === KNOWN_MINE) hasMine = true;
          else if (st[g.cells[i]] === UNKNOWN) unk.push(g.cells[i]);
        }
        if (!hasMine && unk.length === 0) return { bad: 'empty', group: g, steps: steps };
        if (!hasMine && unk.length === 1) { st[unk[0]] = KNOWN_MINE; changed = true; steps++; continue; }
        if (hasMine && unk.length) {
          for (i = 0; i < unk.length; i++) st[unk[i]] = KNOWN_SAFE;
          changed = true; steps++;
        }
      }
      for (i = 0; i < size * size; i++) {
        if (st[i] !== KNOWN_MINE) continue;
        nb = neighbors(size, i);
        for (k = 0; k < nb.length; k++) {
          if (st[nb[k]] === KNOWN_MINE) return { bad: 'adjacent', at: i, steps: steps };
        }
        for (k = 0; k < nb.length; k++) {
          if (st[nb[k]] === UNKNOWN) { st[nb[k]] = KNOWN_SAFE; changed = true; steps++; }
        }
      }
    }
    return { bad: null, steps: steps };
  }

  /* 找一格「假设它是雷就会矛盾」的格子。挑矛盾链最短的讲，人才跟得下来。
     TRY_CAP / GOOD_ENOUGH 是手感闸门：道具是点一下就要出结果的，不能为了找最优解卡住。 */
  function refuteOnce(size, region, st, known) {
    var gs = hintGroups(size, region), cands = [], gi, g, i, hasMine, unk;
    for (gi = 0; gi < gs.length; gi++) {
      g = gs[gi]; hasMine = false; unk = [];
      for (i = 0; i < g.cells.length; i++) {
        if (st[g.cells[i]] === KNOWN_MINE) hasMine = true;
        else if (st[g.cells[i]] === UNKNOWN) unk.push(g.cells[i]);
      }
      if (!hasMine && unk.length >= 2) cands.push({ g: g, unk: unk });
    }
    cands.sort(function (a, b) { return a.unk.length - b.unk.length; });

    var TRY_CAP = 24, GOOD_ENOUGH = 4, tried = 0, best = null, ci, ui, c, sim, sc, hop;
    for (ci = 0; ci < cands.length; ci++) {
      for (ui = 0; ui < cands[ci].unk.length; ui++) {
        if (tried >= TRY_CAP) break;
        c = cands[ci].unk[ui];
        if (known && known[c]) continue;
        tried++;
        sc = new Uint8Array(st); sc[c] = KNOWN_MINE;
        var total = 0;
        for (hop = 0; hop < 16; hop++) {
          sim = simulate(size, region, sc);
          total += sim.steps;
          if (sim.bad) break;
          if (!(confineOnce(size, region, sc) || squeezeOnce(size, region, sc)
             || coverOnce(size, region, sc, 2) || coverOnce(size, region, sc, 3))) { sim = null; break; }
          total++;
        }
        if (sim && sim.bad && (!best || total < best.chain)) {
          best = { idx: c, chain: total, bad: sim.bad, group: sim.group || null, at: sim.at === undefined ? null : sim.at,
                   inGroup: cands[ci].g };
          if (total <= GOOD_ENOUGH) return best;
        }
      }
      if (tried >= TRY_CAP) break;
    }
    return best;
  }

  /* ---- 推理链（v6，owner 口径 2026-08-29：「推理顺序需要达到找到雷。
     一次道具需要有多个 step，而不仅仅是下一步」）----
     从玩家当下的认知出发，按人会用的顺序一路推到**一颗雷**，把沿途每一步都记下来：
       组内有雷→其余排除 / 贴着雷→排除 / 限区 / 夹逼 / 覆盖 / 反证 → … → 这一格是雷。
     UI 把这条链做成「第 i/N 步」逐步讲，最后一步才是结论。 */

  /* 一步基础排除：组里已有雷 → 其余排除；或贴着某颗雷 → 排除。返回一条，没有返回 null。 */
  function basicElimOnce(size, region, st) {
    var gs = hintGroups(size, region), gi, g, i, k, nb, at, unk;
    for (gi = 0; gi < gs.length; gi++) {
      g = gs[gi]; at = -1; unk = [];
      for (i = 0; i < g.cells.length; i++) {
        if (st[g.cells[i]] === KNOWN_MINE) at = g.cells[i];
        else if (st[g.cells[i]] === UNKNOWN) unk.push(g.cells[i]);
      }
      if (at >= 0 && unk.length) {
        for (i = 0; i < unk.length; i++) st[unk[i]] = KNOWN_SAFE;
        return { rule: 'group-mine', group: g, at: at, cells: unk };
      }
    }
    for (i = 0; i < size * size; i++) {
      if (st[i] !== KNOWN_MINE) continue;
      nb = neighbors(size, i); unk = [];
      for (k = 0; k < nb.length; k++) if (st[nb[k]] === UNKNOWN) unk.push(nb[k]);
      if (unk.length) {
        for (k = 0; k < unk.length; k++) st[unk[k]] = KNOWN_SAFE;
        return { rule: 'touch', at: i, cells: unk };
      }
    }
    return null;
  }

  /* 一步高级排除：限区 → 夹逼 → k 组覆盖，取先命中的那条 */
  function advancedElimOnce(size, region, st) {
    var before = new Uint8Array(st), i, cut;
    function diff() {
      var out = [];
      for (i = 0; i < size * size; i++) if (st[i] === KNOWN_SAFE && before[i] === UNKNOWN) out.push(i);
      return out;
    }
    var cf = confineOnce(size, region, st);
    if (cf) return { rule: 'confine', from: cf.from, into: cf.into, cells: cf.cut };
    var sq = squeezeOnce(size, region, st);
    if (sq) {
      cut = sq.cut && sq.cut.length ? sq.cut : diff();
      if (cut.length) return { rule: 'squeeze', lineKind: sq.kind || null, from: sq.from, into: sq.into, cells: cut };
    }
    var k2 = coverOnce(size, region, st, 2) || coverOnce(size, region, st, 3);
    if (k2) return { rule: 'cover', k: k2.k, from: k2.from, into: k2.into, cand: k2.cand || null, cells: k2.cut };
    return null;
  }

  /* 从玩家的认知推到下一颗雷，返回**有序**的整条链（最后一项 rule='mine'）。
     推不到雷返回 null。MAX_STEPS 是可读性闸门：链太长玩家就不看了。 */
  function chainToMine(size, region, st, known, maxSteps) {
    var steps = [], guard = 0, cap = maxSteps || 14;
    while (guard++ < cap) {
      var sole = pickSole(allSolesIn(size, region, st), known, null);
      if (sole) {
        steps.push({ rule: 'mine', idx: sole.idx, group: sole.group, only: sole.only });
        return steps;
      }
      var e = basicElimOnce(size, region, st);
      if (e) { steps.push(e); continue; }
      e = advancedElimOnce(size, region, st);
      if (e) { steps.push(e); continue; }
      var ref = refuteOnce(size, region, st, known);
      if (ref) {
        st[ref.idx] = KNOWN_SAFE;
        steps.push({ rule: 'refute', cells: [ref.idx], bad: ref.bad, chain: ref.chain,
                     badGroup: ref.group || null, badAt: ref.at === undefined ? null : ref.at });
        continue;
      }
      return null;
    }
    return null;
  }

  /* 道具「找线索」入口：facts = { opened, found, marks }

     **v5 口径（owner 2026-08-29）：道具 = 把推理过程按顺序显示出来。**
     所以它返回的是**推理链上的下一步**，而不是「一定是一颗雷」：
       ① *-last/-only  这一组只剩一格 → 是雷（玩家一步就能验算）
       ② *-clear       把已找到的雷顺手排掉之后，这一组只剩这一格 → 是雷
       ③ confine/squeeze/cover 走一步高级规则后又逼出一颗雷
       ④ refute        推不出雷了 → 给下一步**排除**：假设这格是雷会撞矛盾，所以它不是雷
       ⑤ enum          连反证都给不出（实测 0 次）才退回查表，且只给范围不直接揭晓
     ①–④ 每一条都是玩家自己能验算的，④ 的结论 kind 是 'safe'（要玩家打 ✕，不是挖开）。

     **不判「玩家标错了」**（owner 拍板 2026-08-29）：标记对玩家而言是多义的，
     打在真雷上的 ✕ 完全可能是「我怀疑这儿有雷」的记号，而不是一个错误结论。
     线索的职责是指出下一颗雷，不是审判玩家的记号。 */
  function clueNext(board, facts) {
    facts = facts || {};
    var size = board.size, region = board.region, i;
    var all = mineIndexes(board), isMine = {};
    for (i = 0; i < all.length; i++) isMine[all[i]] = 1;
    var found = facts.found || [], foundSet = {};
    for (i = 0; i < found.length; i++) foundSet[found[i]] = 1;
    var opened = facts.opened || [], marks = facts.marks || [];

    /* 玩家视角的「已排除」只有这三样，它们无需再解释；组里除此之外的每一格
       都欠玩家一个理由 —— 这正是 reason 记账要补上的那部分。 */
    var known = {};
    for (i = 0; i < opened.length; i++) known[opened[i]] = 1;
    for (i = 0; i < marks.length; i++) known[marks[i]] = 1;
    for (i = 0; i < found.length; i++) known[found[i]] = 1;
    var reason = new Array(size * size);

    function explain(res, group) {
      var ruled = [], pending = [], order = {}, c, r, k, j;
      var cells = (group && group.cells) || [];
      for (j = 0; j < cells.length; j++) {
        c = cells[j];
        if (c === res.idx || known[c]) continue;
        r = reason[c];
        if (!r) { pending.push(c); continue; }
        k = reasonKey(r);
        if (order[k] === undefined) {
          order[k] = ruled.length;
          ruled.push({ rule: r.rule, group: r.group || null, at: r.at === undefined ? null : r.at,
                       from: r.from === undefined ? null : r.from,
                       into: r.into === undefined ? null : r.into,
                       lineKind: r.lineKind || null, cand: r.cand || null, cells: [] });
        }
        ruled[order[k]].cells.push(c);
      }
      res.ruled = ruled;
      res.pending = pending;
      return res;
    }

    var st = new Uint8Array(size * size);
    for (i = 0; i < opened.length; i++) st[opened[i]] = KNOWN_SAFE;
    /* marks 只认「确实不是雷」的那些：打在真雷上的标记直接不采信（既不当安全格，
       也不当错误来指责玩家），所以提示永远不会跟着一个错误前提走。 */
    for (i = 0; i < marks.length; i++) if (!isMine[marks[i]]) st[marks[i]] = KNOWN_SAFE;
    for (i = 0; i < found.length; i++) st[found[i]] = KNOWN_MINE;

    /* v6：一次道具 = 一条**有序**推理链，一路推到一颗雷。
       ruled 就是链上的中间步骤（按推理顺序，不是按格号顺序），最后一项是结论。 */
    var work = new Uint8Array(st);
    var chain = chainToMine(size, region, work, known, 30);
    if (chain) {
      var last = chain[chain.length - 1];
      var ruledSteps = [], si, s;
      for (si = 0; si < chain.length - 1; si++) {
        s = chain[si];
        ruledSteps.push({ rule: s.rule, group: s.group || null, at: s.at === undefined ? null : s.at,
          from: s.from === undefined ? null : s.from, into: s.into === undefined ? null : s.into,
          lineKind: s.lineKind || null, cand: s.cand || null, k: s.k || null,
          bad: s.bad || null, chain: s.chain || null, badGroup: s.badGroup || null,
          cells: s.cells.slice() });
      }
      /* 结论组里，玩家没排除、链上也没讲到的格 —— 正常应为空（链已经把路走完了） */
      var told = {}, pend = [], ci, cc;
      for (si = 0; si < ruledSteps.length; si++) {
        for (ci = 0; ci < ruledSteps[si].cells.length; ci++) told[ruledSteps[si].cells[ci]] = 1;
      }
      for (ci = 0; ci < last.group.cells.length; ci++) {
        cc = last.group.cells[ci];
        if (cc !== last.idx && !known[cc] && !told[cc]) pend.push(cc);
      }
      return { kind: 'mine', idx: last.idx, group: last.group, depth: 'chain',
               why: last.group.kind + (last.only ? '-only' : '-last'),
               ruled: ruledSteps, pending: pend, steps: chain.length };
    }

    var st2 = propagateSafe(size, region, new Uint8Array(st), reason);
    var sole = pickSole(allSolesIn(size, region, st2), known, reason);
    if (sole) {
      return explain({ kind: 'mine', idx: sole.idx, group: sole.group, depth: 'chain',
               why: sole.group.kind + (sole.only ? '-only' : '-clear') }, sole.group);
    }

    /* ④ 限区/限行：玩家卡在局部不动点时基本只有这一步能走，而它仍然讲得清。
       每走一步就回头看有没有哪一组只剩一格，最多走 CONFINE_STEPS 步 —— 走得越少，
       理由越短、越好讲；走满了还推不出来就认账，走第 ⑤ 层。 */
    var CONFINE_STEPS = 12, hop;
    for (hop = 0; hop < CONFINE_STEPS; hop++) {
      var cf = confineOnce(size, region, st2, reason);
      var why = 'confine', sq = null, cov = null;
      if (!cf) {
        sq = squeezeOnce(size, region, st2, reason);
        why = 'squeeze';
        if (!sq) {
          /* ④b k 组覆盖：confine/squeeze 都跑到不动点时，玩家就卡死了 ——
             以前这里直接掉进 enum 查表给答案（实测占 36.9% 的提示，用户实报「不理解」）。
             k 从小到大试：讲解条数越少越好懂。 */
          /* k 只到 3：实测 k=4 只把兜底层再压 1 个百分点（29.8%→28.8%），
             却把最坏耗时从 13ms 推到 71ms，讲解还要一口气念四个组 —— 不值。 */
          cov = coverOnce(size, region, st2, 2, reason) || coverOnce(size, region, st2, 3, reason);
          if (!cov) break;
          why = 'cover';
        }
      }
      propagateSafe(size, region, st2, reason);
      sole = pickSole(allSolesIn(size, region, st2), known, reason);
      if (sole) {
        return explain({ kind: 'mine', idx: sole.idx, group: sole.group, depth: 'confine',
                 why: why, from: cf ? cf.from : (cov ? cov.from : null),
                 into: cf ? cf.into : (cov ? cov.into : null),
                 line: sq || null, coverK: cov ? cov.k : null, steps: hop + 1 }, sole.group);
      }
    }

    var unfound = [];
    for (i = 0; i < all.length; i++) if (!foundSet[all[i]]) unfound.push(all[i]);
    if (!unfound.length) return null;

    /* 走到这里说明连「反证也推不到雷」（chainToMine 已经把反证算进链里试过了）。
       实测 40 关跑不到这一层；留着只作 fail-safe，且仍然只给范围、不直接揭晓。 */
    var best = nearestMine(size, region, st2, unfound);
    if (!best) return null;
    /* 这一层是**查表**不是推理（nearestMine 直接读真雷表），所以结构上没有完整理由可讲。
       但能讲的部分必须讲：ruled 里是已经排掉的格与依据，pending 里是「还得联立才能排除」
       的格 —— UI 必须把 pending 明确标出来并诚实说明，不能再假装「其它格都排除了」。 */
    /* 兜底层唯一还能给玩家的东西是**范围**：把结论所在那一组里还没排掉的格子一并交出来。
       UI 拿它先只给范围、由玩家自己决定要不要看答案 —— 用户实报的「无端端就给出了最终答案」
       治的正是这个「无端端」：讲不出理由时，至少不能替玩家做「揭晓」这个决定。 */
    var shortlist = [best.idx];
    if (best.group) {
      for (i = 0; i < best.group.cells.length; i++) {
        var sc = best.group.cells[i];
        if (sc !== best.idx && st2[sc] === UNKNOWN && !known[sc]) shortlist.push(sc);
      }
    }
    return explain({ kind: 'mine', idx: best.idx, group: best.group || null, depth: 'deep',
             why: 'enum', shortlist: shortlist }, best.group || null);
  }

  /* 道具「找线索」v1 入口（保留：v2 的对照基线与老测试仍在用）：三层降级——
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
    clueNext: clueNext,
    propagateSafe: propagateSafe,
    soleMineIn: soleMineIn,
    allSolesIn: allSolesIn,
    pickSole: pickSole,
    confineOnce: confineOnce,
    coverOnce: coverOnce,
    squeezeOnce: squeezeOnce,
    refuteOnce: refuteOnce,
    simulate: simulate,
    nearestMine: nearestMine,
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
