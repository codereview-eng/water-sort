// 为前 5 关挑固定盘面：整齐盘面（非空管根根装满）+ BFS 标定 minMoves 落在目标区间。
// 输出可直接回填 water-levels.js 的 FIXED_LEVELS 片段。用法: node pick-fixed-levels.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('./water-engine.js');
const L = require('./water-levels.js');

// 教学爬坡：minMoves 单调递增
const TARGETS = [
  { level: 1, colors: 3, empty: 2, want: [4, 5], shuffle: 12 },
  { level: 2, colors: 3, empty: 2, want: [6, 8], shuffle: 20 },
  { level: 3, colors: 4, empty: 2, want: [9, 11], shuffle: 30 },
  { level: 4, colors: 4, empty: 2, want: [12, 14], shuffle: 45 },
  { level: 5, colors: 5, empty: 2, want: [15, 18], shuffle: 60 },
];

const fmt = (t) => '[' + t.map((c) => `'${c}'`).join(', ') + ']';

for (const tg of TARGETS) {
  let found = null;
  for (let seed = 1; seed <= 6000 && !found; seed += 1) {
    const state = L.buildLayout(tg.colors, tg.empty, seed, L.CAPACITY);
    if (!state) continue;
    E.assertInvariants(state, L.CAPACITY);
    const r = E.solve(state, { capacity: L.CAPACITY, maxVisited: 150000 });
    if (r.solvable && r.minMoves >= tg.want[0] && r.minMoves <= tg.want[1]) {
      found = { seed, minMoves: r.minMoves, state };
    }
  }
  if (!found) { console.log(`// L${tg.level}: 未找到符合 ${tg.want} 的整齐盘面`); continue; }
  console.log(`    { // 第 ${tg.level} 关 · ${tg.colors} 色 ${tg.empty} 空管 · seed ${found.seed}`);
  console.log(`      colors: ${tg.colors}, empty: ${tg.empty}, minMoves: ${found.minMoves},`);
  console.log('      layout: [');
  for (const t of found.state) console.log('        ' + fmt(t) + ',');
  console.log('      ],');
  console.log('    },');
}
