/* color-mines 发布产物构建（只构建，不发布 —— 发布由用户手工触发）。
   产物形态与线上现状一致：
   - index.html = mine.html 把所有 <script src="./x.js"> 内联进来（线上 index.html 无任何外链 script）
   - 同时把仓库原始文件一并放进 checkpoint 树（线上 /core/platform.js、/mine-engine.js、/game.config.json 均 200）
   - 广场封面与卡片文案：产物根带 cover.webp（16:9）+ game.meta.json（title/tagline）。
     网关 /templates/covers/play/<slug>.webp 是 live-first：产物根有 cover.webp 就随发布即翻新，
     没有则退回平台自动截图（那张 720×450 的开局盘）。JSON payload 是 utf8 文本 map，
     装不下二进制 —— 封面只能走目录产物 /tmp/cm-publish-dist。
   fail-closed：内联后仍残留外链 script、或引用了二进制 assets、或 payload 超 1MiB、
     或封面缺席/超 300KiB/非 16:9/非 WebP、或 meta 超网关上限，一律抛错不出产物。
   用法：node scripts/build-publish-mine.mjs
     → /tmp/cm-publish-dist（目录产物，publish_game 用这个）
     → /tmp/cm-publish-payload.json（文本 payload，旧通道兼容；不含封面）
   规则：改 core 后默认只发 color-mines，其它游戏需用户特别指定。 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
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
const MARKERS = ['StockCore', 'err.retryable && !hooks.__retried', 'tool_mine_spent', 'Array.from(S.found)', 'cheer()',
  'CoinsCore', 'coins_earned', 'homeCoins',
  'LocaleCore.createI18n(CFG.i18n)', 'LocaleCore.resolveLang(', 'applyStaticI18n', 'langName',
  'Stock.reconcile(save, onDisk)',
  'WeeklyCore.create(CFG.weekly)', 'AdPlayCore.create(', 'function watchAdFor', 'core/adplay.js',
  'WinStreakCore.create(CFG.winstreak', 'streak-keep', 'streak-claim'];
for (const marker of MARKERS) {
  if (!inlined.includes(marker)) throw new Error('产物缺少本次修复标记: ' + marker);
}
console.log('产物自检通过：' + MARKERS.join(' / ') + ' 均在');

/* 5) 广场资产门禁 + 目录产物（唯一能承载二进制的形态） */
const DIST = process.env.CM_DIST || '/tmp/cm-publish-dist';
const COVER_SRC = join(ROOT, 'assets/cover/cover.webp');
const META_SRC = join(ROOT, 'games/mine/game.meta.json');

/** WebP 尺寸解析（VP8 有损 / VP8L 无损 / VP8X 扩展三种容器都认）。 */
function webpSize(buf) {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null; // keyframe start code
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8X') {
    return {
      w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
      h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
    };
  }
  return null;
}

// 封面：缺席就等于把广场封面交还给平台自动截图，这里 fail-close 拦住。
if (!existsSync(COVER_SRC)) throw new Error('缺少封面 assets/cover/cover.webp（没有它广场会退回平台自动截图）');
const coverBuf = readFileSync(COVER_SRC);
const COVER_MAX = 300 * 1024; // 平台建议上限；网关硬顶 2MiB
if (coverBuf.byteLength > COVER_MAX) {
  throw new Error(`cover.webp ${(coverBuf.byteLength / 1024).toFixed(0)} KiB 超过 ${COVER_MAX / 1024} KiB 上限`);
}
const dim = webpSize(coverBuf);
if (!dim) throw new Error('cover.webp 不是可解析的 WebP（RIFF/WEBP 头或帧头不对）');
if (Math.abs(dim.w / dim.h - 16 / 9) > 0.02) {
  throw new Error(`cover.webp 必须是 16:9，当前 ${dim.w}x${dim.h}（卡片会被裁切）`);
}

// meta：与网关 play-live-cover 同口径（整文件 ≤4KiB、title ≤80、tagline ≤200，超限即整条丢弃）
const metaRaw = readFileSync(META_SRC, 'utf8');
if (Buffer.byteLength(metaRaw) > 4096) throw new Error('game.meta.json 超过 4 KiB（网关会整条丢弃）');
const meta = JSON.parse(metaRaw);
if (typeof meta.title !== 'string' || meta.title.length === 0 || meta.title.length > 80) {
  throw new Error('game.meta.json 的 title 必须是 1-80 字符的字符串');
}
if (meta.tagline !== undefined && (typeof meta.tagline !== 'string' || meta.tagline.length > 200)) {
  throw new Error('game.meta.json 的 tagline 必须是 ≤200 字符的字符串');
}

