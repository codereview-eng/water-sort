// 把 water.html 的外部 script 内联，产出单文件预览页（分享/评审用）
// 用法: node build-preview.mjs [输出路径]
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] || '/tmp/water-sort-preview.html';
let html = readFileSync('water.html', 'utf8');

for (const f of ['water-engine.js', 'water-levels.js']) {
  const tag = `<script src="./${f}"></script>`;
  if (!html.includes(tag)) throw new Error(`未找到 script 引用: ${tag}`);
  html = html.replace(tag, `<script>\n/* inlined ${f} */\n${readFileSync(f, 'utf8')}\n</script>`);
}

writeFileSync(out, html);
console.log(`preview -> ${out} (${html.length} bytes)`);
