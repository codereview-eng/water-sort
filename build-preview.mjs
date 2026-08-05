// 把 water.html 打成「单文件预览页」：所有本地脚本与 Blender 素材一律内联。
//
// 为什么要 fail-closed 检查：单文件页发出去之后没有同级目录，任何残留的 ./xxx 都会 404。
// 曾经这里写死只内联两个 js，后来新增的 water-audio.js 与项目自带 tg-web-app.js 漏掉，
// 线上预览直接 ReferenceError、关卡进不去。所以改成「自动扫描 + 收尾断言零残留」。
//
// 用法: node build-preview.mjs [输出路径]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const out = process.argv[2] || '/tmp/water-sort-preview.html';
let html = readFileSync('water.html', 'utf8');

// 1) 内联所有本地 <script src="./xxx.js">（远程 CDN 的保持原样）
let scripts = 0;
html = html.replace(/<script src="\.\/([^"]+)"[^>]*><\/script>/g, (tag, file) => {
  if (!existsSync(file)) {
    console.warn(`[warn] 本地脚本不存在，保留原标签: ${file}`);
    return tag;
  }
  scripts += 1;
  return `<script>\n/* inlined ${file} */\n${readFileSync(file, 'utf8')}\n</script>`;
});

// 2) 内联所有被引用到的素材（CSS url() 与 JS 字符串里都算）
let assets = 0;
for (const m of new Set([...html.matchAll(/\.\/assets\/[A-Za-z0-9_\-/.]+\.(?:png|jpg|webp)/g)].map((x) => x[0]))) {
  const file = m.replace('./', '');
  if (!existsSync(file)) throw new Error(`引用了不存在的素材: ${m}`);
  const ext = file.endsWith('.png') ? 'png' : file.endsWith('.webp') ? 'webp' : 'jpeg';
  html = html.split(m).join(`data:image/${ext};base64,` + readFileSync(file).toString('base64'));
  assets += 1;
}

// 3) fail-closed：产物里不允许再有任何本地相对引用
const leftovers = [
  ...[...html.matchAll(/(?:src|href)="\.\/[^"]*"/g)].map((x) => x[0]),
  ...[...html.matchAll(/url\((["']?)\.\/[^)]*\)/g)].map((x) => x[0]),
  ...[...html.matchAll(/'\.\/[^']*'/g)].map((x) => x[0]),
];
if (leftovers.length) {
  throw new Error('单文件预览仍有本地相对引用，发出去必然 404:\n  ' + [...new Set(leftovers)].join('\n  '));
}

writeFileSync(out, html);
console.log(`preview -> ${out} (${(html.length / 1024).toFixed(0)} KiB, 内联脚本 ${scripts} 个 / 素材 ${assets} 张)`);
