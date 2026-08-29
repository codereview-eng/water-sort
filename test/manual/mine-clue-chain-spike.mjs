/* mine-clue-chain-spike.mjs —— 「按推理顺序给提示」可行性实测（2026-08-29）

   owner 新口径：「使用道具就是把这个推理过程显示，找线索按这个顺序给用户提示」。
   即道具不再恒指雷，而是给**推理链上的下一步**：可能是「这几格可以排除，因为…」，
   也可能是「这一格是雷」。据此，兜底层（查表给答案）应当整个消失。

   要先证的两件事：
     ① 从玩家真实卡住的状态出发，链上永远存在下一步可讲（不需要查表）；
     ② 需要反证的那些步，矛盾链够短（人跟得下来）。
   注意：早前的 mine-clue-refute-spike 得出「反证只能讲清 30.6%」，那是因为它把
   反证的**内层推理限死在 2 跳**。这里内层放开到完整规则集（基础+限区+夹逼+覆盖），
   再看链长分布 —— 结论完全不同。

   跑法：node test/manual/mine-clue-chain-spike.mjs [关数，默认 40]
*/
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../../mine-engine.js');
const Levels = require('../../mine-levels.js');

const UNKNOWN = 0, SAFE = 1, MINE = 2;
const LEVELS = Number(process.argv[2] || 40);

function buildGroups(N, region) {
  const gs = [];
  for (let r = 0; r < N; r++) gs.push({ kind: 'row', at: r, cells: Array.from({ length: N }, (_, c) => r * N + c) });
  for (let c = 0; c < N; c++) gs.push({ kind: 'col', at: c, cells: Array.from({ length: N }, (_, r) => r * N + c) });
  const by = new Map();
  for (let i = 0; i < N * N; i++) { if (!by.has(region[i])) by.set(region[i], []); by.get(region[i]).push(i); }
  for (const [g, cells] of by) gs.push({ kind: 'region', at: g, cells });
  return gs;
}
const nbOf = (N) => Array.from({ length: N * N }, (_, i) => {
  const r = Math.floor(i / N), c = i % N, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && cc >= 0 && rr < N && cc < N) out.push(rr * N + cc);
  }
  return out;
});

function basicPropagate(N, GS, NB, st) {
  let changed = true, steps = 0;
  while (changed) {
    changed = false;
    for (const g of GS) {
      let hasMine = false; const unk = [];
      for (const i of g.cells) { if (st[i] === MINE) hasMine = true; else if (st[i] !== SAFE) unk.push(i); }
      if (!hasMine && unk.length === 0) return { bad: 'group-empty', steps };
      if (!hasMine && unk.length === 1) { st[unk[0]] = MINE; changed = true; steps++; continue; }
      if (hasMine && unk.length) { for (const i of unk) st[i] = SAFE; changed = true; steps++; }
    }
    for (let i = 0; i < N * N; i++) {
      if (st[i] !== MINE) continue;
      if (NB[i].some((n) => st[n] === MINE)) return { bad: 'adjacent', steps };
      const cut = NB[i].filter((n) => st[n] === UNKNOWN);
      if (cut.length) { for (const n of cut) st[n] = SAFE; changed = true; steps++; }
    }
  }
  return { bad: null, steps };
}
function heavyOnce(N, region, st) {
  const before = st.slice();
  if (E.confineOnce(N, region, st)) return true; st.set(before);
  if (E.squeezeOnce(N, region, st)) return true; st.set(before);
  if (E.coverOnce(N, region, st, 2)) return true; st.set(before);
  if (E.coverOnce(N, region, st, 3)) return true; st.set(before);
  return false;
}
/* 假设 c 是雷，内层放开全部规则往下推，返回矛盾链长度（越短越好讲），推不出矛盾返回 null */
function refute(N, region, GS, NB, st0, c) {
  const st = st0.slice(); st[c] = MINE;
  let total = 0;
  for (let hop = 0; hop < 30; hop++) {
    const r = basicPropagate(N, GS, NB, st);
    total += r.steps;
    if (r.bad) return { chain: total, bad: r.bad };
    if (!heavyOnce(N, region, st)) break;
    total++;
  }
  return null;
}

const chainLen = [];
let stuckPoints = 0, resolvedByRefute = 0, unresolved = 0, worstMs = 0, cleared = 0;

for (let lv = 1; lv <= LEVELS; lv++) {
  const spec = Levels.get(lv), N = spec.size, region = spec.board.region;
  const GS = buildGroups(N, region), NB = nbOf(N);
  const st = new Uint8Array(N * N);
  let guard = 0, mines = 0;

  while (guard++ < 3000) {
    mines = 0; for (let i = 0; i < N * N; i++) if (st[i] === MINE) mines++;
    if (mines === N) break;
    const r = basicPropagate(N, GS, NB, st);
    if (r.bad) break;
    if (r.steps) continue;
    if (heavyOnce(N, region, st)) continue;

    /* 玩家在这里就卡住了 —— 道具该给的正是这一步 */
    stuckPoints++;
    const t0 = Date.now();
    let best = null;
    const cands = [];
    for (const g of GS) {
      let hasMine = false; const unk = [];
      for (const i of g.cells) { if (st[i] === MINE) hasMine = true; else if (st[i] !== SAFE) unk.push(i); }
      if (!hasMine && unk.length >= 2) cands.push({ g, unk });
    }
    cands.sort((a, b) => a.unk.length - b.unk.length);
    outer: for (const { unk } of cands) {
      for (const c of unk) {
        const ref = refute(N, region, GS, NB, st, c);
        if (ref && (!best || ref.chain < best.chain)) best = { c, chain: ref.chain };
        if (best && best.chain <= 3) break outer;
      }
    }
    worstMs = Math.max(worstMs, Date.now() - t0);
    if (!best) { unresolved++; break; }
    resolvedByRefute++;
    chainLen.push(best.chain);
    st[best.c] = SAFE;
  }
  if (mines === N) cleared++;
}

chainLen.sort((a, b) => a - b);
const pct = (a, b) => (b ? (a * 100 / b).toFixed(1) + '%' : '-');
const q = (p) => chainLen.length ? chainLen[Math.min(chainLen.length - 1, Math.floor(chainLen.length * p))] : '-';
console.log(`关卡 1..${LEVELS}：玩家卡住 ${stuckPoints} 次`);
console.log(`  其中反证给得出下一步：${resolvedByRefute} = ${pct(resolvedByRefute, stuckPoints)}`);
console.log(`  连反证都给不出：${unresolved} = ${pct(unresolved, stuckPoints)}　← 只有这些才需要查表兜底`);
console.log(`矛盾链长度：中位 ${q(0.5)}、p90 ${q(0.9)}、最长 ${chainLen[chainLen.length - 1] ?? '-'}`);
console.log(`单次找反证最坏耗时 ${worstMs} ms`);
console.log(`纯按这条链推到通关：${cleared}/${LEVELS}`);
