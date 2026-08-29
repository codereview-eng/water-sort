/* mine-clue-cover-spike.mjs —— 「k 组覆盖」上线前后的收益与安全性实测（2026-08-29）

   起因（用户实报，第 11 关截图）：线索条说「这一步要联立 —— 这一格确实是雷，但要跨行列一起看
   才推得出来」，玩家原话「无端端就给出了最终答案，不理解」。那一条走的是 clueNext 的兜底层
   why='enum'：它直接读真雷表挑一颗，**结构上就没有理由可讲**。

   两条路都量过：
   · 反证讲解（假设雷在这→撞矛盾）：test/manual/mine-clue-refute-spike.mjs 实测 2 跳内只讲得清
     30.6% 的候选、只有 11.9% 的提示能完整讲明白 —— 讲深了等于换个姿势给答案，否掉。
   · k 组覆盖（Star Battle set counting / 数独 hidden pair 同构）：本脚本，采用。

   本脚本跑的是**引擎现状**（coverOnce 已在 clueNext 的第 ④b 层），报三件事：
     ① 理由分布与兜底层 enum 占比（对比基线 36.9%）
     ② 安全性：coverOnce 单独跑在随机事实上，绝不许把真雷判成安全（不可逆的错）
     ③ 单次提示最坏耗时（道具是点一下就要出结果的，不能卡手）

   跑法：node test/manual/mine-clue-cover-spike.mjs [关数，默认 40]
*/
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
/* ENGINE=/tmp/xxx.js 可换一份引擎跑同一套指标 —— 用来做 A/B 对照
   （例：把 pickSole 换成「扫到的第一个」，复现旧的按行列挑雷口径） */
const E = require(process.env.ENGINE || '../../mine-engine.js');
const Levels = require('../../mine-levels.js');

const UNKNOWN = 0, KNOWN_SAFE = 1, KNOWN_MINE = 2;
const LEVELS = Number(process.argv[2] || 40);

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
    if (!byReg.has(region[i])) byReg.set(region[i], []);
    byReg.get(region[i]).push(i);
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

/* 理性玩家：只用三条肉眼规则推到不动点；推不动的那一刻就是他掏道具的时刻 */
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

const why = {};
/* 结论落在哪种组上：**扫描顺序是「先所有行、再所有列、最后色块」**，
   所以「行占压倒多数」正是「按行列挑下一颗雷」的指纹（用户 2026-08-29 实报的正是这个）。
   改成按讲解成本挑之后，这个分布应当明显散开。 */
const kind = {};
let hints = 0, cleared = 0, worstMs = 0, coverSteps = 0, worstCut = 0, steps = 0, pend = 0;

for (let lv = 1; lv <= LEVELS; lv++) {
  const spec = Levels.get(lv), size = spec.size, region = spec.board.region;
  const groups = groupsOf(size, region);
  const safe = new Set(), mine = new Set();
  playerFixpoint(size, groups, safe, mine);

  for (let k = 0; k < 40 && mine.size < size; k++) {
    const t0 = Date.now();
    const hint = E.clueNext(spec.board, { opened: [], found: Array.from(mine), marks: Array.from(safe) });
    worstMs = Math.max(worstMs, Date.now() - t0);
    if (!hint) break;
    hints++;
    why[hint.why] = (why[hint.why] || 0) + 1;
    kind[(hint.group && hint.group.kind) || 'none'] = (kind[(hint.group && hint.group.kind) || 'none'] || 0) + 1;
    steps += (hint.ruled || []).length;
    pend += (hint.pending || []).length;
    for (const r of hint.ruled || []) if (r.rule === 'cover') { coverSteps++; worstCut = Math.max(worstCut, r.cells.length); }
    mine.add(hint.idx);
    safe.delete(hint.idx);
    playerFixpoint(size, groups, safe, mine);
  }
  if (mine.size === size) cleared++;
}

/* ② 安全性：coverOnce 在随机事实上单独跑，真雷绝不许被判安全 */
let violations = 0, coverHits = 0;
for (const lv of [2, 5, 8, 11, 14, 20, 28, 33, 37, 40]) {
  const spec = Levels.get(lv), size = spec.size, region = spec.board.region;
  const real = new Set(E.mineIndexes(spec.board));
  const rand = E.rng(lv * 7919);
  for (let t = 0; t < 12; t++) {
    const st = new Uint8Array(size * size);
    for (const m of real) if (rand() < 0.35) st[m] = KNOWN_MINE;
    for (let i = 0; i < size * size; i++) if (!real.has(i) && rand() < 0.2) st[i] = KNOWN_SAFE;
    E.propagateSafe(size, region, st);
    for (let hop = 0; hop < 8; hop++) {
      const cov = E.coverOnce(size, region, st, 2) || E.coverOnce(size, region, st, 3);
      if (!cov) break;
      coverHits++;
      for (const c of cov.cut) if (real.has(c)) violations++;
      E.propagateSafe(size, region, st);
    }
    for (let i = 0; i < size * size; i++) if (st[i] === KNOWN_SAFE && real.has(i)) { violations++; break; }
  }
}

const pct = (a, b) => (b ? (a * 100 / b).toFixed(1) + '%' : '-');
console.log(`关卡 1..${LEVELS}：共 ${hints} 次提示`);
console.log('理由分布：' + Object.entries(why).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${v}(${pct(v, hints)})`).join(' · '));
console.log(`兜底层 enum：${why.enum || 0} = ${pct(why.enum || 0, hints)}（改造前基线 36.9%）`);
console.log('结论落在哪种组：' + Object.entries(kind).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${v}(${pct(v, hints)})`).join(' · ') + '　← 行一家独大 = 还在按行列挑');
console.log(`平均讲解 ${(steps / hints).toFixed(2)} 步、平均遗留讲不清的格 ${(pend / hints).toFixed(2)} 个（越小越好懂）`);
console.log(`讲解里出现 k 组覆盖的步骤：${coverSteps} 条，单条最多排掉 ${worstCut} 格`);
console.log(`安全性：coverOnce 命中 ${coverHits} 次，把真雷判成安全 ${violations} 次（必须为 0）`);
console.log(`单次提示最坏耗时：${worstMs} ms`);
console.log(`通关：${cleared}/${LEVELS}`);
