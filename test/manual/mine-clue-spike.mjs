/* mine-clue-spike.mjs —— 「找线索」道具收益 Spike（2026-08-27）
   问题（用户实报）：道具反复弹「这一格肯定不是雷」，指的还是同一行/同一列/雷旁边，
   而且玩家早就 ✕ 掉了的格子还在被反复提示 —— 道具基本没用。

   这个 spike 不看文案，只看「玩家能不能因此多标出一颗雷」。做法：
   ① 建一个理性玩家模型（跟人一样只会那三条局部规则：组内只剩一格=雷 / 组里有雷=其余安全 /
      雷的 8 邻域安全），推到不动点；推出雷就双击点掉（游戏里只有点雷才算进度）。
   ② 推不动 = 卡住 —— 这正是玩家掏道具的时刻。此时调道具，记四件事：
      · 冗余：提示的格子玩家早就知道（已 ✕ 或已挖出）
      · 重复：这一局里同一格被提示过第二次
      · 解卡：吃下这条提示后，玩家能不能立刻多标出至少一颗雷
      · 推进：吃下这条提示后新增的已标雷数（含提示格本身）
   ③ 跑真实关卡表（MineLevels），三种玩家画像各跑一遍：
      diligent 全部 ✕ 都记下来 / lazy 只记一半 / sloppy 全记但有一个 ✕ 打在真雷上。

   用法：node test/manual/mine-clue-spike.mjs [关卡数] [old|new|both] */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const MineEngine = require('../../mine-engine.js');
const MineLevels = require('../../mine-levels.js');

const LEVELS = Number(process.argv[2] || 40);
const WHICH = String(process.argv[3] || 'both');
const MAX_HINTS = 60;

const PROFILES = [
  { id: 'diligent', p: 1, wrong: 0, desc: '推出来的安全格全部 ✕ 记下' },
  { id: 'lazy', p: 0.5, wrong: 0, desc: '只 ✕ 记一半' },
  { id: 'sloppy', p: 1, wrong: 1, desc: '全记，但有一个 ✕ 打在真雷上' },
];

function neighbors(size, idx) {
  const r = Math.floor(idx / size), c = idx % size, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
    out.push(rr * size + cc);
  }
  return out;
}

/* 理性玩家的推理：只用三条人也会用的局部规则，推到不动点。
   safe = 他心里排掉的格；mine = 他已经双击点出来的雷（= 游戏里的 S.found）。 */
function propagate(size, groups, safe, mine) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groups) {
      let hasMine = false; const unk = [];
      for (const i of g.cells) {
        if (mine.has(i)) hasMine = true;
        else if (!safe.has(i)) unk.push(i);
      }
      if (hasMine) {
        for (const i of unk) { safe.add(i); changed = true; }
      } else if (unk.length === 1) {
        mine.add(unk[0]); changed = true;
      }
    }
    for (const m of Array.from(mine)) {
      for (const nb of neighbors(size, m)) {
        if (!mine.has(nb) && !safe.has(nb)) { safe.add(nb); changed = true; }
      }
    }
  }
}

function trueMines(board) {
  const s = new Set();
  board.mines.forEach((c, r) => s.add(r * board.size + c));
  return s;
}

/* 道具适配层：old = 线上现状（只喂 opened/found，marks 被当猜测整个丢掉）
                new = v2（喂 opened/found/marks，且每条提示都指向可标雷的落点） */
function callTool(kind, board, st) {
  const opened = Array.from(st.opened);
  const found = Array.from(st.mine);
  if (kind === 'old') return MineEngine.hintNext(board, opened, found);
  return MineEngine.clueNext(board, { opened, found, marks: Array.from(st.marks) });
}

