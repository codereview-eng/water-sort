/* 幽灵安全标记回归验证（真页面 · CDP · 非 mock）
 *
 * 复现路径：单击格子 A 会起一个 DBL_MS(320ms) 的延迟计时器，到点把 A 标成「安全 ✕」。
 * 若在这期间第二次手势被取消（pointercancel / 非主指针 / 右键）或在别的格子抬手，
 * 旧代码只重置双击链、不清计时器 → 计时器照常执行 → 用户没打的标记凭空出现。
 *
 * 断言方式不依赖内部变量：直接快照格子 A 的 outerHTML，看取消手势后它有没有被改动。
 * 用法：node /tmp/mine-ghost-mark.mjs <绝对路径 mine.html>
 * 退出码 0=通过（无幽灵标记），1=检出幽灵标记，2=脚手架自身出错。
 */
const PAGE = process.argv[2];
if (!PAGE) { console.error('用法: node mine-ghost-mark.mjs <abs path to mine.html>'); process.exit(2); }

const CDP = 'http://127.0.0.1:19301';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(ws, method, params, sessionId) {
  const id = rpc.n = (rpc.n || 0) + 1;
  const msg = JSON.stringify({ id, method, params: params || {}, sessionId });
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.id !== id) return;
      ws.removeEventListener('message', onMsg);
      d.error ? reject(new Error(method + ': ' + d.error.message)) : resolve(d.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(msg);
    setTimeout(() => { ws.removeEventListener('message', onMsg); reject(new Error(method + ' 超时')); }, 30000);
  });
}

/* 在页面里跑：合成真实 PointerEvent 序列（走完整事件处理链路，不打桩任何函数） */
const SCENARIO = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const cells = () => Array.from(document.querySelectorAll('#board [data-idx]'));

  // 进关：首页 -> 第 1 关
  if (!q('#game') || q('#game').hidden) {
    const btn = q('#btnStart');
    if (!btn) return { ok: false, err: '找不到开始按钮' };
    btn.click();
    await sleep(300);
  }
  const cs = cells();
  if (cs.length < 2) return { ok: false, err: '棋盘格子不足: ' + cs.length };

  const A = cs[0], B = cs[1];
  const pt = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const fire = (el, type, extra) => {
    const p = pt(el);
    el.dispatchEvent(new PointerEvent(type, Object.assign({
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: p.x, clientY: p.y
    }, extra || {})));
  };

  const results = [];

  // --- 场景 1：第二次手势在别的格子抬手（用户「滑走取消」） ---
  const beforeA1 = A.outerHTML;
  fire(A, 'pointerdown'); fire(A, 'pointerup');        // 第一次单击 -> 起 320ms 计时器
  await sleep(60);
  fire(A, 'pointerdown');                              // 第二次按下 A
  fire(B, 'pointerup');                                // 却在 B 抬手 = 放弃这次点击
  await sleep(1200);                                   // 远超 320ms，让 pending 计时器有机会执行
  results.push({ name: '滑走取消', ghost: A.outerHTML !== beforeA1 });

  // --- 场景 2：pointercancel（系统抢走手势，如来电/滚动接管） ---
  const C = cells()[2] || cells()[0];
  const beforeC = C.outerHTML;
  fire(C, 'pointerdown'); fire(C, 'pointerup');
  await sleep(60);
  fire(C, 'pointerdown');
  fire(C, 'pointercancel');
  await sleep(1200);
  results.push({ name: '手势被系统取消', ghost: C.outerHTML !== beforeC });

  return { ok: true, results };
})()`;

(async () => {
  const ver = await (await fetch(CDP + '/json/version')).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });

  // 只开自己的 tab（background 建，避免抢用户前台；用完只关自己这个 tab）
  const { targetId } = await rpc(ws, 'Target.createTarget', { url: 'about:blank', background: true });
  const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true });
  let code = 0;
  try {
    await rpc(ws, 'Page.enable', {}, sessionId);
    await rpc(ws, 'Runtime.enable', {}, sessionId);
    await rpc(ws, 'Page.navigate', { url: 'file://' + PAGE }, sessionId);
    await sleep(2500);

    const r = await rpc(ws, 'Runtime.evaluate',
      { expression: SCENARIO, awaitPromise: true, returnByValue: true }, sessionId);
    const out = r.result && r.result.value;
    if (!out || !out.ok) { console.error('脚手架失败:', (out && out.err) || JSON.stringify(r).slice(0, 300)); code = 2; }
    else {
      for (const s of out.results) console.log((s.ghost ? '✗ 检出幽灵标记' : '✓ 无幽灵标记') + ' — ' + s.name);
      code = out.results.some((s) => s.ghost) ? 1 : 0;
      console.log(code === 0 ? '结论: PASS（取消手势后格子未被改动）' : '结论: FAIL（取消手势后仍出现标记）');
    }
  } catch (err) {
    console.error('异常:', err.message); code = 2;
  } finally {
    try { await rpc(ws, 'Target.closeTarget', { targetId }); } catch {}
    ws.close();
  }
  process.exit(code);
})();
