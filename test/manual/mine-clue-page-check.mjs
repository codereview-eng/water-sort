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
/* 默认验本地文件；发布后把 PAGE 指到线上 URL 就是同一套断言的线上复验：
   PAGE=https://play-color-mines.run.ceo/ node test/manual/mine-clue-page-check.mjs 12 */
const PAGE = process.env.PAGE || ('file://' + join(process.cwd(), 'mine.html'));
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
      {level:${LEVEL},toolSafeGranted:400,toolSafeSpent:0,toolMineGranted:0,toolMineSpent:0}));
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
  /* 双击判定对时序敏感：线上（https + SDK 初始化）比 file:// 慢，固定睡眠会把
     一次双击判成两次单击 —— 那样只会打上再取消一个 ✕，found 永远不动。
     所以不再盲等：轮询 found，没中就先清掉误打的 ✕ 再补一次，最多三轮。 */
  const digTarget = async () => {
    for (let w = 0; w < 12; w++) {
      await sleep(180);
      st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
      if (st.found.includes(target)) return true;
    }
    return false;
  };
  let dug = await digTarget();
  for (let attempt = 0; !dug && attempt < 2; attempt++) {
    if (st.marks && st.marks.includes(target)) await evalJs(`window.__mine.mark(${target})`);
    await sleep(200);
    await evalJs(`(function(){
      var el = document.querySelector('.cell[data-idx="${target}"]');
      var r = el.getBoundingClientRect(), x = r.left + r.width/2, y = r.top + r.height/2;
      function tap(){
        var o = {bubbles:true, cancelable:true, isPrimary:true, pointerId:1, button:0, clientX:x, clientY:y};
        el.dispatchEvent(new PointerEvent('pointerdown', o));
        document.dispatchEvent(new PointerEvent('pointerup', o));
      }
      tap(); setTimeout(tap, 45);
    })()`);
    dug = await digTarget();
  }
  await shot('2-after-dig');
  check('照着线索双击就挖出了雷（没扣血）', dug && st.lives >= 1,
    { found: st.found.length, lives: st.lives, marks: st.marks });
  check('落子后线索高亮退场', st.clue === null || st.clue.idx !== target, { clue: st.clue });

  /* —— 场景 4：把标记打在真雷上 → 道具**不许**判玩家标错（owner 拍板 2026-08-29）：
     标记是多义的，打在雷上完全可能是「我怀疑这儿有雷」，线索只管继续指下一颗雷 —— */
  const wrong = mines.find((i) => !st.found.includes(i));
  await evalJs(`window.__mine.mark(${wrong})`);
  await sleep(200);
  await evalJs("document.getElementById('toolSafe').click()");
  await sleep(400);
  st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
  bar = await evalJs(`JSON.stringify({title:document.getElementById('clueTitle').textContent,
    why:document.getElementById('clueWhy').textContent,ic:document.getElementById('clueIc').textContent})`).then(JSON.parse);
  await shot('3-marked-mine');
  check('不再把标记判成「标错」', st.clue && st.clue.why !== 'markwrong', { clue: st.clue, wrong });
  check('线索仍指向一颗真雷', st.clue && mines.includes(st.clue.idx), { clue: st.clue, wrong });
  check('文案里没有「标错」字样', !/标错/.test(bar.title + bar.why), bar);

  /* —— 场景 5：分步讲解（2026-08-27 修 RCA 后新增）——
     用户实报：线索指了一格「必定是雷」，可组里明明还有好几格没排除，提示只解释了正确的那个。
     修法是把引擎的排除记账（ruled/pending）逐步讲出来，并把已排除的格画成第三种态。
     这里验的是真 DOM：步骤条、三种高亮的数量、按钮文案、以及「不许再谎称其它格都排除了」。 */
  await evalJs('window.__mine.start()');
  await sleep(700);
  st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
  let stepClue = null;
  for (let k = 0; k < 14 && !stepClue; k++) {
    await evalJs("document.getElementById('toolSafe').click()");
    await sleep(300);
    st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
    if (!st.clue) break;
    if (st.clue.ruled && st.clue.ruled.length >= 1) { stepClue = st.clue; break; }
    await evalJs(`window.__mine.dig(${st.clue.idx})`);
    await sleep(220);
    st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
    if (st.done) break;
  }
  check('能拿到一条带排除理由的线索（否则本场景空转）', !!stepClue, { clue: st.clue });

  if (stepClue) {
    const readBar = () => evalJs(`JSON.stringify({
      step:document.getElementById('clueStep').textContent,
      title:document.getElementById('clueTitle').textContent,
      why:document.getElementById('clueWhy').textContent,
      act:document.getElementById('clueAct').textContent,
      ok:document.getElementById('clueOk').textContent,
      line:document.querySelectorAll('.cell.clueline').length,
      ruled:document.querySelectorAll('.cell.clueruled').length,
      cur:document.querySelectorAll('.cell.cluestep').length,
      pend:document.querySelectorAll('.cell.cluepend').length,
      spot:document.querySelectorAll('.cell.cluespot').length,
      group:document.querySelectorAll('.cell.cluegroup').length})`).then(JSON.parse);

    const total = stepClue.ruled.reduce((n, r) => n + r.cells.length, 0);
    bar = await readBar();
    await shot('5-step-1');
    check('第一步是「这几格可以排掉」而不是直接给结论',
      /排掉/.test(bar.title) && bar.act === '', bar);
    /* 讲解途中焦点必须唯一：组的橙框留到结论步再铺，否则一片橙会压过当前这一步的绿高亮 */
    check('讲解途中不铺组的橙框（焦点唯一）', bar.group === 0, bar);
    check('步骤条显示进度（第 1/N 步）', /1\s*\/\s*\d/.test(bar.step.replace(/\s/g, ' ')), bar);
    check('第一步只点亮这一步要讲的格', bar.cur === stepClue.ruled[0].cells.length,
      { cur: bar.cur, expect: stepClue.ruled[0].cells.length });
    check('第一步的理由没有未替换的占位符', /\S/.test(bar.why) && !/\{[a-z]+\}/i.test(bar.why), bar);
    check('按钮是「下一步」而不是「明白了」', /下一步/.test(bar.ok), bar);
    /* 理由说「第 N 行」时，那一整行必须被点亮 —— 棋盘没有行号，玩家不该自己数
       （四位独立视觉评审各自都提了这一条，2026-08-28 补） */
    /* 新口径（用户拍板 2026-08-28）：文案不再报行号，改用指示词「这一行/这一列」，
       由画面负责定位 —— 所以断言反过来：① 文案里不许再出现「第 N 行/列」；
       ② 一旦说了「这一行/这一列」，那一整条就必须真的被点亮。 */
    check('讲解文案不再报行号（画面负责定位）', !/第\s*\d+\s*(行|列)/.test(bar.why), { why: bar.why });
    const deixis = /(这一行|这一列)/.test(bar.why);
    check('说了「这一行/这一列」，那一整条就必须真的点亮',
      !deixis || bar.line === st.size, { why: bar.why, line: bar.line, size: st.size });
    /* 光有 class 不算数：CSS 没落地时 class 照样在，而画面上什么都看不见
       （视觉评审实测「看不到贯通亮边」）。这里断言真实计算样式确实可见。 */
    const lineStyle = await evalJs(`(()=>{const e=document.querySelector('.cell.clueline');
      if(!e)return null; const a=getComputedStyle(e,'::after'), c=getComputedStyle(e);
      return {w:c.width, bt:a.borderTopWidth, bb:a.borderBottomWidth, bg:a.backgroundColor, content:a.content};})()`);
    check('行高亮不是空 class：伪元素真的有可见的边与底色',
      !!lineStyle && parseFloat(lineStyle.bt) >= 2 && /rgba?\(/.test(lineStyle.bg), lineStyle);

    for (let s = 1; s < stepClue.steps; s++) {
      await evalJs("document.getElementById('clueOk').click()");
      await sleep(260);
    }
    bar = await readBar();
    st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
    await shot('5-step-final');
    check('走到最后一步：结论 + 落子动作都在', /\S/.test(bar.title) && /双击|Double/.test(bar.act), bar);
    check('最后一步按钮变回「明白了」', /明白/.test(bar.ok), bar);
    check('结论步把目标格聚光', bar.spot === 1, bar);
    /* v6 起 ruled 是整条推理链（沿途排掉的格可能散落全盘）。结论步只画**结论组内**那些格：
       结论那句话讲的就是这一组，混进别的颜色会让文案与画面自相矛盾（下面那条同色断言就是为此立的）。
       所以这里改验：结论组里、玩家自己没排掉的每一格，都必须被画成「已排除」——一格都不许沉默。 */
    const inGroup = new Set(stepClue.ruled.flatMap((r) => r.cells)
      .filter((c) => (stepClue.groupCells || []).includes(c)));
    const expectRuled = (stepClue.groupCells || []).length
      ? inGroup.size
      : stepClue.ruled.reduce((n, r) => n + r.cells.length, 0);
    check('结论组里讲过的格都画成「已排除」态，且没有残留的「当前步」高亮',
      bar.ruled === expectRuled && bar.cur === 0,
      { ruled: bar.ruled, expectRuled, chainCells: total, cur: bar.cur });
    check('还排不掉的格单独标出来（不再混在候选里）', bar.pend === stepClue.pending.length,
      { pend: bar.pend, expect: stepClue.pending.length });
    check('pending 为空时不许再说「要联立」', stepClue.pending.length > 0 || !/联立/.test(bar.why), bar);

    /* 文案自证的 ground truth：结论说「这个色块其它格都排除了」，那画面上
       目标格与被排除格就必须**真的是同一个色块**（同底色）。视觉评审 2026-08-27
       实测怀疑「目标格浅蓝、被排除格发紫」，这条断言把它钉死成可验事实。 */
    const colors = await evalJs(`JSON.stringify({
      spot:getComputedStyle(document.querySelector('.cell.cluespot')).backgroundColor,
      ruled:[...document.querySelectorAll('.cell.clueruled')].map(e=>getComputedStyle(e).backgroundColor)})`).then(JSON.parse);
    const sameBlock = colors.ruled.every((c) => c === colors.spot);
    check('结论说「这个色块」时，被排除的格与目标格底色必须一致（否则文案在画面上自相矛盾）',
      !/色块/.test(bar.why) || sameBlock, colors);
    check('pending 非空时必须明说排不掉，不许谎称「其它格都排除了」',
      stepClue.pending.length === 0 || !/其它格都排除/.test(bar.why), bar);
    check('落子后整条线索连同三种高亮一起退场', true, {});
    await evalJs(`window.__mine.dig(${stepClue.idx})`);
    await sleep(300);
    bar = await readBar();
    check('落子后盘面残留高亮清零',
      bar.ruled === 0 && bar.cur === 0 && bar.pend === 0 && bar.spot === 0 && bar.group === 0, bar);
  }

  /* —— 场景 6：连续用道具推进，看它会不会原地打转 —— */
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

  /* —— 场景 7：讲不出理由的兜底提示，必须先给范围、答案由玩家自己点才揭晓 ——
     用户实报 2026-08-29（第 11 关截图）：「这个提示无端端就给出了最终答案，不理解」。
     所以这里验的不是文案好不好听，而是**揭晓这个动作有没有交回玩家手里**：
     范围步里答案格不许带 cluespot，点了「直接告诉我」之后才允许出现。 */
  /* v6（owner 2026-08-29）：一次道具 = 一条推理链，一路推到一颗雷；链上可能有反证步。
     所以这里改验：链上的反证步必须把「矛盾是什么」讲出来，最后一步必须是结论「这一格是雷」。 */
  let refuted = null;
  await evalJs("var b=document.getElementById('dlgMain'); if(b) b.click();");
  await sleep(500);
  await evalJs('window.__mine.start()');   // 上面的场景已经把这一关打穿了，换一局再找反证
  await sleep(600);
  for (let lap = 0; lap < 14 && !refuted; lap++) {
    await evalJs("document.getElementById('toolSafe').click()");
    await sleep(320);
    st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
    if (!st.clue) break;
    if ((st.clue.ruled || []).some((r) => r.rule === 'refute')) { refuted = st.clue; break; }
    await evalJs(`window.__mine.dig(${st.clue.idx})`);
    await sleep(220);
    st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
    if (st.done) { await evalJs("var b=document.getElementById('dlgMain'); if(b) b.click();"); await sleep(600); }
  }
  check('线索是一条多步推理链（不是单蹦一条结论）', !!refuted && (refuted.ruled || []).length >= 1,
    { steps: refuted && refuted.steps, ruled: refuted && (refuted.ruled || []).length });
  if (refuted) {
    const texts = [];
    for (let s = 0; s < 20; s++) {
      const bar = await evalJs(`JSON.stringify({title:document.getElementById('clueTitle').textContent,
        why:document.getElementById('clueWhy').textContent,ok:document.getElementById('clueOk').textContent,
        step:document.getElementById('clueStep').textContent})`).then(JSON.parse);
      texts.push(bar);
      if (bar.ok !== '下一步') break;
      await evalJs("document.getElementById('clueOk').click()");
      await sleep(180);
    }
    await shot('7-chain');
    const refuteBar = texts.find((b) => /假设/.test(b.why));
    check('链上的反证步把矛盾讲出来了', !!refuteBar && /矛盾/.test(refuteBar.why), { bar: refuteBar });
    check('反证文案没有未替换的占位符', !refuteBar || !/\{[a-z]+\}/i.test(refuteBar.why), { bar: refuteBar });
    check('每一步都带「第 i/N 步」进度', texts.every((b) => /第\s*\d+\s*\/\s*\d+\s*步/.test(b.step)), { first: texts[0] });
    check('最后一步是结论「这一格必定是雷」', /必定是雷|要联立/.test(texts[texts.length - 1].title),
      { last: texts[texts.length - 1] });

    /* 用户实报 2026-08-29：「推理过程标记不是雷的都需要保留下来，现在推理过程结束了，
       所有的标记都自动消失了」。所以讲过的排除必须落成玩家自己的 ✕，线索退场也不能带走。 */
    const chainCells = (refuted.ruled || []).flatMap((r) => r.cells);
    await evalJs("document.getElementById('clueOk').click()");   // 结论步点「明白了」= 线索退场
    await sleep(300);
    const kept = await evalJs(`JSON.stringify((function(){
      var st = window.__mine.state(), cells = ${JSON.stringify(chainCells)};
      var inMarks = cells.filter(function(c){ return st.marks.indexOf(c) >= 0; }).length;
      var painted = cells.filter(function(c){
        var el = document.querySelector('.cell[data-idx="' + c + '"]');
        return el && el.classList.contains('safe');
      }).length;
      var leftover = document.querySelectorAll('.cell.clueruled,.cell.cluestep,.cell.cluegroup').length;
      return { total: cells.length, inMarks: inMarks, painted: painted, leftover: leftover };
    })())`).then(JSON.parse);
    await shot('8-marks-kept');
    check('推理排掉的格全部留成了玩家的 ✕（存进 marks）', kept.inMarks === kept.total, kept);
    check('这些 ✕ 在盘面上真的还画着', kept.painted === kept.total, kept);
    check('线索本身的临时高亮已经退场（只留 ✕）', kept.leftover === 0, kept);
  }

  let ranged = null;
  /* 兜底提示基本出现在**残局**（大多数雷已找到、局部规则彻底跑死的时候），
     所以这里必须允许一路推到通关；打穿了就点「下一关」继续找，
     绝不能把通关弹窗晾着 —— 它会盖住棋盘，让截图证据作废（2026-08-29 实测踩过）。 */
  const clearDialog = async () => {
    const open = await evalJs("document.getElementById('overlay').classList.contains('show')"
      + " || !document.getElementById('overlay').hidden");
    if (open === 'true' || open === true) {
      await evalJs("var b=document.getElementById('dlgMain'); if(b) b.click();");
      await sleep(600);
    }
  };
  for (let lv = 0; lv < 8 && !ranged; lv++) {
    await clearDialog();
    await sleep(400);
    for (let k = 0; k < 10 && !ranged; k++) {
      await evalJs("document.getElementById('toolSafe').click()");
      await sleep(280);
      st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
      if (!st.clue) break;
      if (st.clue.why === 'enum') { ranged = st.clue; break; }
      await evalJs(`window.__mine.dig(${st.clue.idx})`);
      await sleep(220);
      st = await evalJs('JSON.stringify(window.__mine.state())').then(JSON.parse);
      if (st.done) { await clearDialog(); break; }
    }
  }
  /* v6 之后兜底层几乎不再出现（实测 40 关只剩 1.9%），撞不到不算失败；
     但只要撞到了，「先给范围、答案由玩家点」这套仍然必须成立。 */
  if (!ranged) console.log('· 本轮没撞到兜底提示（v6 后正常，跳过范围步断言）');

  if (ranged) {
    /* 一路点到范围步：讲得清的步骤按钮是「下一步」，范围步的按钮换成「直接告诉我」 */
    let bar7 = null;
    for (let s = 0; s < 12; s++) {
      bar7 = await evalJs(`JSON.stringify({
        title:document.getElementById('clueTitle').textContent,
        why:document.getElementById('clueWhy').textContent,
        ok:document.getElementById('clueOk').textContent,
        ic:document.getElementById('clueIc').textContent,
        spot:document.querySelectorAll('.cell.cluespot').length,
        range:document.querySelectorAll('.cell.cluerange').length,
        crossed:document.querySelectorAll('.cell.cluerange.cluestep,.cell.cluerange.clueruled').length,
        step:document.querySelectorAll('.cell.cluestep').length})`).then(JSON.parse);
      if (bar7.ok !== '下一步') break;
      await evalJs("document.getElementById('clueOk').click()");
      await sleep(200);
    }
    await shot('5-range-step');
    check('兜底提示先给范围，而不是直接甩答案', bar7.title === '先给范围', bar7);
    check('范围步不许点亮答案格（揭晓是玩家的决定）', bar7.spot === 0, bar7);
    check('范围步要把候选格整片点亮（至少 2 格）', bar7.range >= 2, bar7);
    /* 候选格绝不能画成 ✕：那是「已排除」的语义，与「雷就在这几格里」正好相反
       （2026-08-29 真页面截图当场逮到复用 .cluestep 的这个错） */
    check('范围候选格不许画成已排除的 ✕', bar7.crossed === 0 && bar7.step === 0, bar7);
    check('范围步的按钮是「直接告诉我」', bar7.ok === '直接告诉我', bar7);
    check('范围文案说清了它讲不出道理', /没法一步步讲清/.test(bar7.why), bar7);
    /* 必须写明「只有一格是雷、其余安全」：不写清就会被读成「这几格都是雷」
       （独立视觉评审 2026-08-29 的最伤问题就是这个误读） */
    check('范围文案必须写明是 N 选 1，而不是这几格都危险', /只有一格是雷/.test(bar7.why), bar7);
    /* 文案不许承诺画面上不存在的操作（曾写「想自己想就关掉这条」，可提示条上根本没有 ✕） */
    check('范围文案不许承诺不存在的「关掉」控件', !/关掉这条/.test(bar7.why), bar7);

    await evalJs("document.getElementById('clueOk').click()");
    await sleep(250);
    const after = await evalJs(`JSON.stringify({
      title:document.getElementById('clueTitle').textContent,
      spot:document.querySelectorAll('.cell.cluespot').length,
      idxSpot:!!document.querySelector('.cell[data-idx="${ranged.idx}"].cluespot')})`).then(JSON.parse);
    await shot('6-revealed');
    check('点了「直接告诉我」才揭晓答案格', after.spot === 1 && after.idxSpot, after);
  }

  await S('Target.closeTarget', { targetId });
  ws.close();
  chrome.kill();
  console.log(`\n截图：${SHOTS}`);
  console.log(failures ? `\n${failures} 条断言未通过` : '\n全部断言通过');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
