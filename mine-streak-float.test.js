/* 局内连胜角标「可拖动 · 只吸边」门禁（2026-09-03 用户点名）。

   为什么这几条要锁住：拖拽是少数几个「写错了也不会报错、只会变得难用」的功能，
   而它的坏法都很具体 ——
   - 少了 touch-action:none：手机上一拖就被判成滚动，pointermove 断流，功能形同不存在；
   - 少了位移阈值：每次点击都变成微拖拽，点开连胜窗这个主用途被吃掉；
   - 少了拖后抑制 click：每挪一次位置就弹一次连胜窗；
   - 存绝对像素而不是比例：换设备/转屏后牌子被甩出屏幕，玩家再也点不到；
   - 纵向不夹安全带：牌子被拖到 HUD 上盖住「关卡/剩余雷/时间」，或压回 play 平台的 ❤/💬 浮标坞
     （#67 修过一次的老坑）。
   这些都验不到"报错"，只能把写法本身锁住。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = readFileSync(join(__dirname, 'mine.html'), 'utf8');

/* 按大括号配平取函数体，避免用行号（行号会随任何编辑漂移） */
function fnBody(src, head) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const at = clean.indexOf(head);
  assert.ok(at !== -1, `找不到 ${head}`);
  let i = clean.indexOf('{', at), depth = 0, start = i;
  for (; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}' && --depth === 0) return clean.slice(start, i + 1);
  }
  throw new Error(`${head} 的函数体没闭合`);
}

test('角标必须关掉浏览器手势接管（否则手机上根本拖不动）', () => {
  const at = html.indexOf('.wsfloat{');
  const rule = html.slice(at, html.indexOf('}', at));
  assert.match(rule, /touch-action:\s*none/,
    '.wsfloat 没写 touch-action:none —— 手指一动就被判成滚动，pointermove 直接断流');
});

test('三条指针事件齐全，并且捕获指针（手指滑出按钮不能丢拖拽）', () => {
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.ok(html.includes(`addEventListener('${ev}'`), `缺少 ${ev} 监听`);
  }
  assert.match(html, /setPointerCapture/, '没有 setPointerCapture：手指滑出按钮范围拖拽就断了');
});

test('有位移阈值：抖一两个像素不算拖动', () => {
  const body = fnBody(html, "wsfEl.addEventListener('pointermove'");
  assert.match(body, /wsfDrag\.moved && Math\.abs[\s\S]{0,160}< 6/,
    'pointermove 里没有位移阈值判断，点击会被误判成拖拽');
});

test('拖完那一下的 click 必须被挡掉，否则每次挪位置都弹连胜窗', () => {
  const body = fnBody(html, "$('wsFloat').addEventListener('click'");
  assert.match(body, /wsfLastDragAt/, 'click 处理里没有检查刚刚是否拖过');
  assert.match(html, /wsfLastDragAt = Date\.now\(\)/, '拖拽结束没有记时间戳，抑制无从判断');
});

test('松手只能吸到左右两侧：横向不许停在中间', () => {
  const body = fnBody(html, 'function wsfEnd(e)');
  assert.match(body, /side = \(r\.left \+ r\.width \/ 2\) < window\.innerWidth \/ 2 \? 'l' : 'r'/,
    '松手后没有按中线判定吸向哪一侧');
  assert.match(fnBody(html, 'function wsfApply(anim)'), /wsfPos\.side === 'l' \? d\.marginX : window\.innerWidth - d\.marginX/,
    '落位没有按侧边贴齐，牌子会停在盘面中央盖住格子');
});

test('纵向夹在安全带里：上不盖 HUD，下不压平台浮标坞', () => {
  const band = fnBody(html, 'function wsfBand(el, d)');
  assert.match(band, /#game \.hud/, '上界没有按局内 HUD 的下沿算，牌子能盖住关卡/剩余雷/时间');
  assert.match(band, /window\.innerHeight - h - d\.bottomGap/, '下界没有扣掉底部留白');
  assert.match(band, /if \(max < min\) max = min/, '极矮屏没有兜底，安全带会翻过来');
  const end = fnBody(html, 'function wsfEnd(e)');
  assert.match(end, /Math\.min\(band\.max, Math\.max\(band\.min, r\.top\)\)/,
    '落点没有被夹进安全带');
});

/* 底部那段留白（84px + 安全区）是 #67 的教训：play 平台在页面底部叠了自己的
   点赞/评论条，压住它比没有角标更糟。这里锁住"留白是量出来的、不是写死的"。 */
test('底部留白从默认位置量出来，而不是在 JS 里另写一个数字', () => {
  const m = fnBody(html, 'function wsfMeasure(el)');
  assert.match(m, /window\.innerHeight - r\.bottom/, '没有从默认位置反推底部留白');
  assert.match(m, /window\.innerWidth - r\.right/, '没有从默认位置反推侧边距');
  assert.ok(!/bottomGap\s*=\s*84/.test(m), 'JS 里又写死了一个 84：CSS 改了这里就会对不上（env() 也拿不到）');
});

test('位置按比例存，不存绝对像素（换设备/转屏不能把牌子甩出屏幕）', () => {
  assert.match(html, /var WSF_KEY = 'mine_ws_float_v1'/, '缺少位置存档 key');
  const end = fnBody(html, 'function wsfEnd(e)');
  assert.match(end, /yr = band\.max > band\.min \? \(y - band\.min\) \/ \(band\.max - band\.min\) : 1/,
    '纵向位置没有换算成比例');
  assert.match(end, /localStorage\.setItem\(WSF_KEY/, '拖完没有落盘，下次进关卡又跳回原位');
  assert.match(html, /addEventListener\('resize'[\s\S]{0,120}wsfApply/, '视口变化后没有重新吸边');
});

test('没挪过就不写任何内联样式（默认位置仍由 CSS 的 env() 说了算）', () => {
  const apply = fnBody(html, 'function wsfApply(anim)');
  assert.match(apply, /if \(!wsfPos\) return;/,
    '没有存过位置时也去写 left/top，会把 CSS 里的安全区计算覆盖掉');
});

test('可拖这件事要说出来：抓手 + 一次性提示 + 无障碍标签', () => {
  assert.match(html, /class="grip"/, '缺少可拖抓手，静态一帧里没人看得出能拖');
  assert.match(html, /wsFloatDragHint/, '缺少提示文案键');
  assert.match(html, /WSF_HINT_KEY/, '提示没有只提示一次的开关');
  const r = fnBody(html, 'function renderWsFloat()');
  assert.match(r, /aria-label[\s\S]{0,200}wsFloatDragHint/, '无障碍标签没提可拖动');
});
