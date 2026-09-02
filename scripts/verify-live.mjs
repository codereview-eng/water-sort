#!/usr/bin/env node
/* 发布后验证：确认**线上真正在服的那一份**既能解析、也真的渲染得出来。
 *
 * 为什么非要有这道（#57）：2026-09-01 发布的包本身是好的（构建期自检 19/19 全过），
 * 白屏是**发布之后**产物被一道「中文机翻成英文」的后处理改写出来的。
 * 构建期门禁对此完全无能为力——它检查的是我们手里那份，不是线上那份。
 *
 * 当时的复验之所以漏掉，是因为只 `grep` 了几个字节（story.count=100 对得上）
 * 和 CG 文件大小（逐一 MATCH），而坏的地方不在 grep 的那几个字节里。
 * 教训：**字节对得上 ≠ 页面能跑**。所以这里两件事都做：
 *
 *   1. 拉线上 HTML，逐块解析（不需要浏览器，最便宜也最能定位）
 *   2. 用 CDP 真开一次页面，断言首页渲染出东西、且没有 pageerror
 *
 * 另外可选核对 data-build：线上戳与刚发布的产物不一致，说明服的不是你发的那份。
 *
 * 用法：
 *   node scripts/verify-live.mjs --url https://play-color-mines.run.ceo/
 *   node scripts/verify-live.mjs --url <URL> --expect-build 20260901T125736Z
 *   node scripts/verify-live.mjs --url <URL> --root "#home"
 *   CDP=127.0.0.1:19301 node scripts/verify-live.mjs --url <URL>
 *
 * 退出码（与 scripts/i18n-cjk-scan.mjs 同约定）：
 *   0 = 通过；1 = 线上坏了；2 = 没有可用的 Chrome 调试端口（运行时那半没跑，
 *   由调用方决定是否放行——绝不静默当绿）。
 */
import { verifyArtifact, report } from './verify-artifact.mjs';

const HOST = process.env.CDP || '127.0.0.1:19301';
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const url = arg('--url');
const expectBuild = arg('--expect-build');
const rootSel = arg('--root', '#home');

if (!url) {
  console.error('用法: node scripts/verify-live.mjs --url <线上地址> [--expect-build <stamp>] [--root <选择器>]');
  process.exit(2);
}

function rpc(ws, id, method, params) {
  return new Promise((res, rej) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

let failed = false;

/* ── 1) 静态：线上 HTML 逐块解析 ───────────────────────────────── */
const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
if (!res.ok) {
  console.error(`❌ 拉线上失败：HTTP ${res.status}`);
  process.exit(1);
}
const html = await res.text();
console.log(`线上 ${url} → ${html.length} 字节`);

if (!report(verifyArtifact(html), '线上产物')) failed = true;

const buildStamp = (/<html[^>]*data-build="([^"]*)"/.exec(html) || [])[1] || '(无)';
console.log(`线上 data-build: ${buildStamp}`);
if (expectBuild) {
  if (buildStamp === expectBuild) {
    console.log(`✅ data-build 与预期一致`);
  } else {
    console.error(`❌ data-build 对不上：预期 ${expectBuild}，线上 ${buildStamp}`);
    console.error('   服的不是你刚发布的那一份——要么被别的发布覆盖，要么产物在发布后被改写过。');
    failed = true;
  }
}

/* ── 2) 运行时：真开一次页面 ───────────────────────────────────── */
let browserWs;
try {
  const v = await (await fetch(`http://${HOST}/json/version`)).json();
  browserWs = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r, j) => { browserWs.addEventListener('open', r); browserWs.addEventListener('error', j); });
} catch (e) {
  console.error(`⚠️  连不上 Chrome 调试端口 ${HOST}，运行时那半没跑（不当成绿）：${e && e.message}`);
  console.error('   起一个：google-chrome --headless=new --remote-debugging-port=19301 --no-sandbox about:blank');
  process.exit(failed ? 1 : 2);
}

let id = 1;
const { targetId } = await rpc(browserWs, id++, 'Target.createTarget', { url: 'about:blank', background: true, newWindow: true });
const list = await (await fetch(`http://${HOST}/json/list`)).json();
const t = list.find((x) => x.id === targetId);
const pws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => pws.addEventListener('open', r));

const pageErrors = [];
pws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    pageErrors.push(String((d.exception && d.exception.description) || d.text || 'unknown').split('\n')[0]);
  }
});

let pid = 100;
const ev = async (expression) => {
  const r = await rpc(pws, pid++, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || 'throw' };
  return r.result.value;
};

await rpc(pws, pid++, 'Runtime.enable', {});
await rpc(pws, pid++, 'Page.enable', {});
await rpc(pws, pid++, 'Page.navigate', { url });
// 等页面把首屏跑出来：轮询到根节点有子节点，或超时
const deadline = Date.now() + 15000;
let rootInfo = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
  rootInfo = await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(rootSel)});
    return { found: !!el, children: el ? el.children.length : -1,
             bodyText: (document.body ? document.body.innerText : '').trim().slice(0, 80) };
  })()`);
  if (rootInfo && rootInfo.children > 0) break;
}

console.log(`运行时：${rootSel} found=${rootInfo && rootInfo.found} children=${rootInfo && rootInfo.children}`);
if (!rootInfo || !rootInfo.found) {
  console.error(`❌ 页面里找不到 ${rootSel}`);
  failed = true;
} else if (rootInfo.children <= 0) {
  console.error(`❌ ${rootSel} 一个子节点都没有——这就是白屏的样子`);
  console.error(`   页面可见文本: ${JSON.stringify(rootInfo.bodyText)}`);
  failed = true;
} else {
  console.log(`✅ 首页渲染出 ${rootInfo.children} 个子节点`);
}

if (pageErrors.length) {
  console.error(`❌ 页面抛了 ${pageErrors.length} 个错：`);
  [...new Set(pageErrors)].slice(0, 5).forEach((e) => console.error(`   ${e}`));
  failed = true;
} else {
  console.log('✅ 无 pageerror');
}

try { await rpc(browserWs, id++, 'Target.closeTarget', { targetId }); } catch {}
try { pws.close(); browserWs.close(); } catch {}

process.exit(failed ? 1 : 0);
