// 发布前冒烟：把单文件预览页放进一个空目录里跑，确认它离开仓库目录也能正常工作。
//
// 这一步是被真事故逼出来的：之前只验仓库里的 water.html（同级有 assets 和各个 js），
// 而真正发出去的是单文件页，它少了外部依赖照样"看起来能打开"，实则 JS 全崩、进不了关卡。
//
// 断言：① 无运行时 JS 错误 ② 关卡页试管渲染出来 ③ 关键 UI 文案在位
// 用法: node verify-preview.mjs [preview.html]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, copyFileSync, readFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const src = process.argv[2] || '/tmp/water-sort-preview.html';
const CHROME = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 空目录：只放这一个 html，任何遗漏的外部依赖都会立刻暴露成 404
const dir = mkdtempSync(join(tmpdir(), 'wsp-verify-'));
const file = basename(src);
copyFileSync(src, join(dir, file));

const requested = [];
const server = createServer((req, res) => {
  requested.push(req.url);
  if (req.url.split('?')[0] === '/' + file) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(dir, file)));
  } else {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const pageUrl = (hash) => `http://127.0.0.1:${port}/${file}#${hash}`;

// 两个坑叠在一起，缺一不可：
// ① 不能用 spawnSync —— 它会阻塞 Node 事件循环，同进程里的 http server 就没法响应 Chrome 的
//    请求，页面永远是空的（表现得像"Chrome 没跑起来"）。必须异步 spawn。
// ② stdout 必须落文件 —— Chrome 打完 DOM 常常不退出，被 SIGKILL 时管道缓冲会整个丢掉。
function dumpDom(url, tag) {
  return new Promise((resolve) => {
    const domFile = join(dir, `dump-${tag}.html`);
    const fd = openSync(domFile, 'w');
    const cp = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      '--virtual-time-budget=6000', '--user-data-dir=' + join(dir, 'profile-' + tag),
      '--dump-dom', url,
    ], { stdio: ['ignore', fd, 'ignore'] });
    const killer = setTimeout(() => cp.kill('SIGKILL'), 40000);
    cp.on('exit', () => {
      clearTimeout(killer);
      closeSync(fd);
      resolve(readFileSync(domFile, 'utf8'));
    });
  });
}

// 按真人路径来：先首页（用户就是在这里点「开始」），再关卡页
const home = await dumpDom(pageUrl('jserr'), 'home');
const dom = await dumpDom(pageUrl('autostart=1&jserr'), 'level');
server.close();

const fails = [];
if (home.length < 500) fails.push('没拿到首页 DOM（Chrome 没跑起来？）');
if (dom.length < 500) fails.push('没拿到关卡页 DOM（Chrome 没跑起来？）');

const homeErr = home.match(/<pre id="jserr"[^>]*>([\s\S]*?)<\/pre>/);
if (homeErr) fails.push('首页有运行时 JS 错误（用户会点不动「开始」）:\n    ' + homeErr[1].trim());
// 首页体力值是 renderHome 渲染出来的：它崩了这里就还是模板初值/空
if (!/id="enVal">\s*\d+/.test(home)) fails.push('首页体力没渲染出来（renderHome 可能崩了）');
for (const [label, needle] of [['开始按钮', 'id="btnStart"'], ['音效开关', 'id="sfxToggle"']]) {
  if (!home.includes(needle)) fails.push(`首页${label}缺失（${needle}）`);
}
const err = dom.match(/<pre id="jserr"[^>]*>([\s\S]*?)<\/pre>/);
if (err) fails.push('关卡页有运行时 JS 错误:\n    ' + err[1].trim().split('\n').join('\n    '));

const tubes = (dom.match(/data-tube="\d+"/g) || []).length;
if (tubes < 3) fails.push(`关卡页试管没渲染出来（只找到 ${tubes} 根）`);

for (const [label, needle] of [['关卡标题', 'id="hudLv"'], ['步数', 'id="hudMoves"'], ['工具栏', 'id="btnHint"']]) {
  if (!dom.includes(needle)) fails.push(`${label}缺失（${needle}）`);
}

const missed = requested.filter((u) => u.split('?')[0] !== '/' + file && u !== '/favicon.ico');
if (missed.length) fails.push('还在向外请求本地文件（单文件页会 404）: ' + [...new Set(missed)].join(', '));

if (fails.length) {
  console.error('单文件预览冒烟失败:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log(`单文件预览冒烟通过：首页正常 + 关卡页试管 ${tubes} 根 + 零 JS 错误 + 零外部本地请求（${file}）`);
