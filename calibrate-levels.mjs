// 关卡标定/体检脚本：跑 BFS 标定固定关的 minMoves，并抽查生成关的可解性与规模。
// 用法: node calibrate-levels.mjs [maxLevel]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('./water-engine.js');
const L = require('./water-levels.js');

const maxLevel = Number(process.argv[2] || 12);

console.log('== 固定关标定（前 ' + L.FIXED_LEVELS.length + ' 关）');
for (let i = 1; i <= L.FIXED_LEVELS.length; i += 1) {
  const lv = L.forLevel(i);
  E.assertInvariants(lv.layout, lv.capacity);
  const t0 = Date.now();
  const r = E.solve(lv.layout, { capacity: lv.capacity });
  console.log(
    `L${i}  颜色=${lv.colors.length} 空管=${lv.empty} 可解=${r.solvable} ` +
    `minMoves=${r.minMoves}（表内 ${lv.minMoves}）visited=${r.visited} ${Date.now() - t0}ms` +
    (r.minMoves === lv.minMoves ? '' : '   <== 需回填')
  );
}

console.log('\n== 生成关抽查（6..' + maxLevel + '）');
for (let i = 6; i <= maxLevel; i += 1) {
  const tGen = Date.now();
  const lv = L.forLevel(i, E.solve);
  const genMs = Date.now() - tGen;
  E.assertInvariants(lv.layout, lv.capacity);
  const t0 = Date.now();
  const r = E.solve(lv.layout, { capacity: lv.capacity, maxVisited: 200000 });
  const filled = lv.layout.filter((t) => t.length).length;
  console.log(
    `L${i}  颜色=${lv.colors.length} 管=${lv.layout.length}(实${filled}) 空=${lv.empty} ` +
    `可解=${r.solvable} minMoves=${r.minMoves} visited=${r.visited} 解算${Date.now() - t0}ms 生成${genMs}ms`
  );
}
