/* mine-clue-refute-spike.mjs —— 「天降答案」到底占多少、能不能改成可验算的反证（2026-08-29）

   用户实报（截图，第 11 关）：线索条说「这一步要联立 —— 这一格确实是雷，但要跨行列一起看
   才推得出来」，玩家的原话是「无端端就给出了最终答案，不理解」。
   这一条走的是 clueNext 最后的兜底层 why='enum'：它是**查解表**挑的一颗雷，没有理由可讲。

   本 spike 只回答两个问题，不看文案：
   ① 理性玩家真正掏道具的时刻里，落到 enum 兜底层的占多少？
   ② 这些时刻能不能改成**可验算的反证**：对同组里剩下的每一格 Y 说
      「假设雷在 Y → 某行/某列/某色块就没地方放雷了」，从而反推「所以雷只能在 X」。
      关键是**这个矛盾要浅**——玩家自己得能验算，深搜出来的矛盾等于换个姿势给答案。

   跑法：node test/manual/mine-clue-refute-spike.mjs [关数，默认 40]
*/
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../../mine-engine.js');
const Levels = require('../../mine-levels.js');

const UNKNOWN = 0, KNOWN_SAFE = 1, KNOWN_MINE = 2;
const LEVELS = Number(process.argv[2] || 40);
const MAX_HOPS = 2;              // 反证允许的传播跳数：0=一步、1/2=还能讲，再深就是换姿势给答案

function groupsOf(size, region) {
  const gs = [];
  for (let r = 0; r < size; r++) {
    const cells = []; for (let c = 0; c < size; c++) cells.push(r * size + c);
    gs.push({ kind: 'row', at: r, cells });
  }
  for (let c = 0; c < size; c++) {
    const cells = []; for (let r = 0; r < size; r++) cells.push(r * size + c);
    gs.push({ kind: 'col', at: c, cells });
  }
  const byReg = new Map();
  for (let i = 0; i < size * size; i++) {
    const g = region[i];
    if (!byReg.has(g)) byReg.set(g, []);
    byReg.get(g).push(i);
  }
  for (const [g, cells] of byReg) gs.push({ kind: 'region', at: g, cells });
  return gs;
}

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

/* 理性玩家：只用三条人也会用的局部规则推到不动点（组内只剩一格=雷 / 组里有雷=其余安全 /
   雷的 8 邻域安全）。推不动的那一刻，就是他掏道具的时刻。 */
function playerFixpoint(size, groups, safe, mine) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groups) {
      let hasMine = false; const unk = [];
      for (const i of g.cells) {
        if (mine.has(i)) hasMine = true;
        else if (!safe.has(i)) unk.push(i);
      }
      if (hasMine) { for (const i of unk) { safe.add(i); changed = true; } }
      else if (unk.length === 1) { mine.add(unk[0]); changed = true; }
    }
    for (const m of Array.from(mine)) {
      for (const nb of neighbors(size, m)) {
        if (!mine.has(nb) && !safe.has(nb)) { safe.add(nb); changed = true; }
      }
    }
  }
}

/* 假设雷在 y，看多快能撞出矛盾（某组既没有雷、又一格不剩）。
   hop 0 = 只做「同组其余安全 + 8 邻域安全」的直接传播；之后每 hop 允许一次限区/夹逼。
   返回 { hops, group } 或 null（这个深度内讲不出矛盾）。 */
function refute(size, region, groups, st0, y) {
  const st = new Uint8Array(st0);
  st[y] = KNOWN_MINE;
  for (const g of groups) {
    if (!g.cells.includes(y)) continue;
    for (const i of g.cells) if (i !== y && st[i] === UNKNOWN) st[i] = KNOWN_SAFE;
  }
  for (const nb of neighbors(size, y)) if (st[nb] === UNKNOWN) st[nb] = KNOWN_SAFE;

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    E.propagateSafe(size, region, st);
    for (const g of groups) {
      let hasMine = false, unk = 0;
      for (const i of g.cells) {
        if (st[i] === KNOWN_MINE) hasMine = true;
        else if (st[i] !== KNOWN_SAFE) unk++;
      }
      if (!hasMine && unk === 0) return { hops: hop, group: g };
    }
    if (hop === MAX_HOPS) break;
    if (!E.confineOnce(size, region, st) && !E.squeezeOnce(size, region, st)) break;
  }
  return null;
}

