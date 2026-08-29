#!/usr/bin/env node
/* 把 games/<id>/game.config.json 同步进 <game>.html 的内嵌 <script id="gameConfig"> 副本。
   内嵌副本是运行时真正读的那一份，改了 JSON 忘了同步 = 页面行为与配置对不上
   （i18n-parity 的「内嵌副本同步」门禁就是拦这个）。用法：
     node scripts/sync-embedded-config.mjs mine.html games/mine/game.config.json  */
import { readFileSync, writeFileSync } from 'node:fs';

const [htmlPath, cfgPath] = process.argv.slice(2);
if (!htmlPath || !cfgPath) {
  console.error('用法: node scripts/sync-embedded-config.mjs <page.html> <game.config.json>');
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const html = readFileSync(htmlPath, 'utf8');
const re = /(<script id="gameConfig" type="application\/json">)([\s\S]*?)(<\/script>)/;
if (!re.test(html)) { console.error('FAIL 没找到 <script id="gameConfig">'); process.exit(1); }
const next = html.replace(re, (_m, a, _old, b) => a + JSON.stringify(cfg) + b);
if (next === html) { console.log('内嵌副本已是最新'); process.exit(0); }
writeFileSync(htmlPath, next);
console.log('OK 已同步内嵌副本 →', htmlPath);
