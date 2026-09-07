/* mine-weekly-replay-check.mjs —— 「已领取的图也能点开重看动画」的真页面验收（2026-09-07）

   用户实报：周活动领取时会弹出这周的动图，但那是唯一一次机会；已领取的行按钮变灰
   写「已领取」，之后怎么点都再看不到那幅画的动画版。

   为什么必须真跑页面：单元门禁只能证明「代码里绑了 handler」，证明不了
   「点下去真的弹窗、弹窗里真的有那张 gif、且 gif 真的加载成功」——
   404 / 解码失败在页面上都是静默的（本仓已有前车之鉴：wkBindImgTrace 就是为此加的）。

   动线：独立 headless Chrome（自己的 profile 与端口，绝不碰 chrome-cu-1/2/3）
        → 种一份「三张图与大奖全部已领取」的周存档 → 开活动页
        → 点已领取的第 1 行 / 大奖行 → 读弹窗标题、图 src、naturalWidth。

   用法：node test/manual/mine-weekly-replay-check.mjs
        PAGE=file:///tmp/cm-publish-dist/index.html node test/manual/mine-weekly-replay-check.mjs */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createRequire } from 'module';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PAGE = process.env.PAGE || ('file://' + join(ROOT, 'mine.html'));
const PORT = 19587;
const SHOTS = '/tmp/mine-weekly-replay-shots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 周 key 由被测的同一份 core 算（种错周 = normalize 会把存档当上周的直接清空） */
const require_ = createRequire(import.meta.url);
const cfg = JSON.parse(readFileSync(join(ROOT, 'games/mine/game.config.json'), 'utf8'));
const Weekly = require_(join(ROOT, 'core/weekly.js')).create(cfg.weekly);
const seed = {
  week: Weekly.weekKey(Date.now()), frags: Weekly.goal + 50, carried: 0,
  claimed: [true, true, true], grand: true,
  r0: { type: 'coins', n: 30 }, r1: { type: 'toolMine', n: 1 }, r2: { type: 'coins', n: 60 },
};

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? '✔' : '✖') + ' ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

const profile = mkdtempSync(join(tmpdir(), 'wkreplay-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', 'about:blank',
], { stdio: 'ignore' });

async function cdpUrl() {
  for (let i = 0; i < 40; i++) {
    try { return (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; }
    catch { await sleep(250); }
  }
  throw new Error('CDP 起不来');
}

async function main() {
  const ws = new WebSocket(await cdpUrl());
  await new Promise((r) => ws.addEventListener('open', r));
  let mid = 0;
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const id = ++mid;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', onMsg); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const evalJs = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const { data } = await S('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('fs');
    writeFileSync(join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  };

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  /* 存档必须在页面脚本跑之前落地，否则 WeeklyCtl.load() 读的是空档 */
  await S('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('mine_weekly_v1', ${JSON.stringify(JSON.stringify(seed))}); } catch (e) {}`,
  });
  await S('Page.navigate', { url: PAGE });
  await sleep(2200);

  const opened = await evalJs(`(() => {
    const b = document.querySelector('[data-action="weekly"]');
    if (!b) return 'no-entry';
    b.click();
    return document.getElementById('wkPage').hidden ? 'still-hidden' : 'open';
  })()`);
  check('周活动页打开', opened === 'open', opened);
  await sleep(600);
  await shot('1-weekly-page');

  const rows = await evalJs(`(() => {
    const rs = Array.from(document.querySelectorAll('#wkGrid .wkpic'));
    return rs.map((r) => ({ cls: r.className, btn: r.querySelector('button').textContent,
      disabled: !!r.querySelector('button').disabled, replay: r.querySelector('button').getAttribute('data-replay') }));
  })()`);
  check('三张图都是已领取态', rows.every((r) => /claimed/.test(r.cls)), rows.map((r) => r.cls));
  check('已领取的按钮可点且写「重看」', rows.every((r) => !r.disabled && /重看|Replay/.test(r.btn)), rows.map((r) => r.btn));

  /* 点第 1 行（点的是缩略图，玩家最自然的动作就是点画面本身） */
  const first = await evalJs(`(() => {
    document.querySelector('#wkGrid .wkpic.claimed .thumb, #wkGrid .wkpic.claimed').click();
    return 1;
  })()`);
  await sleep(900);
  const dlg = await evalJs(`(() => {
    const im = document.getElementById('wkArtImg');
    return { open: document.getElementById('overlay').classList.contains('show'),
      title: document.getElementById('dlgTitle').textContent,
      body: document.getElementById('dlgBody').textContent,
      src: im ? im.getAttribute('src') : null,
      w: im ? im.naturalWidth : 0, h: im ? im.naturalHeight : 0 };
  })()`);
  await shot('2-replay-pic');
  check('点已领取的图弹出了动画窗', dlg.open === true, dlg.title);
  check('窗里放的是当周动图 gif', /assets\/weekly\/anim\/.*\.gif$/.test(dlg.src || ''), dlg.src);
  check('gif 真的加载成功（不是静默 404）', dlg.w > 0 && dlg.h > 0, { w: dlg.w, h: dlg.h });
  check('文案写清当时领到了什么', /30|Claimed|已领取/.test(dlg.body || ''), dlg.body);

  /* 退出路径照旧（✕）+ 再点大奖行重看 */
  await evalJs(`document.getElementById('dlgX').click()`);
  await sleep(400);
  const closed = await evalJs(`!document.getElementById('overlay').classList.contains('show')`);
  check('✕ 能关掉重看窗', closed === true, closed);

  const grand = await evalJs(`(() => {
    const gb = document.getElementById('wkGrandBtn');
    const before = localStorage.getItem('mine_weekly_v1');
    document.getElementById('wkGrandRow').click();
    return { btn: gb.textContent, disabled: !!gb.disabled, before };
  })()`);
  await sleep(900);
  const dlg2 = await evalJs(`(() => {
    const im = document.getElementById('wkArtImg');
    return { open: document.getElementById('overlay').classList.contains('show'),
      title: document.getElementById('dlgTitle').textContent,
      src: im ? im.getAttribute('src') : null, w: im ? im.naturalWidth : 0,
      save: localStorage.getItem('mine_weekly_v1') };
  })()`);
  await shot('3-replay-grand');
  check('已领的大奖按钮可点且写「重看」', !grand.disabled && /重看|Replay/.test(grand.btn), grand.btn);
  check('点大奖行重看到整幅周图动画', dlg2.open === true && dlg2.w > 0, { open: dlg2.open, w: dlg2.w });
  check('重看不改存档（不再发第二份奖）', dlg2.save === grand.before);

  const events = await evalJs(`JSON.stringify((window.__mine && window.__mine.events() || [])
    .filter((r) => r.e === 'weekly_art_replay'))`);
  check('两条重看路径都留痕（可按周聚合）', (JSON.parse(events) || []).length >= 2, JSON.parse(events));

  console.log('\n截图 → ' + SHOTS);
  ws.close();
  chrome.kill();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