function runGame(kind, lv, profile) {
  const data = MineLevels.get(lv);
  if (!data) return null;
  const board = data.board, size = board.size;
  const groups = MineEngine.hintGroups(size, board.region);
  const real = trueMines(board);
  const rnd = MineEngine.rng((lv * 2654435761) >>> 0);
  const st = { safe: new Set(), mine: new Set(), opened: new Set(), marks: new Set(), hinted: new Set() };
  const rec = { lv, size, hints: 0, redundant: 0, repeat: 0, unblocked: 0, mines: 0,
                kindMine: 0, wrongFact: 0, cleared: false, depth: {}, why: {} };

  /* 玩家把心里排掉的格子写成 ✕（lazy 只写一半——道具看到的事实因此是不完整的） */
  const writeMarks = () => {
    for (const i of st.safe) if (!st.marks.has(i) && rnd() < profile.p) st.marks.add(i);
  };

  propagate(size, groups, st.safe, st.mine);   // 开局自推（通常一步都推不动）
  writeMarks();
  /* sloppy：一个打在真雷上的 ✕ —— 这种错误信念会把玩家后面的推理全带偏 */
  if (profile.wrong) {
    const m = Array.from(real).find((i) => !st.mine.has(i) && !st.marks.has(i));
    if (m !== undefined) st.marks.add(m);
  }

  while (st.mine.size < size && rec.hints < MAX_HINTS) {
    const hint = callTool(kind, board, st);
    if (!hint) break;
    rec.hints++;
    const idx = hint.idx;
    if (hint.kind === 'mine') rec.kindMine++;
    if (st.safe.has(idx) || st.mine.has(idx) || (hint.kind === 'safe' && st.marks.has(idx))) rec.redundant++;
    if (st.hinted.has(idx)) rec.repeat++;
    st.hinted.add(idx);
    rec.depth[hint.depth] = (rec.depth[hint.depth] || 0) + 1;
    rec.why[hint.why] = (rec.why[hint.why] || 0) + 1;
    if (hint.kind === 'mine' ? !real.has(idx) : real.has(idx)) rec.wrongFact++;

    const before = st.mine.size;
    /* 玩家照着提示落子：指雷就双击点掉（并撤掉打错的 ✕），指安全就 ✕ 掉 */
    if (hint.kind === 'mine') { st.mine.add(idx); st.marks.delete(idx); st.safe.delete(idx); }
    else { st.safe.add(idx); st.marks.add(idx); }
    propagate(size, groups, st.safe, st.mine);
    writeMarks();
    const delta = st.mine.size - before;
    if (delta > 0) rec.unblocked++;
    rec.mines += delta;
  }
  rec.cleared = st.mine.size === size;
  return rec;
}

function pct(a, b) { return b ? (a * 100 / b).toFixed(1) + '%' : '-'; }

function tally(rows, field) {
  const acc = {};
  for (const r of rows) for (const k of Object.keys(r[field])) acc[k] = (acc[k] || 0) + r[field][k];
  return acc;
}

function summarize(kind, profile, rows) {
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const hints = sum(r => r.hints);
  const d = tally(rows, 'depth');
  return {
    道具: kind === 'old' ? 'v1(线上)' : 'v2(新)',
    玩家: profile.id,
    关卡数: rows.length,
    通关: rows.filter(r => r.cleared).length,
    道具次数: hints,
    冗余率: pct(sum(r => r.redundant), hints),
    重复率: pct(sum(r => r.repeat), hints),
    解卡率: pct(sum(r => r.unblocked), hints),
    每次带来可标雷: hints ? (sum(r => r.mines) / hints).toFixed(2) : '-',
    指雷占比: pct(sum(r => r.kindMine), hints),
    错误结论: sum(r => r.wrongFact),
    '理由 自验/顺推/限区/联立': [d.local || 0, d.chain || 0, d.confine || 0, d.deep || 0].join('/'),
  };
}

const out = [];
for (const kind of (WHICH === 'both' ? ['old', 'new'] : [WHICH])) {
  if (kind === 'new' && typeof MineEngine.clueNext !== 'function') {
    console.log('[skip] v2: MineEngine.clueNext 还没实现');
    continue;
  }
  for (const profile of PROFILES) {
    const rows = [];
    for (let lv = 1; lv <= LEVELS; lv++) {
      const r = runGame(kind, lv, profile);
      if (r) rows.push(r);
    }
    out.push(summarize(kind, profile, rows));
  }
}
console.table(out);
console.log('\n判据：解卡率＝这次提示之后玩家能不能立刻多标出至少一颗雷；错误结论必须恒为 0。');
