/* mine-lv11-walkthrough.mjs —— 某一关的「人工推理全过程」求解器（2026-08-29，用户点名要第 11 关）

   规则（本作）：每行、每列、每个色块**恰好一颗雷**；雷与雷**不相邻**（含斜角）。
   开局玩家什么都不知道，全盘未知 —— 所以这不是扫雷的「数字提示」，而是一道纯逻辑题。

   人会用的推理，按「越靠前越好讲」的优先级：
     R1 组内只剩一格没排除        → 那一格是雷
     R2 组内已经有雷              → 这组其余格排除
     R3 雷的 8 个邻格             → 排除
     R4 限区(pointing)            → A 组候选全落在 B 组里 ⇒ B 里 A 之外的格排除
     R5 夹逼                      → 某行的雷被挤在窄段，邻行贴住的格排除
     R6 k 组覆盖(k=2/3)           → k 个组的候选正好占满另 k 个组 ⇒ 那 k 组其余格排除
     R7 反证                      → 假设某格是雷，推到矛盾 ⇒ 它不是雷（人也常用，链越短越好讲）

   **实测：第 11 关只用 R1–R6 会在第 2 颗雷处卡死**，必须用 R7 —— 这也正是游戏里
   「找线索」会掉进兜底层的根因。R7 每次都挑**矛盾链最短**的那一格，保证讲解可读。

   跑法：node test/manual/mine-lv11-walkthrough.mjs [关号，默认 11] > /tmp/lv11.json
*/
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../../mine-engine.js');
const Levels = require('../../mine-levels.js');

const LV = Number(process.argv[2] || 11);
const spec = Levels.get(LV), N = spec.size, region = spec.board.region;
const UNKNOWN = 0, SAFE = 1, MINE = 2;
const real = new Set(E.mineIndexes(spec.board));
const rc = (i) => [Math.floor(i / N) + 1, (i % N) + 1];
const cellName = (i) => { const [r, c] = rc(i); return `R${r}C${c}`; };

function buildGroups() {
  const gs = [];
  for (let r = 0; r < N; r++) gs.push({ kind: 'row', at: r, cells: Array.from({ length: N }, (_, c) => r * N + c) });
  for (let c = 0; c < N; c++) gs.push({ kind: 'col', at: c, cells: Array.from({ length: N }, (_, r) => r * N + c) });
  const by = new Map();
  for (let i = 0; i < N * N; i++) { if (!by.has(region[i])) by.set(region[i], []); by.get(region[i]).push(i); }
  for (const [g, cells] of by) gs.push({ kind: 'region', at: g, cells });
  return gs;
}
const GS = buildGroups();
const gName = (g) => g.kind === 'row' ? `第 ${g.at + 1} 行` : g.kind === 'col' ? `第 ${g.at + 1} 列` : `色块 #${g.at}`;

const NB = Array.from({ length: N * N }, (_, i) => {
  const r = Math.floor(i / N), c = i % N, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && cc >= 0 && rr < N && cc < N) out.push(rr * N + cc);
  }
  return out;
});

function info(st, g) {
  let hasMine = false, at = -1; const unk = [];
  for (const i of g.cells) {
    if (st[i] === MINE) { hasMine = true; at = i; }
    else if (st[i] !== SAFE) unk.push(i);
  }
  return { hasMine, at, unk };
}

/* 只用 R1/R2/R3 推到不动点。silent=true 时不记步骤（反证内部试算用）。
   返回 'ok' | 'contradiction:<描述>' */
function basicPropagate(st, log) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of GS) {
      const { hasMine, at, unk } = info(st, g);
      if (!hasMine && unk.length === 0) return { bad: `${gName(g)} 一个格都不剩了，可它必须有一颗雷` };
      if (!hasMine && unk.length === 1) {
        st[unk[0]] = MINE; changed = true;
        if (log) log.push({ t: 'mine', idx: unk[0], why: { rule: 'sole', group: gName(g) } });
        continue;
      }
      if (hasMine && unk.length) {
        for (const i of unk) st[i] = SAFE;
        changed = true;
        if (log) log.push({ t: 'safe', cells: unk, why: { rule: 'group-mine', group: gName(g), at } });
      }
    }
    for (let i = 0; i < N * N; i++) {
      if (st[i] !== MINE) continue;
      const cut = NB[i].filter((n) => st[n] === UNKNOWN);
      if (NB[i].some((n) => st[n] === MINE)) return { bad: `${cellName(i)} 旁边贴着另一颗雷` };
      if (cut.length) {
        for (const n of cut) st[n] = SAFE;
        changed = true;
        if (log) log.push({ t: 'safe', cells: cut, why: { rule: 'touch', at: i } });
      }
    }
  }
  return { bad: null };
}

