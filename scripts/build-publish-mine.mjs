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
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { stripSelfTest, assertNoSelfTest, SELFTEST_BLOCKS } from './strip-selftest.mjs';

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

/* 1.6) 剔除开发自检面板（#selftest 充值 10000 金币）——默认不进线上产物。
   顶层函数声明会挂到 window，光隐藏面板挡不住控制台直接调 grantCoins()，所以物理删代码。
   MINE_SELFTEST=1 只用来出「本地调试产物」，带着这个环境变量出的产物不许发布。 */
const keepSelfTest = process.env.MINE_SELFTEST === '1';
if (keepSelfTest) {
  console.warn('⚠ MINE_SELFTEST=1：保留自检面板（含充值按钮）。这份产物只能自己本地用，禁止发布上线。');
} else {
  const stripped = stripSelfTest(inlined);
  if (stripped.removed !== SELFTEST_BLOCKS) {
    throw new Error(`自检面板标记块应有 ${SELFTEST_BLOCKS} 段，实际剔除 ${stripped.removed} 段`
      + '——mine.html 的 selftest:begin/end 标记被改动过，构建假设已失效');
  }
  inlined = stripped.html;
  assertNoSelfTest(inlined, '发布产物 index.html');
}

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

/* 4.5) 语法门禁：逐块把 <script> 解析一遍（#57）。
   MARKERS 只验「该有的字符串在不在」，验不出「代码还能不能跑」——
   #57 那次线上白屏，产物里每个 marker 都在、HTML 结构也完整，
   但 5 块 script 已经不是合法 JS/JSON 了。字节合法 ≠ 能跑，必须真解析。
   这道是构建期的保险（防我们自己发坏包）；发布之后被改写的情况另有 verify-live。 */
{
  const { verifyArtifact, report } = await import('./verify-artifact.mjs');
  if (!report(verifyArtifact(inlined), '构建产物 index.html')) {
    throw new Error('产物里有 script 解析不了，拒绝出包');
  }
}

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

/* 素材身份对账（#57 seams S1）：素材不在仓里，所以"缺素材"这件事本来是**静默**的
   ——构建照常成功，只是产物里少了几段 CG。清单把 200 件的 sha256 锁进仓，
   缺 / 多 / 内容变了都当场报出来。清单本身只有 26KB。 */
{
  const m = await import('./cg-manifest.mjs');
  if (existsSync(m.MANIFEST)) {
    const actual = m.scanAssets();
    if (!actual) throw new Error(`找不到素材目录 ${CG_SRC}`);
    if (!m.report(m.checkAssets(JSON.parse(readFileSync(m.MANIFEST, 'utf8')), actual))) {
      throw new Error('CG 素材与清单对不上，拒绝出包');
    }
  } else {
    console.warn('⚠️  没有 color-mines/cg-manifest.json，跳过素材身份对账（跑 node scripts/cg-manifest.mjs --write 生成）');
  }
}
/* 只发成品：cgN.mp4 / bgmN.opus。中间件（cg0a/cg0b 拼接源、*-raw.mp4 原始素材）一律不进产物。
   白名单而非黑名单——新加一种中间件不会因为忘了排除就被静默打包进去。 */
const CG_SHIPPED = /^(cg\d+\.mp4|bgm\d+\.opus)$/;
/* 单件上限才是体验相关的（CG 按关卡懒加载，一次只播一段、只拉一段）；
   总量给一个防失控的宽上限即可。 */
/* 384KB ≈ 开场 CG（双镜头 10 秒）的实际大小；章节 CG 单镜 5 秒普遍在 80–280KB。
   这个数字管的是「玩家一次要等多久」，不是总盘子大小。 */
const CG_FILE_CAP = 384 * 1024;
/* 总量闸（2026-09-01 由 4 MiB 放宽到 32 MiB，为扩到 100 段 CG）：
   实测单段（视频+配乐）约 221KB ⇒ 100 段 ≈ 21.5 MB，200 段 ≈ 43 MB。
   32 MiB 的位置是刻意的：够 100 段有余量，又在 publish 工具那条 ~40MB 闸之前先红，
   让「体积失控」在本地构建时暴露，而不是发布时才撞墙。
   真要超过 ~180 段，才需要动远端媒体包方案（MEDIA 映射表那个 seam 还在，改一处即可）。

   注意 count 语义：core/story.js 按 `count` 生成剧情表，门3 逐件核对资产存在性
   ⇒ **`count` 必须等于「已完成段数」，不是「规划段数」**，否则做到一半构建就红。
   加一段 = 放一对 cgN.mp4/bgmN.opus + count++，可以一段一段发。 */
