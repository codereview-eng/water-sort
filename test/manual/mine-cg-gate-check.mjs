/* mine-cg-gate-check.mjs —— 剧情 CG 触发时机与开关的真页面验收（2026-08-28）

   用户拍板的三条：
     ① 首个 CG 挂在「开始第 1 关」那一下，**不是**打开页面就播；
     ② 逢 100 关通关播一段；
     ③ 设置里要有「剧情动画」开关，关掉后一律不播。

   为什么必须真跑页面：CG 是全屏浮层 + 视频 + 本地已看记录三者接线，
   单元测试摸不到「打开页面到底有没有盖上黑幕」。

   注意 PAGE 默认指向**发布产物目录**：只有那里 cg/ 与 index.html 同级，
   资源路径才和线上一致（仓库里 cg/ 在 color-mines/ 下，直接开 mine.html 会 404）。
   用法：node scripts/build-publish-mine.mjs "..." && node test/manual/mine-cg-gate-check.mjs */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DIST = '/tmp/cm-publish-dist/index.html';
const PAGE = process.env.PAGE || ('file://' + DIST);
const PORT = 19583;
const SHOTS = '/tmp/mine-cg-shots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.env.PAGE && !existsSync(DIST)) {
  console.error('找不到发布产物 ' + DIST + '；先跑 node scripts/build-publish-mine.mjs "<label>"');
  process.exit(1);
}

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? '✔' : '✖') + ' ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