// 目录产物：文本文件树 + 二进制封面 + meta
rmSync(DIST, { recursive: true, force: true });
for (const [rel, content] of Object.entries(files)) {
  const dest = join(DIST, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}
writeFileSync(join(DIST, 'cover.webp'), coverBuf);
writeFileSync(join(DIST, 'game.meta.json'), metaRaw);

/* 剧情 CG 素材（color-mines/cg/*）：只进目录产物 —— JSON payload 是 utf8 文本 map，装不下二进制。
   缺资源不是故障：mine-story.js 的播放机对缺键静默跳过（不变量 1「任何分支都有出口」），
   所以 payload/checkpoint 那条路没有 CG 时游戏照常可玩，只是不放 CG。
   逐件回读校验 + 合计体积上限，防静默截断与产物膨胀。 */
const CG_SRC = join(ROOT, 'color-mines/cg');
/* 只发成品：cgN.mp4 / bgmN.opus。中间件（cg0a/cg0b 拼接源、*-raw.mp4 原始素材）一律不进产物。
   白名单而非黑名单——新加一种中间件不会因为忘了排除就被静默打包进去。 */
const CG_SHIPPED = /^(cg\d+\.mp4|bgm\d+\.opus)$/;
/* 单件上限才是体验相关的（CG 按关卡懒加载，一次只播一段、只拉一段）；
   总量给一个防失控的宽上限即可。 */
/* 384KB ≈ 开场 CG（双镜头 10 秒）的实际大小；章节 CG 单镜 5 秒普遍在 80–280KB。
   这个数字管的是「玩家一次要等多久」，不是总盘子大小。 */
const CG_FILE_CAP = 384 * 1024;
const CG_BUDGET = 4 * 1048576;
const cgNames = existsSync(CG_SRC)
  ? readdirSync(CG_SRC).filter((f) => CG_SHIPPED.test(f)).sort()
  : [];
let cgBytes = 0;
for (const name of cgNames) {
  const buf = readFileSync(join(CG_SRC, name));
  if (buf.byteLength > CG_FILE_CAP) {
    throw new Error(`cg/${name} ${(buf.byteLength / 1024).toFixed(0)}KB 超单件上限 ${CG_FILE_CAP / 1024}KB`);
  }
  const dest = join(DIST, 'cg', name);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  if (!readFileSync(dest).equals(buf)) throw new Error(`产物 cg/${name} 与源文件不一致（写入被污染）`);
  cgBytes += buf.byteLength;
}
if (cgBytes > CG_BUDGET) {
  throw new Error(`CG 素材合计 ${(cgBytes / 1048576).toFixed(2)} MiB 超 ${(CG_BUDGET / 1048576).toFixed(0)} MiB 预算`);
}
/* 齐全性 fail-close（2026-08-29 owner 定案：CG 素材不进 git，只活在本机 color-mines/cg/）。
   既然版本库里没有素材，「发布时素材在不在」就只剩这一道防线：
   照剧情表（mine-story.js 的 MEDIA 映射，唯一权威）逐件核对产物，缺一件就抛错。
   否则在没有素材的检出上构建会**静默**产出一个零 CG 的包 —— 页面照常可玩、
   播放机对缺资源静默跳过，玩家只是「再也看不到剧情」，没有任何人会发现。 */
/* 清单直接问模块本身要（不是正则扒源码）：剧情表现在由规则生成，
   源码里根本没有逐条字面量可扒，而且「构建核对的清单」与「运行时真正加载的清单」
   必须是同一份 —— 两处各自解析就会漂移。 */
const Story = createRequire(import.meta.url)(join(ROOT, 'mine-story.js'));
const uniq = [...new Set(Object.keys(Story.MEDIA || {}).map((k) => k.replace(/^cg\//, '')))]
  .filter((n) => CG_SHIPPED.test(n)).sort();
if (!uniq.length) throw new Error('没能从 mine-story.js 解析出 CG 素材清单，构建假设已失效');
const missing = uniq.filter((n) => !cgNames.includes(n));
if (missing.length) {
  throw new Error(`CG 素材缺 ${missing.length}/${uniq.length} 件：${missing.join(', ')}\n`
    + `  素材不进 git，只在本机 ${CG_SRC}/ —— 换机器/新克隆构建前先把该目录带过来。`);
}
console.log(`  CG 素材 ${cgNames.length} 件 ${(cgBytes / 1048576).toFixed(2)} MiB`
  + `（剧情表要求 ${uniq.length} 件，齐；单件上限 ${CG_FILE_CAP / 1024}KB）`);

// 回读校验：写进产物的封面必须与源逐字节一致（防静默截断/编码污染）
const coverBack = readFileSync(join(DIST, 'cover.webp'));
if (!coverBack.equals(coverBuf)) throw new Error('产物 cover.webp 与源文件不一致（写入被污染）');
if (!existsSync(join(DIST, 'index.html'))) throw new Error('产物缺少 index.html');

console.log(`目录产物 → ${DIST}`);
console.log(`  cover.webp ${dim.w}x${dim.h} ${(coverBuf.byteLength / 1024).toFixed(1)} KB`);
console.log(`  game.meta.json title="${meta.title}" tagline="${meta.tagline ?? ''}"`);
console.log(`  文件 ${Object.keys(files).length + 2} 个（含封面与 meta）`);
