/* 单栏身份行渲染真验（CDP 真页面）：
 * 断言 ①身份行存在且可见 ②名字非空 ③旧两栏锚点彻底消失 ④无本地改名入口 ⑤无 JS 异常。
 * 用法：node /tmp/identity-render-check.mjs <abs page.html>
 */
const PAGE = process.argv[2];
if (!PAGE) { console.error('用法: node identity-render-check.mjs <abs path>'); process.exit(2); }
const CDP = 'http://127.0.0.1:19301';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(ws, method, params, sessionId) {
  const id = rpc.n = (rpc.n || 0) + 1;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.id !== id) return;
      ws.removeEventListener('message', onMsg);
      d.error ? reject(new Error(method + ': ' + d.error.message)) : resolve(d.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
    setTimeout(() => { ws.removeEventListener('message', onMsg); reject(new Error(method + ' 超时')); }, 30000);
  });
}

const PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const row = q('#btnIdentity');
  const name = q('#idName');
  const sub = q('#idSub');
  const html = document.documentElement.innerHTML;
  return {
    identityRow: !!row,
    rowVisible: !!(row && row.offsetParent !== null),
    name: name ? (name.textContent || '').trim() : null,
    sub: sub ? (sub.textContent || '').trim() : null,
    state: row ? row.dataset.state : null,
    legacyBtnProfile: !!q('#btnProfile'),
    legacyBtnAccount: !!q('#btnAccount'),
    legacyProfileRow: document.querySelectorAll('.profilerow').length,
    hasPromptRename: /window\\.prompt\\s*\\(/.test(html)
  };
})()`;

(async () => {
  const ver = await (await fetch(CDP + '/json/version')).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const { targetId } = await rpc(ws, 'Target.createTarget', { url: 'about:blank', background: true });
  const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  let code = 0;
  try {
    await rpc(ws, 'Runtime.enable', {}, sessionId);
    await rpc(ws, 'Log.enable', {}, sessionId);
    ws.addEventListener('message', (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.method === 'Runtime.exceptionThrown') {
        errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
      }
      if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push(d.params.entry.text);
    });
    await rpc(ws, 'Page.enable', {}, sessionId);
    await rpc(ws, 'Page.navigate', { url: 'file://' + PAGE }, sessionId);
    await sleep(3000);
    const r = await rpc(ws, 'Runtime.evaluate', { expression: PROBE, returnByValue: true }, sessionId);
    const v = r.result.value;
    const checks = [
      ['身份行存在', v.identityRow],
      ['身份行可见', v.rowVisible],
      ['名字非空', !!v.name],
      ['状态副标题非空', !!v.sub],
      ['旧锚点 btnProfile 已消失', !v.legacyBtnProfile],
      ['旧锚点 btnAccount 已消失', !v.legacyBtnAccount],
      ['无本地改名 window.prompt', !v.hasPromptRename],
      ['无 JS 异常', errors.length === 0]
    ];
    for (const [n, ok] of checks) { console.log((ok ? '✓ ' : '✗ ') + n); if (!ok) code = 1; }
    console.log('渲染值:', JSON.stringify({ name: v.name, sub: v.sub, state: v.state, profilerowCount: v.legacyProfileRow }, null, 0));
    if (errors.length) console.log('异常:', errors.slice(0, 3));
  } catch (e) { console.error('脚手架异常:', e.message); code = 2; }
  finally { try { await rpc(ws, 'Target.closeTarget', { targetId }); } catch {} ws.close(); }
  process.exit(code);
})();
