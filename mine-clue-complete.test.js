'use strict';
/* 「找线索」理由完整性 gate（2026-08-27）
   用户实报：线索指了一格「必定是雷」，可玩家看那一行/那一块，明明还有好几格没排除，
   提示却只说「其它格都排除了」—— 按提示看其实有多个选择，而其他格为什么不是雷没讲。

   RCA：clueNext 的推理是「一次全传播 + 最多 12 跳限区」，但返回值只带一个 why 标签，
   每一步排除了哪些格全部就地写进 Uint8Array 后被覆盖丢弃（confineOnce/squeezeOnce
   明明已经把被排除格清单 cut 算好并 return 了，clueNext 组装返回值时却丢掉了）。

   本 gate 的判据（一句话）：**一条线索指向的那一组里，凡是玩家自己没排除的格，
   要么由 ruled 给出理由，要么进 pending 被显式承认「这一步排不掉」——不许沉默。**
   量化基线：修复前 160/160 次提示都有沉默的候选格（平均 3.7 格、最坏 10 格）。 */
const test = require('node:test');
const assert = require('node:assert');
const MineEngine = require('./mine-engine.js');
const MineLevels = require('./mine-levels.js');

const LEVELS = 40;

function neighbors(size, idx) {
  const r = (idx / size) | 0, c = idx % size, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
    out.push(rr * size + cc);
  }
  return out;
}

/* 理性玩家：只会三条肉眼规则（组内只剩一格=雷 / 组里有雷⇒其余安全 / 雷的 8 邻域安全），
   推到不动点。推不动的那一刻正是玩家掏道具的时刻，也正是出问题的时刻。 */
function propagate(size, groups, safe, mine) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groups) {
      let hasMine = false; const unk = [];
      for (const i of g.cells) { if (mine.has(i)) hasMine = true; else if (!safe.has(i)) unk.push(i); }
      if (hasMine) { for (const i of unk) if (!safe.has(i)) { safe.add(i); changed = true; } }
      else if (unk.length === 1) { mine.add(unk[0]); changed = true; }
    }
    for (const m of Array.from(mine)) for (const nb of neighbors(size, m))
      if (!mine.has(nb) && !safe.has(nb)) { safe.add(nb); changed = true; }
  }
}

function trueMines(board) {
  const s = new Set();
  board.mines.forEach((c, r) => s.add(r * board.size + c));
  return s;
}

/* 把「理性玩家一路打到底」的全过程跑出来，收集每一次线索及其当时的盘面事实 */
function collectClues(levels) {
  const out = [];
  for (let lv = 1; lv <= levels; lv++) {
    const data = MineLevels.get(lv);
    if (!data) continue;
    const board = data.board, size = board.size;
    const groups = MineEngine.hintGroups(size, board.region);
    const real = trueMines(board);
    const safe = new Set(), mine = new Set();
    for (let guard = 0; guard < 80; guard++) {
      propagate(size, groups, safe, mine);
      if (mine.size >= real.size) break;
      const hint = MineEngine.clueNext(board, {
        opened: [], found: Array.from(mine), marks: Array.from(safe),
      });
      if (!hint) break;
      out.push({ lv, hint, real, safe: new Set(safe), mine: new Set(mine) });
      if (!real.has(hint.idx)) break;      // 线索指错了雷，另有 gate 管，这里停手
      mine.add(hint.idx);
    }
  }
  return out;
}

const CLUES = collectClues(LEVELS);

test('前置：理性玩家跑完前 40 关确实会反复掏道具（否则本 gate 是空转）', () => {
  assert.ok(CLUES.length >= 100, `样本太少：只采到 ${CLUES.length} 条线索`);
});

test('线索完整性：组内玩家没排除的每一格，要么给理由，要么进 pending —— 不许沉默', () => {
  const silent = [];
  for (const { lv, hint, safe, mine } of CLUES) {
    const cells = (hint.group && hint.group.cells) || [];
    const covered = new Set();
    for (const r of hint.ruled || []) for (const c of r.cells) covered.add(c);
    const declared = new Set(hint.pending || []);
    for (const c of cells) {
      if (c === hint.idx || safe.has(c) || mine.has(c)) continue;   // 玩家自己看得见的
      if (covered.has(c) || declared.has(c)) continue;              // 讲了 / 认账了
      silent.push({ lv, why: hint.why, cell: c });
    }
  }
  assert.deepStrictEqual(silent, [],
    `有 ${silent.length} 格被静默排除（玩家会看到「还有好几个选择」而提示只解释了一个）`);
});

test('能一步步讲清的层（confine / squeeze / 局部）必须零 pending —— 只有 enum 查表层可以认账', () => {
  const bad = CLUES.filter((c) => c.hint.why !== 'enum' && (c.hint.pending || []).length > 0)
    .map((c) => ({ lv: c.lv, why: c.hint.why, pending: c.hint.pending.length }));
  assert.deepStrictEqual(bad, [], '这些层的理由本来推得出来，不该退到「要联立」');
});