/* R4/R5/R6：直接用引擎里已过门禁的实现，保证讲解与游戏内提示同源 */
function heavyOnce(st, log) {
  const before = st.slice();
  const cf = E.confineOnce(N, region, st);
  if (cf) {
    if (log) log.push({ t: 'safe', cells: cf.cut, why: { rule: 'confine', from: gName(cf.from), into: gName(cf.into) } });
    return true;
  }
  st.set(before);
  const sq = E.squeezeOnce(N, region, st);
  if (sq) {
    const cut = []; for (let i = 0; i < N * N; i++) if (st[i] === SAFE && before[i] === UNKNOWN) cut.push(i);
    if (log) log.push({ t: 'safe', cells: cut, why: { rule: 'squeeze' } });
    return true;
  }
  st.set(before);
  for (const k of [2, 3]) {
    const cov = E.coverOnce(N, region, st, k);
    if (cov) {
      if (log) log.push({ t: 'safe', cells: cov.cut, why: { rule: 'cover', k,
        from: cov.from.map(gName), into: cov.into.map(gName) } });
      return true;
    }
    st.set(before);
  }
  return false;
}

/* R7 反证：假设 c 是雷，只用 R1/R2/R3 往下推，看会不会撞矛盾。
   返回 { steps, bad } —— steps 是推导过程（用来讲解），bad 是矛盾的那句话。 */
function refute(st0, c) {
  const st = st0.slice(); st[c] = MINE;
  const log = [];
  /* 假设里也要允许 R4/R5/R6：只用最基础三条的话，第 11 关连一个矛盾都撞不出来
     （2026-08-29 实测，第一版就是这么卡死的）。 */
  for (let hop = 0; hop < 40; hop++) {
    const res = basicPropagate(st, log);
    if (res.bad) return { steps: log, bad: res.bad };
    if (!heavyOnce(st, log)) break;
  }
  return null;
}

const st = new Uint8Array(N * N);
const steps = [];
let guard = 0;

while (guard++ < 5000) {
  const mines = []; for (let i = 0; i < N * N; i++) if (st[i] === MINE) mines.push(i);
  if (mines.length === N) break;

  const log = [];
  const r = basicPropagate(st, log);
  if (r.bad) { steps.push({ t: 'error', why: r.bad }); break; }
  if (log.length) { steps.push(...log); continue; }
  if (heavyOnce(st, steps)) continue;

  /* 卡死了 → 反证。挑「矛盾链最短」的那一格讲，人才跟得下来。 */
  let best = null;
  const cands = [];
  for (const g of GS) {
    const { hasMine, unk } = info(st, g);
    if (!hasMine && unk.length >= 2) cands.push({ g, unk });
  }
  cands.sort((a, b) => a.unk.length - b.unk.length);
  for (const { g, unk } of cands) {
    for (const c of unk) {
      const ref = refute(st, c);
      if (ref && (!best || ref.steps.length < best.ref.steps.length)) best = { c, g, ref };
    }
    if (best && best.ref.steps.length <= 3) break;
  }
  if (!best) { steps.push({ t: 'error', why: '连反证都推不动了（这关需要更深的联立）' }); break; }
  st[best.c] = SAFE;
  steps.push({ t: 'safe', cells: [best.c], why: { rule: 'refute', chain: best.ref.steps.length, bad: best.ref.bad,
    group: gName(best.g), detail: best.ref.steps.slice(0, 6).map((s) => s.t === 'mine'
      ? `${cellName(s.idx)} 只能是雷（${s.why.group}）`
      : `${s.why.rule === 'touch' ? `贴着 ${cellName(s.why.at)}` : s.why.group}排掉 ${s.cells.length} 格`) } });
}

const got = []; for (let i = 0; i < N * N; i++) if (st[i] === MINE) got.push(i);
const wrong = got.filter((i) => !real.has(i));
const missing = [...real].filter((i) => !got.includes(i));
const order = steps.filter((s) => s.t === 'mine').map((s, n) => ({ n: n + 1, idx: s.idx, cell: cellName(s.idx), why: s.why }));

console.log(JSON.stringify({
  level: LV, size: N, region: Array.from(region), mines: [...real],
  solved: got.length === N && !wrong.length, wrong, missing,
  totalSteps: steps.length, mineOrder: order,
  steps: steps.map((s) => s.t === 'mine'
    ? { t: 'mine', idx: s.idx, cell: cellName(s.idx), why: s.why }
    : s.t === 'safe' ? { t: 'safe', cells: s.cells, names: s.cells.map(cellName), why: s.why }
    : s),
}, null, 1));
