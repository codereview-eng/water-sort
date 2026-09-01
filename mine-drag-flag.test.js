'use strict';
/* 门禁：彩雷「拖动刷标记」不许跳格。
   用户实报（2026-09-01）：「游戏内点击标记不是雷，手指拖动快的时候，有些位置会被跳过」。
   根因不在标记那一行，而在采样密度：W3C Pointer Events §9.1 明确 UA 会把多个原始输入
   采样 coalesce 成一个 pointermove（「will naturally reduce the granularity and fidelity
   when tracking a pointer position, particularly for fast and large movements」），
   原实现只拿这一个合并点做命中判定，手指越快跳过的格子越多。
   规范给的解法是 getCoalescedEvents() 取回原始点；但相邻两个原始采样之间照样可能跨格，
   所以还要按半格步长把连线细分（线段光栅化）。本门禁盯四件事：
     ① 一次大跨度 pointermove，连线经过的格子一个都不许漏
     ② 浏览器给了原始采样点时要真的逐点处理（不是只用最后那个点）
     ③ 不支持 getCoalescedEvents 时退回单点仍不跳格，且降级要记计数（纪律第 5 条）
     ④ 命中判定不许再回到「逐点 elementFromPoint」——格间 gap 上的落点必须归到最近的格
   PV ref：W3C Pointer Events（coalesced events + touch-action:none 官方示例）、
   MDN getCoalescedEvents（绘图场景）、MDN/javascript.info setPointerCapture（拖动不断手）。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, 'mine.html'), 'utf8');

// 按大括号配平抽函数体（切到「下一个 function」会把后面的顶层代码算进去，造成假通过）
function slice(head) {
  const i = html.indexOf(head);
  assert.ok(i > 0, `找不到 ${head}`);
  let depth = 0, started = false;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    const c = html[j];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return html.slice(i, j + 1); }
  }
  throw new Error('大括号不配平: ' + head);
}

const DIAG_DECL = (html.match(/var DRAG_DIAG = \{[^\n]*\n/) || [''])[0];
assert.ok(DIAG_DECL, 'mine.html 缺 DRAG_DIAG 声明（降级/插值必须可观测）');

const FNS = ['canPaint', 'applyMark', 'cellIdxFromXY', 'cellEl', 'dragTick', 'paintDragCell',
  'paintSegment', 'coalescedPoints', 'handleDragPoint', 'onDragMove', 'resetDragDiag', 'samePointer'];

const SIZE = 9, CELL = 40, GAP = 4;
const BOARD = SIZE * CELL + (SIZE - 1) * GAP;      // 392px：接近真机 390 宽屏的棋盘
const PITCH = BOARD / SIZE;                        // 几何换算用的格距

function center(idx) {
  const r = Math.floor(idx / SIZE), c = idx % SIZE;
  return { x: (c + 0.5) * PITCH, y: (r + 0.5) * PITCH };
}

function makeCtx(opts) {
  const o = opts || {};
  const children = [];
  for (let i = 0; i < SIZE * SIZE; i++) children.push({ cls: new Set(), classList: {
    add(...n) { n.forEach((x) => children[i].cls.add(x)); },
    remove(...n) { n.forEach((x) => children[i].cls.delete(x)); },
  } });
  const S = {
    size: SIZE, done: false,
    marks: new Set(o.marks || []), found: new Set(o.found || []), opened: new Set(o.opened || []),
  };
  const ctx = {
    S, console: { warn: (m) => ctx.warns.push(String(m)) }, warns: [],
    boardEl: { children, getBoundingClientRect: () => ({ left: 0, top: 0, width: BOARD, height: BOARD, right: BOARD, bottom: BOARD }) },
    buzz: () => { ctx.buzzed = (ctx.buzzed || 0) + 1; },
    blip: () => { ctx.blipped = (ctx.blipped || 0) + 1; },
    clickTimer: null, clearTimeout: () => {}, resetTapChain: () => {},
    Date, Math, Object,
    drag: null,
  };
  vm.createContext(ctx);
  const TICK_DECL = (html.match(/var lastDragTick = 0;/) || [''])[0];
  assert.ok(TICK_DECL, 'mine.html 缺 lastDragTick 声明（触觉节流状态）');
  vm.runInContext(DIAG_DECL + TICK_DECL + '\n' + FNS.map((n) => slice('function ' + n)).join('\n'), ctx);
  return ctx;
}

// 起手：等价于 onTap 里建出来的 drag（那段有 DOM 依赖，这里只复现它的数据形状）
function startDrag(ctx, idx, mode) {
  const p = center(idx);
  ctx.drag = { pointerId: 1, startIdx: idx, lastIdx: idx, lastX: p.x, lastY: p.y,
    mode: mode || (ctx.S.marks.has(idx) ? 'erase' : 'mark'), moved: false, painted: 0 };
  return p;
}
const marksOf = (ctx) => Array.from(ctx.S.marks).sort((a, b) => a - b);

test('一次大跨度 pointermove：整整一行 9 格全部标记，一个都不许跳过', () => {
  const ctx = makeCtx();
  startDrag(ctx, 0);
  const end = center(8);
  vm.runInContext(`onDragMove({ pointerId: 1, clientX: ${end.x}, clientY: ${end.y} })`, ctx);
  assert.deepStrictEqual(marksOf(ctx), [0, 1, 2, 3, 4, 5, 6, 7, 8],
    '手指一帧从行首划到行尾，中间 7 格全被跳过 = 用户实报的 bug');
  assert.ok(vm.runInContext('DRAG_DIAG.filled', ctx) > 0, '中间那些格是插值补出来的，要有计数');
});

test('斜向快速拖动：连线经过的格子连续无缺口', () => {
  const ctx = makeCtx();
  startDrag(ctx, 0);
  const end = center(SIZE * SIZE - 1);       // 从左上角一路划到右下角
  vm.runInContext(`onDragMove({ pointerId: 1, clientX: ${end.x}, clientY: ${end.y} })`, ctx);
  const cells = marksOf(ctx);
  assert.ok(cells.length >= SIZE, '对角线至少覆盖 9 格，实际 ' + cells.length);
  // 相邻两格必须是四邻或八邻（不许出现"跳过一整格"的缺口）
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    const dr = Math.abs(Math.floor(b / SIZE) - Math.floor(a / SIZE));
    const dc = Math.abs((b % SIZE) - (a % SIZE));
    assert.ok(dr <= 1 && dc <= 1, `格 ${a} → ${b} 之间有缺口（dr=${dr} dc=${dc}）`);
  }
});

test('浏览器给了原始采样点：逐点处理，不是只用最后那个合并点', () => {
  const ctx = makeCtx();
  startDrag(ctx, 0);
  // 手指走的是「先向右到 (0,8)，再向下到 (8,8)」的折线，被合并成一个 pointermove
  const mid = center(8), end = center(SIZE * SIZE - 1);
  vm.runInContext(`onDragMove({ pointerId: 1, clientX: ${end.x}, clientY: ${end.y},
    getCoalescedEvents: () => [ { pointerId: 1, clientX: ${mid.x}, clientY: ${mid.y} },
                                { pointerId: 1, clientX: ${end.x}, clientY: ${end.y} } ] })`, ctx);
  const cells = marksOf(ctx);
  for (let i = 0; i <= 8; i++) assert.ok(cells.includes(i), `第一行第 ${i} 格漏了（原始采样点没被用上）`);
  for (let r = 0; r < SIZE; r++) assert.ok(cells.includes(r * SIZE + 8), `最后一列第 ${r} 行漏了`);
  assert.strictEqual(vm.runInContext('DRAG_DIAG.coalesced', ctx), 1, '用到原始采样点要计数');
  assert.strictEqual(vm.runInContext('DRAG_DIAG.fallback', ctx), 0);
});

test('不支持 getCoalescedEvents：退回单点仍不跳格，且降级留下计数', () => {
  const ctx = makeCtx();
  startDrag(ctx, 0);
  const end = center(8);
  vm.runInContext(`onDragMove({ pointerId: 1, clientX: ${end.x}, clientY: ${end.y} })`, ctx);
  assert.deepStrictEqual(marksOf(ctx), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.strictEqual(vm.runInContext('DRAG_DIAG.fallback', ctx), 1, '降级路径必须可观测');
});

test('getCoalescedEvents 抛错：不中断拖动，异常本体进日志（不许裸 catch）', () => {
  const ctx = makeCtx();
  startDrag(ctx, 0);
  const end = center(8);
  vm.runInContext(`onDragMove({ pointerId: 1, clientX: ${end.x}, clientY: ${end.y},
    getCoalescedEvents: () => { const e = new Error('boom'); e.name = 'InvalidStateError'; throw e; } })`, ctx);
  assert.deepStrictEqual(marksOf(ctx), [0, 1, 2, 3, 4, 5, 6, 7, 8], '出错也要照常刷完');
  assert.ok(ctx.warns.some((w) => /getCoalescedEvents failed: InvalidStateError/.test(w)),
    '日志要能说出为什么降级（err_name + err_msg）');
});

test('擦除模式：起点已标记时，快速拖动把整条路径的标记清掉', () => {
  const all = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const ctx = makeCtx({ marks: all });
  startDrag(ctx, 0);
  const end = center(8);
  vm.runInContext(`onDragMove({ pointerId: 1, clientX: ${end.x}, clientY: ${end.y} })`, ctx);
  assert.deepStrictEqual(marksOf(ctx), [], '整行标记应被一次拖动清空');
});

test('已挖开 / 已找到的格子路过也不动，其余格照常刷', () => {
  const ctx = makeCtx({ opened: [3], found: [5] });
  startDrag(ctx, 0);
  const end = center(8);
  vm.runInContext(`onDragMove({ pointerId: 1, clientX: ${end.x}, clientY: ${end.y} })`, ctx);
  assert.deepStrictEqual(marksOf(ctx), [0, 1, 2, 4, 6, 7, 8], '3(已挖开)与5(已找到)不该被标记');
});

test('命中判定含格间 gap：落在两格缝隙上归到相邻格，而不是判定为「没命中」', () => {
  const ctx = makeCtx();
  // 第 0 与第 1 格之间的缝隙中心
  const x = CELL + GAP / 2, y = CELL / 2;
  const idx = vm.runInContext(`cellIdxFromXY(${x}, ${y})`, ctx);
  assert.ok(idx === 0 || idx === 1, `gap 上的落点应归到 0 或 1，实际 ${idx}`);
  // 棋盘外一点点（手指滑出边界）仍算最靠边那一格；再远才算未命中
  assert.strictEqual(vm.runInContext(`cellIdxFromXY(-3, ${y})`, ctx), 0, '边界外 3px 应算最靠边的格');
  assert.strictEqual(vm.runInContext(`cellIdxFromXY(-40, ${y})`, ctx), -1, '离开棋盘足够远才算未命中');
});

test('每刷一格有触觉/音反馈，但连刷不许变成一串嗡嗡声（节流）', () => {
  const ctx = makeCtx();
  startDrag(ctx, 0);
  const end = center(SIZE * SIZE - 1);
  vm.runInContext(`onDragMove({ pointerId: 1, clientX: ${end.x}, clientY: ${end.y} })`, ctx);
  assert.ok((ctx.buzzed || 0) >= 1, '拖动过程必须有触觉反馈');
  assert.ok((ctx.buzzed || 0) < marksOf(ctx).length, '不能每格都震：要节流');
});

test('接线反回归：捕获指针、touch-action:none、命中判定不许回到逐点 elementFromPoint', () => {
  const onTap = slice('function onTap');
  assert.ok(/setPointerCapture\(ev\.pointerId\)/.test(onTap),
    '按下时必须 setPointerCapture：手指滑出棋盘也不该中途断手');
  assert.ok(/\.board\{[^}]*touch-action:\s*none/.test(html), '棋盘必须 touch-action:none（官方示例要求）');
  const move = slice('function onDragMove') + slice('function handleDragPoint') + slice('function paintSegment');
  assert.ok(!/elementFromPoint/.test(move), '拖动路径上不许再用 elementFromPoint 逐点 hit-test');
  assert.ok(/addEventListener\('pointermove', onDragMove, \{ passive: true \}\)/.test(html),
    'pointermove 保持 passive（touch-action 已经挡住滚动，不需要 preventDefault）');
});
