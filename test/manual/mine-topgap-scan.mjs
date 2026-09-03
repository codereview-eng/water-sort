#!/usr/bin/env node
/* mine-topgap-scan.mjs —— 量「页面首行深底 → 首处内容」之间作品自己留了多少空。

   为什么要逐像素扫而不是读 CSS：顶部预留是好几层 padding/margin 叠出来的
   （.wrap 的 padding-top + .home 的 padding-top + chip 自己的 padding），
   只读某一条规则永远对不上玩家眼里那段空白。玩家看到的是「深底还在延续」，
   所以判据必须落在像素上。

   量法（与 issue #10251 那次真机量法同源）：
   - 393×851 CSS 视口（Redmi 1080×2340@440 的 CSS 尺寸）打开页面；
   - 逐行统计该行像素相对**本行中位色**的最大偏差 —— 背景是径向渐变，
     同一行内几乎同色，中位色即该行背景；内容一出现就把偏差顶起来；
   - 报两个阈值：>8 = 出现任何可见绘制（含 6% 白的 chip 底），
     >60 = 出现高对比内容（头像/文字）。两个都报，免得靠单一阈值自说自话。

   用法（CDP=<host:port> 指向任意一个 Chrome 调试端口，自己起一个独立 headless 即可，
   不要去占本机共享的 chrome-cu-*）：
     google-chrome --headless=new --remote-debugging-port=19579 about:blank &
     CDP=127.0.0.1:19579 node test/manual/mine-topgap-scan.mjs https://play-color-mines.run.ceo/
*/
const CDP = process.env.CDP || '127.0.0.1:19560';
const URL_ = process.argv[2] || 'https://play-color-mines.run.ceo/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ver = await (await fetch(`http://${CDP}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiters = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
};
const send = (method, params, sessionId) => {
  const mid = ++id;
  return new Promise((res, rej) => {
    waiters.set(mid, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });
};

const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable', {});
await S('Runtime.enable', {});
await S('Emulation.setDeviceMetricsOverride', { width: 393, height: 851, deviceScaleFactor: 1, mobile: true });
const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
});
await S('Page.navigate', { url: URL_ });
await sleep(3500);

/* 截图后在同一个页面里用 canvas 解码扫描：省掉本地 PNG 解码依赖。 */
const shot = await S('Page.captureScreenshot', { format: 'png' });
const scan = `(async () => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + ${JSON.stringify(shot.data)};
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const rows = [];
  for (let y = 0; y < Math.min(c.height, 200); y++) {
    const px = [];
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      px.push([d[i], d[i + 1], d[i + 2]]);
    }
    const med = [0, 1, 2].map((k) => {
      const v = px.map((p) => p[k]).sort((a, b) => a - b);
      return v[v.length >> 1];
    });
    let dev = 0;
    for (const p of px) dev = Math.max(dev, Math.abs(p[0] - med[0]), Math.abs(p[1] - med[1]), Math.abs(p[2] - med[2]));
    rows.push(dev);
  }
  const first = (th) => { for (let y = 0; y < rows.length; y++) if (rows[y] > th) return y; return -1; };
  return JSON.stringify({ w: c.width, h: c.height, paint: first(8), strong: first(60), head: rows.slice(0, 30) });
})()`;
const res = await S('Runtime.evaluate', { expression: scan, returnByValue: true, awaitPromise: true });
const out = JSON.parse(res.result.value);
console.log('url        ', URL_);
console.log('pageerrors ', errs.length, errs.slice(0, 4));
console.log('首处可见绘制(阈值>8)  y =', out.paint, 'CSS px');
console.log('首处高对比内容(阈值>60) y =', out.strong, 'CSS px');
console.log('前 30 行偏差:', out.head.join(','));
await send('Target.closeTarget', { targetId });
ws.close();
