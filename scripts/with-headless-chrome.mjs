#!/usr/bin/env node
/* with-headless-chrome.mjs —— 起一个**独立**的 headless Chrome，把 CDP 端口喂给子命令，跑完就关。

   为什么要它：多语言运行时门禁（scripts/i18n-cjk-scan.mjs）需要一个 Chrome 调试端口，
   而本机 chrome-cu-1/2/3 不一定开着，于是 ./scripts/ci.sh 长期 SKIP 这道门禁——
   SKIP 不是通过。这个包装器让「没开浏览器」不再是跳过的理由，也绝不去碰共享浏览器实例。

   用法：node scripts/with-headless-chrome.mjs node scripts/i18n-cjk-scan.mjs
   子命令从环境变量 CDP 拿到 host:port。退出码 = 子命令的退出码。 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT || 19560);
const cmd = process.argv.slice(2);
if (!cmd.length) { console.error('用法: node scripts/with-headless-chrome.mjs <命令...>'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'headless-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--user-data-dir=' + dir,
  '--remote-debugging-port=' + PORT, 'about:blank',
], { stdio: 'ignore' });

/* spawn 本身失败（最典型：这台机器没装 Chrome / CHROME_BIN 写错 → ENOENT）必须
   捕获成「SKIP」而不是让 node 崩掉：未捕获的 error 事件会以退出码 1 结束，
   而调用方（scripts/ci.sh）把 1 读作「门禁发现了残留中文」——一句「没装浏览器」
   被误报成「多语言有问题」，是最难查的那种假红。 */
let spawnErr = null;
chrome.on('error', (e) => { spawnErr = e; });

let up = false;
for (let i = 0; i < 80 && !up && !spawnErr; i++) {
  try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); up = true; }
  catch { await sleep(250); }
}
if (spawnErr) {
  console.error('SKIP 起不了 headless Chrome：err_name=' + (spawnErr.code || spawnErr.name)
    + ' err_msg=' + String(spawnErr.message || spawnErr).slice(0, 200)
    + '（CHROME_BIN=' + CHROME + '）');
  process.exit(2);
}
/* 起不来就退 2：与 i18n-cjk-scan.mjs 的「没有可用端口 = SKIP」同一个约定，
   这样 ci.sh 不会把「本机没装 Chrome」误判成「门禁发现了问题」。 */
if (!up) { chrome.kill(); console.error('SKIP headless Chrome 没起来（端口 ' + PORT + '）'); process.exit(2); }

const child = spawn(cmd[0], cmd.slice(1), {
  stdio: 'inherit',
  env: Object.assign({}, process.env, { CDP: `127.0.0.1:${PORT}` }),
});
/* 子命令起不来是**真失败**（退 1），不是 SKIP：命令名写错不该被读成「没浏览器」。 */
child.on('error', (e) => {
  chrome.kill();
  console.error('FAIL 子命令起不来：err_name=' + (e.code || e.name)
    + ' err_msg=' + String(e.message || e).slice(0, 200) + ' cmd=' + cmd.join(' '));
  process.exit(1);
});
child.on('exit', (code, signal) => { chrome.kill(); process.exit(signal ? 1 : (code || 0)); });
