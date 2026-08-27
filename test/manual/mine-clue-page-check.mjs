/* mine-clue-page-check.mjs —— 「找线索」v2 的真页面验收（2026-08-27）
   纯函数单测挡不住「HTML 接线读错字段 / 文案键写错 / 道具白扣」这类问题，
   所以这一条走真实 DOM：起一个**独立** headless Chrome（不碰 chrome-cu-1/2/3），
   file:// 打开 mine.html，真点按钮、真读 clueBar 文案、真查 __mine.state()。

   用法：node test/manual/mine-clue-page-check.mjs [关卡]
   产出：/tmp/mine-clue-shots/*.png + 逐条断言结果 */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const LEVEL = Number(process.argv[2] || 12);
const PORT = 19556;
const SHOTS = '/tmp/mine-clue-shots';
const PAGE = 'file://' + join(process.cwd(), 'mine.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? '✔ ' : '✖ ') + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) failures++;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'mine-clue-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--user-data-dir=' + dir,
    '--remote-debugging-port=' + PORT, 'about:blank',
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
    catch { await sleep(250); }
  }
  if (!ver) { chrome.kill(); throw new Error('headless Chrome 没起来'); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const waiting = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  };
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const mid = ++id;
    waiting.set(mid, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const evalJs = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页内异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await S('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  };

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  /* 存档种子：道具管够 + 直接落在目标关（体力/金币走默认） */
  await S('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('mine_save_v1',JSON.stringify(
      {level:${LEVEL},toolSafeGranted:30,toolSafeSpent:0,toolMineGranted:0,toolMineSpent:0}));
      localStorage.setItem('mine_lang','zh');}catch(e){}`,
  });
  await S('Page.navigate', { url: PAGE });
  await sleep(2500);

  await evalJs('window.__mine.start()');
  await sleep(600);
  let st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
  check('关卡已开始', !!st && st.lv === LEVEL, { lv: st && st.lv, size: st && st.size });
  const mines = st.mines;

  /* —— 场景 1：开局直接点「找线索」 —— */
  const stockBefore = await evalJs("document.getElementById('cntSafe').textContent");
  await evalJs("document.getElementById('toolSafe').click()");
  await sleep(400);
  st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
  let bar = await evalJs(`JSON.stringify({hidden:document.getElementById('clueBar').hidden,
    title:document.getElementById('clueTitle').textContent,
    why:document.getElementById('clueWhy').textContent,
    act:document.getElementById('clueAct').textContent,
    spot:!!document.querySelector('.cell.cluespot'),
    group:document.querySelectorAll('.cell.cluegroup').length})`).then(JSON.parse);
  await shot('1-clue-shown');
  check('线索条弹出来了', bar.hidden === false && bar.title.length > 0, bar);
  check('线索指的是真雷', st.clue && mines.includes(st.clue.idx), { clue: st.clue });
  check('理由文案不是占位符/空串', /\S/.test(bar.why) && !/\{[a-z]\}/i.test(bar.why) && !/^clue/i.test(bar.why), bar.why);
  check('落子动作单独一行且说清是双击', /双击/.test(bar.act) && !/双击/.test(bar.why), { why: bar.why, act: bar.act });
  check('高亮了目标格', bar.spot === true);
  const stockAfter = await evalJs("document.getElementById('cntSafe').textContent");
  check('用掉一次道具', Number(stockBefore) - Number(stockAfter) === 1, { stockBefore, stockAfter });

  /* —— 场景 2：线索还没落子就再点一次 → 不许再扣道具 —— */
  await evalJs("document.getElementById('toolSafe').click()");
  await sleep(300);
  const stockAgain = await evalJs("document.getElementById('cntSafe').textContent");
  check('线索还挂着时重复点击不再扣道具', stockAgain === stockAfter, { stockAfter, stockAgain });

  /* —— 场景 3：照着提示双击 → 真的挖出一颗雷 —— */
  const target = st.clue.idx;
  await evalJs(`(function(){
    var el = document.querySelector('.cell[data-idx="${target}"]');
    var r = el.getBoundingClientRect(), x = r.left + r.width/2, y = r.top + r.height/2;
    function tap(){
      var o = {bubbles:true, cancelable:true, isPrimary:true, pointerId:1, button:0, clientX:x, clientY:y};
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      document.dispatchEvent(new PointerEvent('pointerup', o));
    }
    tap(); setTimeout(tap, 60);
  })()`);
  await sleep(900);
  st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
  await shot('2-after-dig');
  check('照着线索双击就挖出了雷（没扣血）', st.found.includes(target) && st.lives >= 1, { found: st.found.length, lives: st.lives });
  check('落子后线索高亮退场', st.clue === null || st.clue.idx !== target, { clue: st.clue });

  /* —— 场景 4：把 ✕ 打在真雷上 → 道具必须先纠正这个错标 —— */
  const wrong = mines.find((i) => !st.found.includes(i));
  await evalJs(`window.__mine.mark(${wrong})`);
  await sleep(200);
  await evalJs("document.getElementById('toolSafe').click()");
  await sleep(400);
  st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
  bar = await evalJs(`JSON.stringify({title:document.getElementById('clueTitle').textContent,
    why:document.getElementById('clueWhy').textContent,ic:document.getElementById('clueIc').textContent})`).then(JSON.parse);
  await shot('3-markwrong');
  check('错标的 ✕ 被当成最高优先级线索指出来', st.clue && st.clue.idx === wrong && st.clue.why === 'markwrong', { clue: st.clue, wrong });
  check('错标文案说的是「标错了」而不是「安全」', /标错/.test(bar.title), bar);

  /* —— 场景 5：连续用道具推进，看它会不会原地打转 —— */
  const seen = new Set();
  let repeats = 0, wrongPick = 0;
  for (let k = 0; k < 8; k++) {
    await evalJs("document.getElementById('toolSafe').click()");
    await sleep(250);
    st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
    if (!st.clue) break;
    if (seen.has(st.clue.idx)) repeats++;
    seen.add(st.clue.idx);
    if (!mines.includes(st.clue.idx)) wrongPick++;
    await evalJs(`window.__mine.dig(${st.clue.idx})`);
    await sleep(200);
    st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
    if (st.done) break;
  }
  await shot('4-after-8-clues');
  check('连用 8 次不重复指同一格', repeats === 0, { repeats, unique: seen.size });
  check('连用 8 次每一条都指真雷', wrongPick === 0, { wrongPick });
  check('确实在推进（已找到的雷变多了）', st.found.length >= Math.min(mines.length, seen.size), { found: st.found.length, used: seen.size });

  await S('Target.closeTarget', { targetId });
  ws.close();
  chrome.kill();
  console.log(`\n截图：${SHOTS}`);
  console.log(failures ? `\n${failures} 条断言未通过` : '\n全部断言通过');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
