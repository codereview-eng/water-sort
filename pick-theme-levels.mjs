// 主题关卡挑选器 v2 —— 为第 6-30 关批量挑「不开瓶也必须可解」的盘面。
// 用法: node pick-theme-levels.mjs [章节名...]   不传则全部跑(basic/tight/crowd/master)
//
// v1 RCA(2026-08-07): crowd/master(7-8 色)跑数小时零产出——
//   7-8 色 + 多空管的 BFS 状态空间远超 maxVisited=400000,构造上必可解的盘面
//   被「预算耗尽」误判为不可解;加上 want 步数带是硬门,若该色数下真实 minMoves
//   分布压根不进带,4 万 seed 的扫描就变成无限空转,且 tail 缓冲让进度完全不可见。
// v2 对策:
//   1. 色数封顶 6(实测 BFS 百 ms 级),难度改由锁瓶数/空管数/步数带推进;
//   2. want 带降级为「带内优先」:带内即收,扫满预算后取 minMoves 最接近带的
//      合格候选(硬门与 gap 仍是硬条件)——永远终止,绝不空手;
//   3. 每 25 个 seed 向 stderr 打一行心跳,日志实时可观测;
//   4. 每关独立 seed 区间(level*100000 起),不同关不再撞同一盘(v1 第 6/7 关重复)。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('./water-engine.js');
const L = require('./water-levels.js');

// want: 开瓶后(全部空管可用)的最少步数目标区间,控制难度爬坡
// gap:  不开瓶比开瓶起码多走几步——保证「开瓶确实有价值」,否则广告位形同虚设
// empty 含锁定空管;locks 取盘面末尾的空管整根锁掉(与固定关 L1-5 同构)
const CHAPTERS = [
  { key: 'basic',  level: 6,  colors: 4, empty: 2, locks: 1, want: [12, 15], gap: 0 },
  { key: 'basic',  level: 7,  colors: 4, empty: 2, locks: 1, want: [14, 17], gap: 0 },
  { key: 'basic',  level: 8,  colors: 5, empty: 2, locks: 1, want: [15, 18], gap: 0 },
  { key: 'basic',  level: 9,  colors: 5, empty: 2, locks: 1, want: [17, 20], gap: 1 },
  { key: 'basic',  level: 10, colors: 5, empty: 2, locks: 1, want: [18, 21], gap: 1 },
  { key: 'tight',  level: 11, colors: 5, empty: 3, locks: 2, want: [16, 20], gap: 1 },
  { key: 'tight',  level: 12, colors: 5, empty: 3, locks: 2, want: [18, 22], gap: 1 },
  { key: 'tight',  level: 13, colors: 6, empty: 3, locks: 1, want: [19, 23], gap: 1 },
  // L14 实测(2026-08-07): 6 色 + 锁 1 空管、want 21-25 带,扫满 500 盘无一同时过
  // 「硬门 + gap≥1」——该参数点上硬解与开瓶解步差普遍为 0。gap 降为 0:硬门(锁后可解)
  // 不变,开瓶价值由产出的 minMovesLocked - minMoves 观测,与 crowd/master 的教训同源。
  { key: 'tight',  level: 14, colors: 6, empty: 3, locks: 1, want: [21, 25], gap: 0 },
  { key: 'tight',  level: 15, colors: 6, empty: 3, locks: 2, want: [22, 26], gap: 1 },
  { key: 'crowd',  level: 16, colors: 6, empty: 3, locks: 2, want: [22, 26], gap: 1 },
  { key: 'crowd',  level: 17, colors: 6, empty: 3, locks: 2, want: [23, 27], gap: 1 },
  { key: 'crowd',  level: 18, colors: 6, empty: 3, locks: 2, want: [24, 28], gap: 1 },
  // gap 实测(2026-08-07): 6 色段 gap≥2 会把候选筛成 0——master L23 扫满 500 盘
  // 无一同时过「硬门 + gap≥2」(硬解与开瓶解的步差分布基本只有 0-1)。
  // 一律降为 1;「开瓶确实有价值」由产出的 minMovesLocked - minMoves 观测,不再加码硬门。
  { key: 'crowd',  level: 19, colors: 6, empty: 4, locks: 3, want: [24, 28], gap: 1 },
  { key: 'crowd',  level: 20, colors: 6, empty: 4, locks: 3, want: [25, 29], gap: 1 },
  { key: 'crowd',  level: 21, colors: 6, empty: 4, locks: 3, want: [25, 30], gap: 1 },
  { key: 'crowd',  level: 22, colors: 6, empty: 4, locks: 3, want: [26, 30], gap: 1 },
  { key: 'master', level: 23, colors: 6, empty: 3, locks: 2, want: [25, 30], gap: 1 },
  { key: 'master', level: 24, colors: 6, empty: 3, locks: 2, want: [26, 31], gap: 1 },
  { key: 'master', level: 25, colors: 6, empty: 4, locks: 3, want: [26, 32], gap: 1 },
  { key: 'master', level: 26, colors: 6, empty: 4, locks: 3, want: [27, 32], gap: 1 },
  { key: 'master', level: 27, colors: 6, empty: 4, locks: 3, want: [27, 33], gap: 1 },
  { key: 'master', level: 28, colors: 6, empty: 4, locks: 3, want: [28, 34], gap: 1 },
  { key: 'master', level: 29, colors: 6, empty: 4, locks: 3, want: [28, 34], gap: 1 },
  { key: 'master', level: 30, colors: 6, empty: 4, locks: 3, want: [29, 35], gap: 1 },
];

