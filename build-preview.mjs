// 把 water.html 的外部依赖（js + Blender 渲染的 png 素材）全部内联，产出单文件预览页。
// 素材必须内联：分享出去的单文件页没有 assets 目录，相对路径会 404，试管会变回空白。
// 用法: node build-preview.mjs [输出路径]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const out = process.argv[2] || '/tmp/water-sort-preview.html';
let html = readFileSync('water.html', 'utf8');

for (const f of ['water-engine.js', 'water-levels.js']) {
  const tag = `<script src="./${f}"></script>`;
  if (!html.includes(tag)) throw new Error(`未找到 script 引用: ${tag}`);
  html = html.replace(tag, `<script>\n/* inlined ${f} */\n${readFileSync(f, 'utf8')}\n</script>`);
}

let inlined = 0;
for (const png of readdirSync('assets/tubes').filter((f) => f.endsWith('.png'))) {
  const ref = `./assets/tubes/${png}`;
  if (!html.includes(ref)) continue;
  const uri = 'data:image/png;base64,' + readFileSync(`assets/tubes/${png}`).toString('base64');
  html = html.split(ref).join(uri);
  inlined += 1;
}
if (html.includes('./assets/')) throw new Error('还有没内联的素材引用');

writeFileSync(out, html);
console.log(`preview -> ${out} (${(html.length / 1024).toFixed(0)} KiB, 内联 ${inlined} 张素材)`);