const CG_BUDGET = 32 * 1048576;
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
const StoryCore = createRequire(import.meta.url)(join(ROOT, 'core/story.js'));
const Story = StoryCore.create(
  JSON.parse(readFileSync(join(ROOT, 'games/mine/game.config.json'), 'utf8')).story || {});
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

/* ── 门4 · 目录纯洁性（反向闸，2026-08-29）────────────────────────────────
   前三道闸都是「白名单完整性」：只回答「我要的在不在」，不回答「不该在的在不在」。
   2026-08-29 事故正是后者失守——12 个 *-raw.mp4 AI 母版（117MB）躺在 cg/ 里，
   三道闸全绿、产物也只有 3.3MB，但**按源码树打包的发布路径**把它们一起卷走，
   直接撞上发布侧体积上限。当时唯一的约束是 .gitignore 里一句注释，拦不住任何东西。

   判据（通用，不特判文件名）：cg/ 下任何**不属于成品白名单**且**大于 1MB**的文件 = RED。
   小文件（.bak、concat.txt 等）放行——它们不构成体积风险，不值得为此制造噪声。 */
const STRAY_MAX_BYTES = 1024 * 1024;
/* 递归扫（2026-09-01 补漏）：上一版只扫一层，往 cg/ 下建个子目录就能把大文件藏进去，
   而「按源码树打包」的发布路径照样会把它卷走——跟 117MB 母版是同一类后门。
   成品判据只认**根目录下的裸文件名**：嵌套的 rejects/cg11.mp4 带着目录前缀，
   匹配不上 CG_SHIPPED ⇒ 自动算 stray，正是我们要的。 */
function collectStrays(dir, rel) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const name = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) { out.push(...collectStrays(join(dir, ent.name), name)); continue; }
    if (CG_SHIPPED.test(name)) continue;
    const bytes = statSync(join(dir, ent.name)).size;
    if (bytes > STRAY_MAX_BYTES) out.push({ name, bytes });
  }
  return out;
}
const strays = existsSync(CG_SRC)
  ? collectStrays(CG_SRC, '').sort((a, b) => b.bytes - a.bytes)
  : [];
if (strays.length) {
  const total = strays.reduce((s, x) => s + x.bytes, 0);
  throw new Error(
    `cg/ 里有 ${strays.length} 个非成品大文件（合计 ${(total / 1048576).toFixed(1)} MB）。\n`
    + `  它们不进产物，但会被「按源码树打包」的发布路径卷走并撞上体积上限：\n`
    + strays.map((x) => `    ${x.name}  ${(x.bytes / 1048576).toFixed(1)} MB`).join('\n')
    + `\n  处置：母版/中间件移出游戏目录（保留不删），例如：\n`
    + `    mkdir -p ~/cg-master-color-mines && mv ${CG_SRC}/*-raw.mp4 ~/cg-master-color-mines/`);
}

// 回读校验：写进产物的封面必须与源逐字节一致（防静默截断/编码污染）
const coverBack = readFileSync(join(DIST, 'cover.webp'));
if (!coverBack.equals(coverBuf)) throw new Error('产物 cover.webp 与源文件不一致（写入被污染）');
if (!existsSync(join(DIST, 'index.html'))) throw new Error('产物缺少 index.html');

console.log(`目录产物 → ${DIST}`);
console.log(`  cover.webp ${dim.w}x${dim.h} ${(coverBuf.byteLength / 1024).toFixed(1)} KB`);
console.log(`  game.meta.json title="${meta.title}" tagline="${meta.tagline ?? ''}"`);
console.log(`  文件 ${Object.keys(files).length + 2} 个（含封面与 meta）`);

/* 发布后那一步的交接（#57 seams S2）：发布走的是外部工具，脚本管不到，
   所以「构建 → 发布 → 验证」是断开的，只能靠人记得回来验一下——#57 就是没验到位。
   这里把下一步命令连同本次的 data-build 戳直接打出来，照着贴即可，
   不用自己去产物里翻戳。戳的用处：线上戳与它对不上，说明服的不是你刚发的那份。 */
const stampOut = (/<html[^>]*data-build="([^"]*)"/.exec(inlined) || [])[1] || '';
console.log('');
console.log('下一步 —— 发布后请立刻验一次线上（#57 的白屏就是漏了这步）：');
console.log(`  node scripts/verify-live.mjs --url https://play-color-mines.run.ceo/ \\`);
console.log(`    --root '#home' --expect-build ${stampOut}`);