// 6 色 + ≤4 空管的可解盘 BFS 通常远小于此;不可解分支(尤其锁后仅 1 空管)状态空间
// 天然更小,会在预算内穷尽——这个上限只是极端盘面的保险丝,不再是常态瓶颈。
const MAX_VISITED = 900000;
const SEED_BUDGET = 500; // 每关最多认真评估的盘面数(带内即提前收工)

const only = process.argv.slice(2);
// 支持章节名或关号(如 `node pick-theme-levels.mjs 19 22`),便于对个别未找到的关重跑
const chapters = only.length
  ? CHAPTERS.filter((c) => only.includes(c.key) || only.includes(String(c.level)))
  : CHAPTERS;
if (!chapters.length) {
  console.error(`未知章节: ${only.join(' ')} (可选: basic tight crowd master)`);
  process.exit(1);
}

for (const tg of chapters) {
  const t0 = Date.now();
  const seedBase = tg.level * 100000;
  let scanned = 0;
  let best = null; // { seed, state, locked, open, hard, dist }
  for (let k = 1; k <= SEED_BUDGET; k += 1) {
    const seed = seedBase + k;
    const state = L.buildLayout(tg.colors, tg.empty, seed, L.CAPACITY);
    if (!state) continue;
    scanned += 1;
    if (scanned % 25 === 0) {
      console.error(`.. L${tg.level} ${tg.key} 已扫 ${scanned} 盘 / ${Date.now() - t0}ms / 当前最优 ${best ? `minMoves=${best.open.minMoves} dist=${best.dist}` : '无'}`);
    }
    const locked = [];
    for (let i = state.length - 1; i >= 0 && locked.length < tg.locks; i -= 1) locked.push(i);
    locked.reverse();
    const playable = state.filter((_, i) => !locked.includes(i));
    // 硬门先行(v2.1 提速): 锁后仅剩 1-2 根空管,分支因子小、BFS 便宜,绝大多数
    // seed 在这里被廉价拒掉;而 6 色 + 3-4 空管的 open 解是每盘 6-8s 的大头,
    // 只对幸存者算。硬解存在 ⇒ 开瓶解必存在(资源只多不少),open 只为标定 minMoves。
    // 硬门本身不降级: 拿掉锁定空管后必须仍可解——广告开瓶只是降难度,不是通关必需。
    const hard = E.solve(playable, { capacity: L.CAPACITY, maxVisited: MAX_VISITED });
    if (!hard || !hard.solvable) continue;
    const open = E.solve(state, { capacity: L.CAPACITY, maxVisited: MAX_VISITED });
    if (!open || !open.solvable) continue;
    if (hard.minMoves - open.minMoves < tg.gap) continue;
    const dist = open.minMoves < tg.want[0]
      ? tg.want[0] - open.minMoves
      : open.minMoves > tg.want[1] ? open.minMoves - tg.want[1] : 0;
    if (!best || dist < best.dist || (dist === best.dist && open.minMoves > best.open.minMoves)) {
      best = { seed, state, locked, open, hard, dist };
    }
    if (dist === 0) break; // 带内即收
  }
  if (!best) {
    console.log(`    // 第 ${tg.level} 关 ${tg.key} 未找到合格盘面(扫 ${scanned} 盘 / ${Date.now() - t0}ms)——需放宽 locks/gap`);
    continue;
  }
  console.log(`    { // 第 ${tg.level} 关 · ${tg.key} · ${tg.colors} 色 ${tg.empty} 空管 · 锁 ${best.locked.join(',')} · seed ${best.seed}${best.dist ? ` · 离带 ${best.dist} 步` : ''}`);
  console.log(`      theme: '${tg.key}', colors: ${tg.colors}, empty: ${tg.empty},`);
  console.log(`      minMoves: ${best.open.minMoves}, minMovesLocked: ${best.hard.minMoves}, lockedBottleIndexes: [${best.locked.join(', ')}],`);
  console.log('      layout: [');
  for (const tube of best.state) console.log(`        [${tube.map((c) => `'${c}'`).join(', ')}],`);
  console.log('      ],');
  console.log(`    },   // 扫 ${scanned} 个盘面 / ${Date.now() - t0}ms`);
}