const rows = [];
for (let lv = 1; lv <= LEVELS; lv++) {
  const spec = Levels.get(lv), size = spec.size, region = spec.board.region;
  const groups = groupsOf(size, region);
  const real = new Set(E.mineIndexes(spec.board));
  const safe = new Set(), mine = new Set();
  const rec = { lv, hints: 0, why: {}, enumHints: 0, cand: 0, refuted: [0, 0, 0], fullyExplained: 0, worstCand: 0 };

  playerFixpoint(size, groups, safe, mine);
  for (let k = 0; k < 40 && mine.size < size; k++) {
    const marks = Array.from(safe);
    const hint = E.clueNext(spec.board, { opened: [], found: Array.from(mine), marks });
    if (!hint) break;
    rec.hints++;
    rec.why[hint.why] = (rec.why[hint.why] || 0) + 1;

    if (hint.why === 'enum' || (hint.pending || []).length) {
      rec.enumHints++;
      /* 玩家视角的当前事实 */
      const st = new Uint8Array(size * size);
      for (const i of safe) if (!real.has(i)) st[i] = KNOWN_SAFE;
      for (const i of mine) st[i] = KNOWN_MINE;
      /* 挑「候选最少」的那一组来讲：候选越少，反证要讲的条数越少 */
      let best = null;
      for (const g of groups) {
        if (!g.cells.includes(hint.idx)) continue;
        let hasMine = false; const unk = [];
        for (const i of g.cells) {
          if (st[i] === KNOWN_MINE) hasMine = true;
          else if (st[i] !== KNOWN_SAFE) unk.push(i);
        }
        if (hasMine) continue;
        if (!best || unk.length < best.unk.length) best = { g, unk };
      }
      if (best) {
        const others = best.unk.filter((i) => i !== hint.idx);
        rec.cand += others.length;
        rec.worstCand = Math.max(rec.worstCand, others.length);
        let all = true;
        for (const y of others) {
          const r = refute(size, region, groups, st, y);
          if (r) rec.refuted[r.hops]++; else all = false;
        }
        if (all) rec.fullyExplained++;
      }
    }
    mine.add(hint.idx);
    safe.delete(hint.idx);
    playerFixpoint(size, groups, safe, mine);
  }
  rec.cleared = mine.size === size;
  rows.push(rec);
}

const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
const hints = sum((r) => r.hints), enumHints = sum((r) => r.enumHints), cand = sum((r) => r.cand);
const ref = [0, 1, 2].map((h) => sum((r) => r.refuted[h]));
const refTotal = ref.reduce((a, b) => a + b, 0);
const why = {};
for (const r of rows) for (const k of Object.keys(r.why)) why[k] = (why[k] || 0) + r.why[k];
const pct = (a, b) => (b ? (a * 100 / b).toFixed(1) + '%' : '-');

console.log(`关卡 1..${LEVELS}，理性玩家卡住时掏道具，共 ${hints} 次提示`);
console.log('理由分布：' + Object.entries(why).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${v}(${pct(v, hints)})`).join(' · '));
console.log(`\n「说不清」的提示（enum 或带 pending）：${enumHints} 次 = ${pct(enumHints, hints)}`);
console.log(`要反证的候选格合计 ${cand} 个，单次最多 ${Math.max(...rows.map((r) => r.worstCand))} 个`);
console.log(`  hop0（只靠同组其余安全 + 邻域安全）：${ref[0]} = ${pct(ref[0], cand)}`);
console.log(`  hop1（再加一次限区/夹逼）        ：${ref[1]} = ${pct(ref[1], cand)}`);
console.log(`  hop2                             ：${ref[2]} = ${pct(ref[2], cand)}`);
console.log(`  ${MAX_HOPS} 跳内可讲清合计       ：${refTotal} = ${pct(refTotal, cand)}`);
console.log(`每一条都讲得清的提示：${sum((r) => r.fullyExplained)} / ${enumHints} = ${pct(sum((r) => r.fullyExplained), enumHints)}`);
console.log(`通关：${rows.filter((r) => r.cleared).length}/${rows.length}`);
