#!/usr/bin/env node
/*
 * CG 素材清单：把 200 个素材的**身份**锁进仓，内容本身仍留在仓外。
 *
 * 为什么需要（#57 seams S1）：`color-mines/cg/` 被 .gitignore 挡在仓外，
 * 200 个文件 16.66MB 只存在于某一台机器上。后果是**整个构建不可复现**——
 * 别人 clone 下来构建出的产物是缺 CG 的，CI 也构建不了，而且是**静默**缺：
 * 构建照常成功，只是产物里少了素材。
 *
 * 把 16MB 搬进 git 是另一个决定（要上 LFS 或对象存储，得 owner 拍）。
 * 这里先做成本最低、收益最实的一层：**锁身份不锁内容**——
 * 跟 package-lock.json / Cargo.lock 一个思路，锁文件不含内容但锁住"是哪一个"。
 *
 * 于是三种情况都不再静默：
 *   - 素材缺了        → 明确报缺哪几个
 *   - 素材多了        → 报多了哪几个（可能是没清理的中间件）
 *   - 素材内容变了    → 报 sha256 不符（可能被误改/损坏/重新编码过）
 *
 * 用法：
 *   node scripts/cg-manifest.mjs            # 校验，不符退 1
 *   node scripts/cg-manifest.mjs --write    # 按当前素材重新生成清单
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CG_DIR = join(ROOT, 'color-mines/cg');
export const MANIFEST = join(ROOT, 'color-mines/cg-manifest.json');

/** 只认成品：cgN.mp4 / bgmN.opus。中间件（cg0a、*-raw.mp4）一律不进清单。 */
const SHIPPED = /^(cg\d+\.mp4|bgm\d+\.opus)$/;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** 扫实际素材目录，产出 { name: {bytes, sha256} }。 */
export function scanAssets(dir = CG_DIR) {
  if (!existsSync(dir)) return null;
  const out = {};
  for (const name of readdirSync(dir).filter((f) => SHIPPED.test(f)).sort()) {
    const buf = readFileSync(join(dir, name));
    out[name] = { bytes: buf.byteLength, sha256: sha256(buf) };
  }
  return out;
}

/**
 * 把实际素材与清单对账。
 * @returns {{ok:boolean, missing:string[], extra:string[], changed:Array<{name:string,expect:string,actual:string}>, total:number}}
 */
export function checkAssets(manifest, actual) {
  const want = manifest.assets || {};
  const missing = [];
  const extra = [];
  const changed = [];
  for (const name of Object.keys(want)) {
    if (!actual[name]) { missing.push(name); continue; }
    if (actual[name].sha256 !== want[name].sha256) {
      changed.push({ name, expect: want[name].sha256.slice(0, 12), actual: actual[name].sha256.slice(0, 12) });
    }
  }
  for (const name of Object.keys(actual)) if (!want[name]) extra.push(name);
  return {
    ok: missing.length === 0 && extra.length === 0 && changed.length === 0,
    missing, extra, changed,
    total: Object.keys(want).length,
  };
}

/** 人话报告；返回是否通过。 */
export function report(r) {
  if (r.ok) {
    console.log(`✅ CG 素材与清单一致：${r.total} 件，逐件 sha256 相符`);
    return true;
  }
  console.error(`❌ CG 素材与清单对不上（清单 ${r.total} 件）`);
  if (r.missing.length) {
    console.error(`   缺 ${r.missing.length} 件：${r.missing.slice(0, 8).join(', ')}${r.missing.length > 8 ? ' …' : ''}`);
    console.error('      素材不在仓里（.gitignore 挡着），换机器/新 clone 就会缺。');
    console.error('      从素材归档处取回，或找上次发布的人要。');
  }
  if (r.extra.length) {
    console.error(`   多 ${r.extra.length} 件：${r.extra.slice(0, 8).join(', ')}${r.extra.length > 8 ? ' …' : ''}`);
    console.error('      清单里没有的成品——要么是新加的（跑 --write 更新清单），要么是没清理的中间件。');
  }
  for (const c of r.changed) {
    console.error(`   内容变了：${c.name} 期望 ${c.expect}… 实际 ${c.actual}…`);
  }
  return false;
}

// —— CLI ——
if (import.meta.url === `file://${process.argv[1]}`) {
  const write = process.argv.includes('--write');
  const actual = scanAssets();
  if (!actual) {
    console.error(`❌ 找不到素材目录 ${CG_DIR}`);
    process.exit(1);
  }
  if (write) {
    const total = Object.values(actual).reduce((n, a) => n + a.bytes, 0);
    const doc = {
      note: '由 scripts/cg-manifest.mjs --write 生成。素材本身不在仓里（见 .gitignore），这里只锁身份。',
      generatedFrom: 'color-mines/cg/',
      count: Object.keys(actual).length,
      totalBytes: total,
      assets: actual,
    };
    writeFileSync(MANIFEST, JSON.stringify(doc, null, 2) + '\n');
    console.log(`已写入 ${MANIFEST}：${doc.count} 件 / ${(total / 1048576).toFixed(2)} MiB`);
    process.exit(0);
  }
  if (!existsSync(MANIFEST)) {
    console.error(`❌ 清单不存在：${MANIFEST}（首次生成跑 --write）`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  process.exit(report(checkAssets(manifest, actual)) ? 0 : 1);
}
