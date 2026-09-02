#!/usr/bin/env node
/*
 * 产物自检：把 index.html 里每一块 <script> 单独拿出来，看它还能不能被解析。
 *
 * 为什么需要它（#57）：2026-09-01 线上整站白屏，原因是**发布之后**有一道
 * 「中文文案自动机翻成英文」的后处理改写了产物。它做纯文本替换、不认识语法，
 * 英文缩写里的撇号（can't / wasn't / language's）落进单引号字符串就把代码打断，
 * 英文双引号（"not a mine"）落进 JSON 就把配置打断。结果是
 * core/home.js 语法错 → HomeCore 未定义 → 首页零子节点 → 白屏。
 *
 * 那次故障的关键教训：**光看字节对不对是看不出来的**。产物字节合法、HTML 结构
 * 完整、`</html>` 也在，但里面的 JS 已经不是合法 JS 了。只有真去解析才发现得了。
 *
 * 用法：
 *   node scripts/verify-artifact.mjs <index.html>      # CLI，坏了退 1
 *   import { verifyArtifact } from './verify-artifact.mjs'  # 供构建脚本调用
 */
import { readFileSync } from 'node:fs';

/** 从 HTML 里切出所有 <script> 块（含属性与正文）。 */
export function scriptBlocks(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  let i = 0;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    const id = /id="([^"]+)"/.exec(attrs);
    const type = /type="([^"]+)"/.exec(attrs);
    out.push({
      index: i++,
      id: id ? id[1] : '',
      type: type ? type[1] : 'js',
      code: m[2],
      isJson: /type="application\/json"/.test(attrs),
    });
  }
  return out;
}

/**
 * 逐块解析产物。
 * @returns {{total:number, bad:Array<{index:number,id:string,kind:string,message:string,excerpt:string}>}}
 */
export function verifyArtifact(html) {
  const bad = [];
  const blocks = scriptBlocks(html);
  for (const b of blocks) {
    try {
      if (b.isJson) {
        JSON.parse(b.code);
      } else {
        // 只解析、不执行：语法错会在这里抛，副作用不会发生
        // eslint-disable-next-line no-new-func
        new Function(b.code);
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      // 尽量给出坏点附近的原文，方便一眼看出是哪句文案被改写了
      let excerpt = '';
      const pos = /position (\d+)/.exec(msg);
      if (pos) {
        // JSON 报错带 position，直接切那一段
        const p = Number(pos[1]);
        excerpt = b.code.slice(Math.max(0, p - 80), p + 50).replace(/\s+/g, ' ');
      } else {
        /* JS 语法错不给位置。用「撇号夹在两个字母之间」找嫌疑行——这正是
           can't / wasn't / language's 的形状，也就是 #57 的坏法。
           找不到就退回块首，至少给个落脚点。 */
        const lines = b.code.split('\n');
        const hit = lines.findIndex((l) => /[A-Za-z]'[A-Za-z]/.test(l));
        excerpt = hit >= 0
          ? `L${hit + 1}: ${lines[hit].trim().slice(0, 160)}`
          : b.code.slice(0, 120).replace(/\s+/g, ' ');
      }
      bad.push({
        index: b.index,
        id: b.id,
        kind: b.isJson ? 'JSON' : 'JS',
        message: msg.slice(0, 120),
        excerpt,
      });
    }
  }
  return { total: blocks.length, bad };
}

/** 人话报告；返回是否通过。 */
export function report(result, label = '产物') {
  if (result.bad.length === 0) {
    console.log(`✅ ${label}：${result.total} 块 script 全部可解析`);
    return true;
  }
  console.error(`❌ ${label}：${result.total} 块 script 里有 ${result.bad.length} 块解析不了`);
  for (const b of result.bad) {
    console.error(`   #${b.index}${b.id ? `(${b.id})` : ''} ${b.kind}: ${b.message}`);
    if (b.excerpt) console.error(`      坏点附近: ${b.excerpt}`);
  }
  console.error('   这类损坏最典型的来源是「有人对产物做了不认识语法的文本替换」，');
  console.error('   比如把中文机翻成英文时，can\'t / "not a mine" 里的引号把字符串打断了。');
  return false;
}

// —— CLI ——
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: node scripts/verify-artifact.mjs <index.html>');
    process.exit(2);
  }
  const ok = report(verifyArtifact(readFileSync(file, 'utf8')), file);
  process.exit(ok ? 0 : 1);
}