const profile = mkdtempSync(join(tmpdir(), 'cggate-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
  '--allow-file-access-from-files', 'about:blank',
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
    if (r.exceptionDetails) throw new Error('页内异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (n) => {
    const r = await S('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, n + '.png'), Buffer.from(r.data, 'base64'));
  };
  const cg = () => evalJs(`(() => {
    const ov = document.getElementById('cgov');
    const cs = ov ? getComputedStyle(ov) : null;
    return JSON.stringify({
      display: cs ? cs.display : null,
      played: window.MineStory ? window.MineStory.telemetry.played : null,
      reasons: window.MineStory ? Object.keys(window.MineStory.telemetry.reasons).join(',') : null,
      seen: (()=>{ try { return localStorage.getItem('cm.story.seen'); } catch(e){ return 'n/a'; } })(),
      gameVisible: !document.getElementById('game').hidden,
      homeVisible: !document.getElementById('home').hidden
    });
  })()`).then(JSON.parse);

  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const seed = (lv) => `try{localStorage.setItem('mine_save_v1',JSON.stringify(
    {level:${lv},clears:${lv - 1},energy:120,lastTs:Date.now(),sfx:false,cg:true,
     toolSafeGranted:30,toolSafeSpent:0,toolMineGranted:30,toolMineSpent:0}));
    localStorage.setItem('mine_lang','zh');localStorage.removeItem('cm.story.seen');}catch(e){}`;
  await S('Page.addScriptToEvaluateOnNewDocument', { source: seed(1) });
  await S('Page.navigate', { url: PAGE });
  await sleep(3200);

  /* —— ① 打开页面不许自动播 —— */
  let s = await cg();
  await shot('1-on-load');
  /* 浮层是懒创建的：没播过时 #cgov 压根不存在（display 读到 null），
     这比「存在但 display:none」更彻底 —— 两种都算没播。 */
  const notShown = (x) => !x.display || x.display === 'none';
  check('打开页面后不播 CG（黑幕不出现）', notShown(s), s);
  check('打开页面后播放计数为 0', s.played === 0, { played: s.played });
  check('停在首页，没被任何浮层接管', s.homeVisible && !s.gameVisible, s);

  /* —— ② 点「开始第 1 关」才播 —— */
  await evalJs("document.getElementById('btnStart').click()");
  let shown = false;
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    s = await cg();
    if (s.display === 'flex') { shown = true; break; }
  }
  await shot('2-after-start');
  check('点「开始第 1 关」后 CG 才播', shown && s.played === 1, s);

  /* —— ③ 跳过 ⇒ 黑幕收起并真的进了关卡 —— */
  await evalJs(`(() => { const b = document.getElementById('cgSkip')
    || [...document.querySelectorAll('#cgov button')].find(e => /跳过|Skip/.test(e.textContent||''));
    if (b) b.click(); return !!b; })()`);
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    s = await cg();
    if (s.display === 'none' && s.gameVisible) break;
  }
  await shot('3-after-skip');
  check('跳过后黑幕收起，并真的进入了关卡', s.display === 'none' && s.gameVisible, s);
  check('看过就记账，不会再重复播', !!s.seen && s.seen.indexOf('cg0') >= 0, { seen: s.seen });

  /* —— ④ 设置里有「剧情动画」开关，且文案走 i18n —— */
  await evalJs('window.__mine.home()');
  await sleep(400);
  await evalJs(`(() => { const el = document.querySelector('[data-action="settings"]');
    if (!el) throw new Error('首页找不到设置入口'); el.click(); return 1; })()`);
  await sleep(500);
  const st = await evalJs(`JSON.stringify({
    exists: !!document.getElementById('cgToggle'),
    label: (document.getElementById('cgToggleLabel')||{}).textContent,
    value: (document.getElementById('cgToggle')||{}).textContent,
    pressed: (document.getElementById('cgToggle')||{}).getAttribute
      ? document.getElementById('cgToggle').getAttribute('aria-pressed') : null
  })`).then(JSON.parse);
  await shot('4-settings');
  check('设置里有「剧情动画」开关', st.exists, st);
  check('开关文案走 i18n（中文界面显示中文标签）', st.label === '剧情动画', { label: st.label });
  check('默认是开', st.value === '开' && st.pressed === 'true', st);

  /* —— ⑤ 关掉开关 ⇒ 清掉已看记录也不再播 —— */
  await evalJs("document.getElementById('cgToggle').click()");
  await sleep(200);
  const off = await evalJs(`JSON.stringify({
    value: document.getElementById('cgToggle').textContent,
    pressed: document.getElementById('cgToggle').getAttribute('aria-pressed'),
    saved: (()=>{ try { return JSON.parse(localStorage.getItem('mine_save_v1')).cg; } catch(e){ return 'err'; } })()
  })`).then(JSON.parse);
  check('点一下变「关」，并且落盘', off.value === '关' && off.pressed === 'false' && off.saved === false, off);

  /* 不能 reload：导航会重跑 addScriptToEvaluateOnNewDocument 里的种档脚本，
     把刚关掉的开关重置成开——那是脚本自己造的假红。清掉已看记录后原地回首页再开一局。 */
  const playedBefore = (await cg()).played;
  await evalJs(`(() => { try { localStorage.removeItem('cm.story.seen'); } catch(e){}
    const x = document.querySelector('.dlgx, [aria-label*="关闭"]'); if (x) x.click(); return 1; })()`);
  await sleep(300);
  await evalJs('window.__mine.home()');
  await sleep(400);
  await evalJs("document.getElementById('btnStart').click()");
  await sleep(2500);
  s = await cg();
  await shot('5-off-no-cg');
  check('开关关掉后，即使没看过也不播', notShown(s) && s.played === playedBefore, { ...s, playedBefore });
  check('关掉后照样能正常进关卡', s.gameVisible, s);

  /* —— ⑥ 逢 100 关通关 ⇒ 播章节 CG —— */
  await S('Page.addScriptToEvaluateOnNewDocument', { source: seed(100) });
  await S('Page.navigate', { url: PAGE });
  await sleep(3000);
  await evalJs("document.getElementById('btnStart').click()");
  await sleep(1200);
  s = await cg();
  check('第 100 关开局不播 CG（首段只挂第 1 关）', notShown(s), s);
  await evalJs('window.__mine.solve()');
  let ch = false;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    s = await cg();
    if (s.display === 'flex') { ch = true; break; }
  }
  await shot('6-chapter-cg');
  check('通关第 100 关后播章节 CG', ch && s.played >= 1, s);

  await S('Target.closeTarget', { targetId });
  ws.close(); chrome.kill();
  console.log('\n截图：' + SHOTS);
  console.log(failures ? `\n${failures} 条断言未通过` : '\n全部断言通过');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
