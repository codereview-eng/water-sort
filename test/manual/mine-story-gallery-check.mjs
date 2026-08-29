/* mine-story-gallery-check.mjs —— 首页剧情图鉴的真页面验收（2026-08-29）

   用户要的三条：
     ① 首页设置图标【下面】有个 CG 小图标；
     ② 点开列出所有 CG，没通关的显示一把锁；
     ③ 已通关的点一下能重播那一段。

   为什么必须真跑页面：入口是 config 声明 + 运行时按 data-action 绑定 + 弹窗里
   动态渲染的行，单测只能看源码字符串，看不见「点了到底有没有反应」。
   （教训见 repo memory「页面接线要单独测」。）

   用法：node test/manual/mine-story-gallery-check.mjs
        PAGE=https://play-color-mines.run.ceo/ node test/manual/mine-story-gallery-check.mjs  # 线上复验
   截图落 /tmp/mine-story-shots。 */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const PAGE = process.env.PAGE || ('file://' + resolve(process.cwd(), 'mine.html'));
const PORT = 19587;
const SHOTS = '/tmp/mine-story-shots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? '✔' : '✖') + ' ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

const profile = mkdtempSync(join(tmpdir(), 'storygate-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
  '--force-device-scale-factor=2', 'about:blank',
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
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
  });

  /* 一个场景 = 一个全新 target：种档脚本要在页面脚本之前跑，
     中途 reload 会重跑种档把状态打回去（造假红，见 repo memory「彩雷 CG 门禁」）。 */
  async function scenario(name, saveObj, lang) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', background: true });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S('Page.enable');
    await S('Runtime.enable');
    await S('Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await S('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{localStorage.setItem('mine_save_v1',JSON.stringify(${JSON.stringify(saveObj)}));`
        + `localStorage.setItem('mine_lang',${JSON.stringify(lang || 'zh')});}catch(e){}`,
    });
    await S('Page.navigate', { url: PAGE });
    await sleep(1800);
    const ev = async (expr) => (await S('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
    const shot = async (tag) => {
      const { data } = await S('Page.captureScreenshot', { format: 'png' });
      const p = join(SHOTS, `${name}-${tag}.png`);
      writeFileSync(p, Buffer.from(data, 'base64'));
      return p;
    };
    return { ev, shot, close: () => send('Target.closeTarget', { targetId }) };
  }

  const RAIL = `(() => {
    const set = document.getElementById('dkSet'), st = document.getElementById('dkStory');
    if (!set || !st) return { found: !!st };
    const a = set.getBoundingClientRect(), b = st.getBoundingClientRect();
    return { found: true, below: b.top > a.top, sameCol: Math.abs(a.left - b.left) < 2,
             icon: (st.querySelector('.dkicon,.railicon,span') || {}).textContent || st.textContent,
             label: (st.querySelector('.lb') || {}).textContent || '', tap: Math.min(b.width, b.height) };
  })()`;
  const ROWS = `(() => {
    const rows = [...document.querySelectorAll('#dlgList .cgrow')];
    return { n: rows.length,
      locked: rows.filter((r) => r.classList.contains('locked')).length,
      lockIcon: rows.filter((r) => (r.textContent || '').includes('🔒')).length,
      playable: rows.filter((r) => r.hasAttribute('data-cg')).length,
      first: (rows[0] && rows[0].innerText || '').replace(/\\s+/g, ' ').trim(),
      title: (document.getElementById('dlgTitle') || {}).textContent || '' };
  })()`;

  /* 场景 A：新玩家（第 1 关）—— 入口在设置下面，进去应当是一排锁 */
  {
    const s = await scenario('locked', { level: 1, energy: 120, lastTs: Date.now(), sfx: true, cg: true });
    const rail = await s.ev(RAIL);
    check('首页有剧情入口 dkStory', rail.found === true, rail);
    check('剧情图标在设置图标下面、同一列', rail.below === true && rail.sameCol === true, rail);
    check('图标点击区 ≥ 40px', rail.tap >= 40, rail.tap);
    console.log('  首页截图 → ' + await s.shot('home'));
    await s.ev(`document.getElementById('dkStory').click()`);
    await sleep(400);
    const rows = await s.ev(ROWS);
    const total = await s.ev(`window.MineStory.CG.length`);
    check('图鉴列出全部 CG', rows.n === total, rows);
    check('新玩家全部锁着且每行都有锁图标', rows.locked === total && rows.lockIcon === total, rows);
    check('锁着的一个都点不了（没有 data-cg）', rows.playable === 0, rows);
    check('锁着的行写清了解锁条件', /解锁/.test(rows.first), rows.first);
    console.log('  锁态截图 → ' + await s.shot('gallery'));
    await s.close();
  }

  /* 场景 B：老玩家（第 250 关）—— 越过 0/100/200 三个触发点，应当解锁三段并能重播 */
  {
    const s = await scenario('unlocked', { level: 250, energy: 120, lastTs: Date.now(), sfx: true, cg: true });
    await s.ev(`document.getElementById('dkStory').click()`);
    await sleep(400);
    const rows = await s.ev(ROWS);
    check('第 250 关：已通关的 3 段解锁，其余仍上锁',
      rows.playable === 3 && rows.locked === rows.n - 3, rows);
    check('解锁行不再显示锁图标', rows.lockIcon === rows.locked, rows);
    console.log('  解锁态截图 → ' + await s.shot('gallery'));
    // 点第一段：弹窗必须先收掉，CG 全屏层被建出来（真的走到了 replay）
    await s.ev(`document.querySelector('#dlgList [data-cg]').click()`);
    await sleep(500);
    const after = await s.ev(`(() => ({
      dialogOpen: document.getElementById('overlay').classList.contains('show'),
      cgLayer: !!document.getElementById('cgov')
    }))()`);
    check('点重播先收弹窗', after.dialogOpen === false, after);
    check('点重播真的进了 CG 播放层', after.cgLayer === true, after);
    console.log('  重播截图 → ' + await s.shot('replay'));
    await s.close();
  }

  /* 场景 C：英文 + 老玩家 —— 这一屏是漏翻的唯一藏身处（用户实报 2026-08-29）。
     条目说明来自 CG 自己的字幕表（mine-story.js 的 SUBS），不在页面字典里，
     所以 openStory 必须先 setLang 再取数据。锁着的行不渲染字幕 ⇒
     只用新档扫英文永远扫不出这个 bug，必须种一个【已解锁】的档。 */
  {
    const s = await scenario('en', { level: 250, energy: 120, lastTs: Date.now(), sfx: true, cg: true }, 'en');
    await s.ev(`document.getElementById('dkStory').click()`);
    await sleep(400);
    const cjk = await s.ev(`(() => {
      const box = document.getElementById('dlgList');
      const bad = [];
      const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      let n; while ((n = walk.nextNode())) {
        const t = (n.nodeValue || '').trim();
        if (/[\\u4e00-\\u9fff\\u3040-\\u30ff]/.test(t)) bad.push(t.slice(0, 60));
      }
      const title = (document.getElementById('dlgTitle') || {}).textContent || '';
      if (/[\\u4e00-\\u9fff]/.test(title)) bad.push('title: ' + title);
      const body = (document.getElementById('dlgBody') || {}).textContent || '';
      if (/[\\u4e00-\\u9fff]/.test(body)) bad.push('body: ' + body);
      return { bad, sample: (box.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
               unlocked: box.querySelectorAll('[data-cg]').length };
    })()`);
    check('英文模式下图鉴真的解锁了条目（否则这一屏等于没扫）', cjk.unlocked === 3, cjk.unlocked);
    check('英文模式下图鉴零残留中文（含 CG 字幕说明）', cjk.bad.length === 0, cjk.bad);
    console.log('  英文截图 → ' + await s.shot('gallery'));
    await s.close();
  }

  ws.close();
}

main().catch((e) => { console.error(e); failures++; }).finally(() => {
  chrome.kill();
  console.log(failures === 0 ? '\nSTORY GALLERY GATE GREEN' : `\nSTORY GALLERY GATE RED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
});
