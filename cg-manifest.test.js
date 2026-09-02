/*
 * 素材清单对账的测试。
 *
 * 这层存在的理由是「素材不在仓里，缺了本来是静默的」，所以测试重点是
 * **三种不一致都必须被抓出来**，而不是「一致时能过」。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = __dirname;

let mod;
async function load() {
  if (!mod) mod = await import('./scripts/cg-manifest.mjs');
  return mod;
}

const man = (assets) => ({ count: Object.keys(assets).length, assets });
const A = (sha, bytes = 100) => ({ bytes, sha256: sha });

test('一致时通过', async () => {
  const { checkAssets } = await load();
  const m = man({ 'cg0.mp4': A('aaa'), 'bgm0.opus': A('bbb') });
  const r = checkAssets(m, { 'cg0.mp4': A('aaa'), 'bgm0.opus': A('bbb') });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.total, 2);
});

test('素材缺了必须报出来（换机器/新 clone 的典型情况）', async () => {
  const { checkAssets } = await load();
  const m = man({ 'cg0.mp4': A('aaa'), 'cg1.mp4': A('bbb'), 'cg2.mp4': A('ccc') });
  const r = checkAssets(m, { 'cg0.mp4': A('aaa') });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing, ['cg1.mp4', 'cg2.mp4']);
  assert.deepStrictEqual(r.extra, []);
});

test('素材多了必须报出来（没清理的中间件会混进产物）', async () => {
  const { checkAssets } = await load();
  const m = man({ 'cg0.mp4': A('aaa') });
  const r = checkAssets(m, { 'cg0.mp4': A('aaa'), 'cg7.mp4': A('zzz') });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.extra, ['cg7.mp4']);
});

test('内容变了必须报出来——名字大小都一样也不行', async () => {
  const { checkAssets } = await load();
  const m = man({ 'cg0.mp4': A('aaa', 12345) });
  // 同名、同大小，只有 sha256 不同（被重新编码 / 误改 / 损坏）
  const r = checkAssets(m, { 'cg0.mp4': A('bbb', 12345) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.changed.length, 1);
  assert.strictEqual(r.changed[0].name, 'cg0.mp4');
  assert.deepStrictEqual(r.missing, [], '内容变了算 changed，不该误报成缺失');
});

test('三种问题同时存在时一次全报，不是只报第一种', async () => {
  const { checkAssets } = await load();
  const m = man({ 'a.mp4': A('1'), 'b.mp4': A('2'), 'c.mp4': A('3') });
  const r = checkAssets(m, { 'a.mp4': A('1'), 'b.mp4': A('CHANGED'), 'x.mp4': A('9') });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing, ['c.mp4']);
  assert.deepStrictEqual(r.extra, ['x.mp4']);
  assert.strictEqual(r.changed.length, 1);
});

test('只认成品名：中间件（cg0a / *-raw.mp4）不该进清单', async () => {
  const { scanAssets } = await load();
  const actual = scanAssets();
  if (!actual) return; // 没有素材目录的环境（新 clone）——跳过，由构建那道报缺
  const names = Object.keys(actual);
  assert.ok(names.length > 0, '素材目录存在就该扫到东西');
  assert.deepStrictEqual(
    names.filter((n) => !/^(cg\d+\.mp4|bgm\d+\.opus)$/.test(n)), [],
    '扫出了不符合成品命名的文件——中间件会被误打进产物',
  );
});

test('回归锚点：仓里的清单与本机实际素材一致', async () => {
  const { scanAssets, checkAssets, MANIFEST } = await load();
  const actual = scanAssets();
  if (!actual || !existsSync(MANIFEST)) return; // 素材不在本机时跳过
  const r = checkAssets(JSON.parse(readFileSync(MANIFEST, 'utf8')), actual);
  assert.strictEqual(r.ok, true,
    `清单与实际素材不一致：缺 ${r.missing.length} / 多 ${r.extra.length} / 变 ${r.changed.length}`);
});

test('清单本身格式正确、且只锁身份不含内容', async () => {
  const { MANIFEST } = await load();
  if (!existsSync(MANIFEST)) return;
  const d = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  assert.strictEqual(typeof d.count, 'number');
  assert.strictEqual(d.count, Object.keys(d.assets).length, 'count 必须与条目数一致');
  for (const [name, a] of Object.entries(d.assets)) {
    assert.match(a.sha256, /^[0-9a-f]{64}$/, `${name} 的 sha256 格式不对`);
    assert.ok(a.bytes > 0, `${name} 的 bytes 必须为正`);
    assert.deepStrictEqual(Object.keys(a).sort(), ['bytes', 'sha256'],
      `${name} 只该有 bytes/sha256——清单是锁身份的，不该塞内容进来`);
  }
});