test('理由不许撒谎：ruled 里被判成「不是雷」的格，必须真的不是雷', () => {
  const lies = [];
  for (const { lv, hint, real } of CLUES) {
    for (const r of hint.ruled || []) {
      for (const c of r.cells) if (real.has(c)) lies.push({ lv, rule: r.rule, cell: c });
    }
  }
  assert.deepStrictEqual(lies, [], '把真雷讲成安全格 = 比不给理由更严重');
});

test('ruled 的形状：不含目标格、不重复、每步都带得出依据', () => {
  const RULES = new Set(['group-mine', 'touch-mine', 'touch', 'confine', 'squeeze', 'cover', 'refute']);
  for (const { lv, hint } of CLUES) {
    const seen = new Set();
    for (const r of hint.ruled || []) {
      assert.ok(RULES.has(r.rule), `lv${lv} 未知规则 ${r.rule}`);
      assert.ok(r.cells.length > 0, `lv${lv} ${r.rule} 步没有任何格子`);
      if (r.rule === 'group-mine') assert.ok(r.group && r.group.kind, `lv${lv} group-mine 缺 group`);
      if (r.rule === 'touch-mine') assert.ok(Number.isInteger(r.at), `lv${lv} touch-mine 缺依据雷`);
      if (r.rule === 'confine') {
        assert.ok(r.from && r.from.kind, `lv${lv} confine 缺 from 组`);
        assert.ok(r.into && r.into.kind, `lv${lv} confine 缺 into 组`);
      }
      if (r.rule === 'squeeze') assert.ok(r.lineKind === 'row' || r.lineKind === 'col', `lv${lv} squeeze 缺线别`);
      /* k 组覆盖（2026-08-29）：讲这一步必须交得出三样东西 —— 哪 k 个组（from）、
         它们的雷只能落在哪 k 个组里（into）、以及那些候选格（cand）。
         少任何一样，玩家就无从验算，这条理由就退化成又一句「你就信我」。 */
      /* 反证（2026-08-29）：必须交得出「矛盾是什么」，否则这一步就是又一句「你就信我」。
         bad='empty' 要指出是哪一组没地方放雷；bad='adjacent' 是两雷贴一起。 */
      if (r.rule === 'refute') {
        assert.strictEqual(r.cells.length, 1, `lv${lv} 反证一次只排一格`);
        assert.ok(r.bad === 'empty' || r.bad === 'adjacent', `lv${lv} 反证没说清矛盾类型：${r.bad}`);
        if (r.bad === 'empty') assert.ok(r.badGroup && r.badGroup.kind, `lv${lv} 反证没指出是哪一组放不下雷`);
        assert.ok(typeof r.chain === 'number' && r.chain > 0, `lv${lv} 反证缺链长`);
      }
      if (r.rule === 'touch') assert.ok(Number.isInteger(r.at), `lv${lv} touch 缺依据雷`);
      if (r.rule === 'cover') {
        assert.ok(Array.isArray(r.from) && r.from.length >= 2, `lv${lv} cover 的 from 至少两组`);
        assert.ok(Array.isArray(r.into) && r.into.length === r.from.length, `lv${lv} cover 的 into 必须与 from 等长`);
        assert.ok(Array.isArray(r.cand) && r.cand.length >= r.from.length, `lv${lv} cover 缺候选格 cand`);
        for (const g of r.from.concat(r.into)) assert.ok(g && g.kind, `lv${lv} cover 组缺 kind`);
        /* from 的候选格两两不相交，是鸽笼成立的前提（混用行列共用同一颗雷就不成立了） */
        const own = new Set();
        for (const c of r.cand) { assert.ok(!own.has(c), `lv${lv} cover 候选格重复`); own.add(c); }
      }
      for (const c of r.cells) {
        assert.notStrictEqual(c, hint.idx, `lv${lv} ruled 里混进了目标格`);
        assert.ok(!seen.has(c), `lv${lv} 格 ${c} 被讲了两遍`);
        seen.add(c);
      }
    }
  }
});

test('pending 只在真的推不动时出现，且必须落在结论所在组内', () => {
  for (const { lv, hint } of CLUES) {
    const cells = new Set((hint.group && hint.group.cells) || []);
    for (const c of hint.pending || []) {
      assert.ok(cells.has(c), `lv${lv} pending 指到了组外的格 ${c}`);
      assert.notStrictEqual(c, hint.idx, `lv${lv} pending 里混进了目标格`);
    }
  }
});

test('老调用方零影响：propagateSafe 不传 reason 仍照常工作', () => {
  const data = MineLevels.get(1);
  const size = data.board.size;
  const st = new Uint8Array(size * size);
  const out = MineEngine.propagateSafe(size, data.board.region, st);
  assert.strictEqual(out, st, 'propagateSafe 应原地返回同一个 st');
});
