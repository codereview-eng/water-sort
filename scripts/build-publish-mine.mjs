/* color-mines 发布产物构建（只构建，不发布 —— 发布由用户手工触发）。
   产物形态与线上现状一致：
   - index.html = mine.html 把所有 <script src="./x.js"> 内联进来（线上 index.html 无任何外链 script）
   - 同时把仓库原始文件一并放进 checkpoint 树（线上 /core/platform.js、/mine-engine.js、/game.config.json 均 200）
   fail-closed：内联后仍残留外链 script、或引用了二进制 assets、或 payload 超 1MiB，一律抛错不出产物。
   用法：node scripts/build-publish-mine.mjs  → /tmp/cm-publish-payload.json
   规则：改 core 后默认只发 color-mines，其它游戏需用户特别指定。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2] || '道具云端存档修复：道具改「获得数/消耗数」只增计数（用了一定减少，换设备/重登不复活）；'
  + '同步防抖加最长等待 5s（修首页每秒体力结算把云写无限推迟）；道具按钮 Set→数组修崩溃；云写失败可观测。';

const html = readFileSync(join(ROOT, 'mine.html'), 'utf8');

/* 1) 收集并内联全部外链脚本 */
const srcs = [...html.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map((m) => m[1]);
if (!srcs.length) throw new Error('mine.html 里没找到任何外链脚本，构建假设已失效');
let inlined = html;
for (const src of srcs) {
  const code = readFileSync(join(ROOT, src), 'utf8');
  if (/<\/script>/i.test(code)) throw new Error(`${src} 含 </script>，内联会截断文档`);
  inlined = inlined.replace(`<script src="./${src}"></script>`, `<script>/* ${src} */\n${code}\n</script>`);
}

/* 1.5) 注入构建标记：手机端自检面板会打印它，用来一眼分辨设备拿到的是哪一版（排除缓存/没刷新） */
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
if (!/<html\b/.test(inlined)) throw new Error('找不到 <html> 标签，无法注入构建标记');
inlined = inlined.replace(/<html\b/, `<html data-build="${stamp}"`);

/* 2) fail-closed 校验 */
if (/<script src="\.\//.test(inlined)) throw new Error('内联后仍残留外链 script');
if (/(src|href)="\.?\/?assets\//.test(inlined)) throw new Error('引用了 assets/ 二进制素材，需先内联为 data-URI');

/* 3) checkpoint 文件树：内联入口 + 原始文件（config/schema 提到根，与线上路径一致） */
const files = { 'index.html': inlined };
for (const src of srcs) files[src] = readFileSync(join(ROOT, src), 'utf8');
files['game.config.json'] = readFileSync(join(ROOT, 'games/mine/game.config.json'), 'utf8');
files['schema.json'] = readFileSync(join(ROOT, 'games/mine/schema.json'), 'utf8');

const payload = JSON.stringify({ label, files });
const bytes = Buffer.byteLength(payload);
writeFileSync('/tmp/cm-publish-payload.json', payload);

console.log('内联脚本 ' + srcs.length + ' 个: ' + srcs.join(', '));
console.log('checkpoint 文件 ' + Object.keys(files).length + ' 个');
console.log('index.html ' + (Buffer.byteLength(inlined) / 1024).toFixed(0) + ' KB；payload '
  + (bytes / 1048576).toFixed(3) + ' MiB → /tmp/cm-publish-payload.json');
if (bytes > 1048576) throw new Error('payload 超 1 MiB，需要瘦身');
/* 4) 关键内容自检：新代码确实进了产物 */
const MARKERS = ['StockCore', 'nextSyncDelay', 'tool_mine_spent', 'Array.from(S.found)', 'cheer()',
  'CoinsCore', 'coins_earned', 'homeCoins',
  'LocaleCore.createI18n(CFG.i18n)', 'LocaleCore.resolveLang(', 'applyStaticI18n', 'langName',
  'Stock.reconcile(save, onDisk)',
  'WeeklyCore.create(CFG.weekly)', 'AdPlayCore.create(', 'function watchAdFor', 'core/adplay.js'];
for (const marker of MARKERS) {
  if (!inlined.includes(marker)) throw new Error('产物缺少本次修复标记: ' + marker);
}
console.log('产物自检通过：' + MARKERS.join(' / ') + ' 均在');
