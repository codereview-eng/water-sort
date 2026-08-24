#!/usr/bin/env node
/* 运行时多语言 gate：把游戏切到英文，逐屏扫「可见文本 + title/aria-label/placeholder」里的
   中日韩字符，有残留就非零退出。
   为什么需要它：静态字典对等（i18n-parity.test.js）拦不住两类漏译——
     ① 存档里的旧数据（如系统默认名把生成时的中文字面量落盘）；
     ② 渲染时才拼出来的文案 / 属性。
   本仓实报（2026-08-21）「英文时顶部还显示中文」就是第 ① 类。

   用法：
     node scripts/i18n-cjk-scan.mjs                 # 扫 water + mine（默认 file://）
     node scripts/i18n-cjk-scan.mjs --game water    # 只扫一个
     node scripts/i18n-cjk-scan.mjs --url https://play-water-sort.run.ceo/   # 扫线上
     CDP=127.0.0.1:19301 node scripts/i18n-cjk-scan.mjs
   退出码：0 = 干净；1 = 有残留中文；2 = 没有可用的 Chrome 调试端口（CI 里视为 skip，
   由调用方决定是否放行——绝不静默当成绿）。 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.CDP || '127.0.0.1:19301';
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const only = arg('--game');
const urlOverride = arg('--url');
// 允许的例外：排行榜里的机器人玩家名（模拟别的玩家，真实榜单本就中英混杂；改动需产品点头）
const ALLOW = [/棋士老周/, /数独萌新/, /一盘就跑/];

function rpc(ws, id, method, params) {
  return new Promise((res, rej) => {
    const onMsg = (ev) => { const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', onMsg); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
    ws.addEventListener('message', onMsg); ws.send(JSON.stringify({ id, method, params }));
  });
}
/* 点真实入口；找不到就抛错（切屏失败会被上层记成红，不再静默跳过） */
const click = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)});`
  + ` if (!el) throw new Error('找不到入口 ' + ${JSON.stringify(sel)}); el.click(); return 1; })()`;

const SCAN = `(() => {
  const CJK = /[\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af]/;
  const out = [];
  const path = (el) => { const p = []; let n = el;
    while (n && n.nodeType === 1 && p.length < 4) {
      p.unshift(n.id ? '#' + n.id : n.tagName.toLowerCase() +
        (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/)[0] : ''));
      n = n.parentElement; }
    return p.join('>'); };
  const vis = (el) => { const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) {
    const txt = (n.nodeValue || '').trim();
    if (!txt || !CJK.test(txt)) continue;
    const el = n.parentElement; if (!el || !vis(el)) continue;
    if (el.closest('#gameConfig') || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    out.push({ kind: 'text', where: path(el), txt: txt.slice(0, 60) });
  }
  document.querySelectorAll('[title],[aria-label],[placeholder]').forEach((el) => {
    ['title', 'aria-label', 'placeholder'].forEach((a) => {
      const v = el.getAttribute(a);
      if (v && CJK.test(v)) out.push({ kind: a, where: path(el), txt: v.slice(0, 60) });
    });
  });
  return out;
})()`;

async function scanGame(bws, game) {
  const base = urlOverride || `file://${ROOT}/${game}.html`;
  const { targetId } = await rpc(bws, Math.floor(Math.random() * 1e6), 'Target.createTarget',
    { url: `${base}?lang=en`, background: true, newWindow: true });
  const list = await (await fetch(`http://${HOST}/json/list`)).json();
  const t = list.find((x) => x.id === targetId);
  const pws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => pws.addEventListener('open', r));
  let id = 100;
  const ev = async (expr) => {
    const r = await rpc(pws, id++, 'Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || 'throw' };
    return r.result.value;
  };
  await rpc(pws, id++, 'Emulation.setDeviceMetricsOverride',
    { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  /* 就绪判定，不用固定 sleep：首页入口渲染出来 + 静态文案回填跑完，才开始扫。
     2026-08-21 教训：本地 file:// 秒开，线上要连平台 SDK，固定 1.6s 会扫到「还没回填」的
     骨架默认值，报一堆假缺口（也会让后面的换屏找不到入口）。 */
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const ok = await ev(`(() => {
      // 判据：首页开始按钮已渲染且自带文案 —— 说明首页模块渲染完、i18n 也生效了。
      // （别用活动页的返回键：那一屏还没打开，文案自然是空的，会误判成永远不就绪）
      const entry = document.querySelector('.bigbtn, #btnStart');
      return !!entry && (entry.textContent || '').trim().length > 0;
    })()`);
    if (ok === true) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) {
    console.error(`[i18n-scan] ${game}: 页面 15s 内没就绪（入口未渲染 / 静态文案未回填），拒绝在半成品页面上扫`);
    pws.close();
    await rpc(bws, Math.floor(Math.random() * 1e6), 'Target.closeTarget', { targetId });
    return [{ screen: 'boot', kind: 'not-ready', where: '-', txt: '页面未就绪' }];
  }

  /* 每个游戏有各自的界面入口——两个游戏的 DOM/函数名并不通用。
     2026-08-21 教训：这里原本对两个游戏套用同一份（倒水的）切屏代码，彩雷根本没有
     btnLb / newGame / stuck / win 这些东西，`await ev(code)` 的报错又被静默吞掉，
     于是「mine: OK（9 个界面）」实际上只扫了首页 —— 典型的假绿。现在：
       ① 切屏代码执行失败 → 直接判红（不再吞异常）；
       ② 每屏采集页面指纹，与上一屏一样 = 这一屏根本没打开 → 判红。 */
  const SCREENS = {
    water: [
      ['home', '1'],
      ['leaderboard', `document.getElementById('btnLb').click(); 1`],
      ['weekly', `document.getElementById('btnLbBack').click(); document.getElementById('btnWeekly').click(); 1`],
      ['identity-panel', `document.getElementById('btnWkBack').click(); document.getElementById('btnIdentity').click(); 1`],
      ['game', `closeDialog(); newGame(6); 1`],
      ['stuck-dialog', `stuck(); 1`],
      ['timeup-dialog', `closeDialog(); timeUp(); 1`],
      ['win-celebrate', `closeDialog(); S.finished = false; win(); 1`],
      ['win-dialog', `1`, 1700],
    ],
    /* 彩雷的函数都关在 IIFE 里，页内探针取不到（实测 ReferenceError），
       所以一律用真实 DOM 点击驱动——找不到入口就抛错判红，不许静默跳过。
       覆盖：首页 / 周活动 / 对局 / 道具弹窗。结算窗需要真通关，这里不覆盖，
       由彩雷自己的通关用例负责，不在这里假装扫过。 */
    mine: [
      ['home', '1'],
      ['weekly', click('.eventbtn')],
      ['game', click('#btnWkBack') + '; ' + click('.bigbtn')],
      ['item-dialog', `document.getElementById('btnBack').click(); ` + click('.homestats button')],
    ],
  };
  const FINGERPRINT = `(() => {
    const vis = [...document.querySelectorAll('[id]')].filter((el) => {
      const s = getComputedStyle(el);
      return el.id && !el.hidden && s.display !== 'none' && (el.offsetWidth || el.offsetHeight);
    }).map((el) => el.id).slice(0, 40).join(',');
    const ov = document.getElementById('overlay');
    return vis + '|ov=' + (ov && !ov.hidden ? (ov.innerText || '').trim().slice(0, 40) : 'closed');
  })()`;

  const findings = [];
  let prevFp = null;
  for (const [name, code, waitMs] of SCREENS[game]) {
    const sw = await ev(code);
    if (sw && sw.__err) {   // 切屏本身报错：以前被吞掉，现在判红
      findings.push({ screen: name, kind: 'switch-failed', where: '-', txt: sw.__err.split('\n')[0] });
      continue;
    }
    await new Promise((r) => setTimeout(r, waitMs || 450));
    const fp = await ev(FINGERPRINT);
    if (name !== 'home' && fp && fp === prevFp) {   // 界面没变：这一屏没真的打开，扫了也是白扫
      findings.push({ screen: name, kind: 'not-opened', where: '-', txt: '页面指纹与上一屏相同，这一屏没打开' });
      continue;
    }
    prevFp = fp;
    const r = await ev(SCAN);
    if (r && r.__err) { findings.push({ screen: name, kind: 'error', where: '-', txt: r.__err.split('\n')[0] }); continue; }
    for (const x of r) {
      if (ALLOW.some((re) => re.test(x.txt))) continue;
      findings.push(Object.assign({ screen: name }, x));
    }
  }
  console.log(`[i18n-scan] ${game}: 实际走过 ${SCREENS[game].length} 个界面`);
  pws.close();
  await rpc(bws, Math.floor(Math.random() * 1e6), 'Target.closeTarget', { targetId });
  return findings;
}

let ver;
try {
  const r = await fetch(`http://${HOST}/json/version`, { signal: AbortSignal.timeout(2500) });
  ver = await r.json();
} catch (e) {
  console.error(`[i18n-scan] SKIP: 没有可用的 Chrome 调试端口（CDP=${HOST}）：${e.message}`);
  console.error('[i18n-scan] 这不是通过——运行时 gate 未执行，静态 gate 仍由 node --test 覆盖。');
  process.exit(2);
}
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => bws.addEventListener('open', r));
const games = only ? [only] : ['water', 'mine'];
let bad = 0;
for (const g of games) {
  const found = await scanGame(bws, g);
  const dedup = [];
  const seen = new Set();
  for (const f of found) { const k = f.screen + '|' + f.kind + '|' + f.where + '|' + f.txt; if (!seen.has(k)) { seen.add(k); dedup.push(f); } }
  if (!dedup.length) { console.log(`[i18n-scan] ${g}: OK（9 个界面，英文模式零残留中文）`); continue; }
  bad += dedup.length;
  console.error(`[i18n-scan] ${g}: 发现 ${dedup.length} 处残留中文`);
  for (const f of dedup) console.error(`  · [${f.screen}][${f.kind}] ${f.where}  →  ${f.txt}`);
}
process.exit(bad ? 1 : 0);
