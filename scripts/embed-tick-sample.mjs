/* 把倒计时滴答的音频素材内联进 core/tickalarm.js。
 *
 * 唯一权威是 assets/mine/tick-clock.mp3（assetgen kind=sfx 生成，见 core/tickalarm.js 顶部注释）；
 * core/tickalarm.js 里 sample:begin/end 之间的 base64 只是它的搬运件。
 * 为什么要内联而不是外链：发布产物 fail-close 明令「不许引用 assets/ 二进制」
 * （scripts/build-publish-mine.mjs），payload 是 utf8 文本 map，装不下二进制文件。
 *
 * 用法：node scripts/embed-tick-sample.mjs
 * 漂移由 mine-tick-alarm.test.js 逮（它拿 mp3 重算一遍比对），所以这里 fail-close：
 * 标记不见了就抛错，不做"猜个地方插进去"的兜底。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET = join(ROOT, 'assets/mine/tick-clock.mp3');
const TARGET = join(ROOT, 'core/tickalarm.js');
const BEGIN = '/* sample:begin */';
const END = '/* sample:end */';

const b64 = readFileSync(ASSET).toString('base64');
const src = readFileSync(TARGET, 'utf8');
const i = src.indexOf(BEGIN);
const j = src.indexOf(END);
if (i < 0 || j < i) throw new Error(`core/tickalarm.js 里找不到 ${BEGIN} … ${END} 标记，构建假设已失效`);

const block = `${BEGIN}\n  var SAMPLE_B64 = '${b64}';\n  `;
const out = src.slice(0, i) + block + src.slice(j);
writeFileSync(TARGET, out);
console.log(`已内联 ${(b64.length / 1024).toFixed(1)} KB base64（源 ${readFileSync(ASSET).length} B）→ core/tickalarm.js`);
