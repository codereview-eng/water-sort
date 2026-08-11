// merge-theme-levels.mjs — 把 pick-theme-levels v2 的产出(/tmp/pick2-*.log)
// 合并进 water-levels.js 的 FIXED_LEVELS 尾部。
// 设计:
//   - 只认日志里 `    { // 第 N 关` 到 `    },` 的完整盘面块,心跳(.. 开头)自然被跳过;
//   - 第 6-30 关必须齐全且不重复,缺关/撞关直接报错退出,绝不写半套数据;
//   - 幂等: water-levels.js 里已出现 theme 字段就拒绝二次合并;
//   - 写入后请跑 `node -e "require('./water-levels.js')"` + 测试做真实验证。
import fs from 'node:fs';

const CHAPTERS = ['basic', 'tight', 'crowd', 'master'];
const blocks = [];
for (const key of CHAPTERS) {
  const file = `/tmp/pick2-${key}.log`;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let cur = null;
  for (const ln of lines) {
    const head = ln.match(/^    \{ \/\/ 第 (\d+) 关/);
    if (head) { cur = { level: Number(head[1]), lines: [ln] }; continue; }
    if (!cur) continue;
    cur.lines.push(ln);
    if (/^    \},/.test(ln)) { blocks.push(cur); cur = null; }
  }
}
blocks.sort((a, b) => a.level - b.level);
const levels = blocks.map((b) => b.level);
const want = Array.from({ length: 25 }, (_, i) => i + 6);
const missing = want.filter((l) => !levels.includes(l));
const dup = levels.filter((l, i) => levels.indexOf(l) !== i);
if (missing.length || dup.length) {
  console.error(`拒绝合并 —— 缺关: [${missing.join(', ')}] 重复: [${dup.join(', ')}]`);
  process.exit(1);
}

const SRC = 'water-levels.js';
const src = fs.readFileSync(SRC, 'utf8');
if (src.includes("theme: '")) {
  console.error('water-levels.js 已含主题关(theme 字段),拒绝重复合并');
  process.exit(1);
}
const anchor = src.indexOf('const FIXED_LEVELS = [');
if (anchor < 0) { console.error('未找到 FIXED_LEVELS 起点'); process.exit(1); }
let depth = 0;
let end = -1;
for (let i = src.indexOf('[', anchor); i < src.length; i += 1) {
  if (src[i] === '[') depth += 1;
  else if (src[i] === ']') { depth -= 1; if (depth === 0) { end = i; break; } }
}
if (end < 0) { console.error('未找到 FIXED_LEVELS 收尾'); process.exit(1); }
const insert = `${blocks.map((b) => b.lines.join('\n')).join('\n')}\n`;
fs.writeFileSync(SRC, src.slice(0, end) + insert + src.slice(end));
console.log(`已写入 ${blocks.length} 关 (L${levels[0]}-L${levels[levels.length - 1]}) 到 ${SRC}`);
