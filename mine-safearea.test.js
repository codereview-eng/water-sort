/* 安全区门禁（2026-08-29）。
   首坏现场：玩家在部分手机 webview 里进彩雷，屏幕下方一整条黑。
   RCA：mine.html 的 viewport meta 没有 viewport-fit=cover ——
     ① 页面视口被系统 inset 在安全区以内，底部 home indicator / 手势条那条不归页面画，
        由宿主 WebView 填色（嵌入式 webview 多为黑）→ 「下面一片黑」；
     ② 没有 cover 时 env(safe-area-inset-*) 恒为 0，页面里那些 calc(... + env(...)) 全是死代码，
        看着像做了适配，其实一行都没生效（这正是它活了这么久没被发现的原因）。
   本门禁锁的是「铺满 + 让位」这对不可分割的组合：只要有人删掉 cover，或者加了 cover
   却让某个贴边元素继续用裸像素贴边，这里就红。

   为什么用文本断言：安全区的真值只有真机/带 cutout 的宿主才给得出，
   headless Chrome 无法伪造 env()。所以这里锁「写法」这一层可判定的事实，
   真机观感由发布后的人工复验兜底（两者都不可省）。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = __dirname;
const html = readFileSync(join(ROOT, 'mine.html'), 'utf8');
const homeJs = readFileSync(join(ROOT, 'core', 'home.js'), 'utf8');

/* 取某个选择器的声明块（style 段是平铺 CSS，选择器唯一） */
function ruleBody(css, selector) {
  const at = css.indexOf(selector + '{');
  assert.notStrictEqual(at, -1, `找不到选择器 ${selector}，门禁假设已失效`);
  const end = css.indexOf('}', at);
  assert.notStrictEqual(end, -1, `${selector} 的声明块没闭合`);
  return css.slice(at + selector.length + 1, end);
}

test('viewport meta 必须带 viewport-fit=cover（页面铺到物理屏边缘 + env() 才有真值）', () => {
  const m = html.match(/<meta name="viewport" content="([^"]+)"/);
  assert.ok(m, 'mine.html 找不到 viewport meta');
  assert.match(m[1], /viewport-fit\s*=\s*cover/,
    '删掉 viewport-fit=cover 会让底部安全区回落给宿主填色 —— 那条黑边就是这么来的');
});

test('声明 theme-color，宿主 chrome 跟页面底色走', () => {
  const m = html.match(/<meta name="theme-color" content="([^"]+)"/);
  assert.ok(m, '缺少 theme-color meta');
  const bg = html.match(/--bg:\s*(#[0-9a-fA-F]{3,8})/);
  assert.ok(bg, '找不到 --bg 定义');
  assert.strictEqual(m[1].toLowerCase(), bg[1].toLowerCase(),
    'theme-color 必须与 --bg 一致，否则宿主那条与页面对不上色');
});

test('根节点声明 color-scheme:dark，挡掉 WebView 的 force-dark 二次反色', () => {
  assert.match(html, /:root\{[^}]*color-scheme:\s*dark/s);
});

/* 贴边元素清单：这些元素要么承载全部内容（.wrap），要么 position:fixed 贴屏幕边。
   开了 cover 之后它们必须自己让位，否则内容会压在刘海/手势条底下。 */
const EDGE_RULES = [
  ['.wrap', ['top', 'right', 'bottom', 'left']],
  ['.overlay', ['top', 'right', 'bottom', 'left']],
  ['.admask', ['top', 'right', 'bottom', 'left']],
  ['.toast', ['bottom']],
  ['.selftest', ['right', 'bottom', 'left']],
];

for (const [sel, edges] of EDGE_RULES) {
  test(`${sel} 必须按安全区让位（${edges.join('/')}）`, () => {
    const body = ruleBody(html, sel);
    for (const e of edges) {
      assert.ok(body.includes(`env(safe-area-inset-${e}`),
        `${sel} 少了 env(safe-area-inset-${e})：开了 cover 后这条边会压到系统区域上`);
    }
  });
}

test('弹窗高度上限要扣掉安全区，否则按钮会被顶出屏幕', () => {
  const body = ruleBody(html, '.dialog');
  assert.match(body, /max-height:calc\(100dvh[^;]*env\(safe-area-inset-top[^;]*env\(safe-area-inset-bottom/,
    '.dialog 的 100dvh 上限没有扣掉上下安全区');
});

test('首页 min-height 要扣掉安全区，否则首页凭空多出可滚的一截', () => {
  /* 非贪婪匹配到分号：calc 里现在嵌了 var(...)，用 [^)]* 会在第一个右括号处断掉，
     那样这条门禁会对着半截声明做断言 —— 看起来在守，其实守的是空气。 */
  const hits = homeJs.match(/min-height:calc\(100d?vh.*?\);/g) || [];
  assert.ok(hits.length >= 2, 'core/home.js 里 .home 的 min-height 规则不见了，门禁假设已失效');
  for (const h of hits) {
    assert.ok(h.includes('env(safe-area-inset-top') && h.includes('env(safe-area-inset-bottom'),
      '.home 的 min-height 必须减去上下安全区：' + h);
  }
});

/* 顶部零预留门禁（2026-09-03，issue：play 面顶部一条空白把整页往下推）。
   首坏现场：Redmi 真机从广场进彩雷，顶部多出一段空白。宿主没下发任何 inset
   （logcat: safearea SKIPPED t=0 ct=0，data-runai-safe-box=0,0,0,0），
   空白全是作品自己叠的固定基数：.wrap 10px + .home 4px。
   box 模式下 env(safe-area-inset-top) 恒为 0px，所以顶边**只许**由 env() 决定；
   谁再往顶边加固定基数，谁就在 play 面上凭空推走一截页面。 */
test('顶边不许有固定基数：.wrap 的 padding-top 只由 env() 决定', () => {
  const body = ruleBody(html, '.wrap');
  const padding = (body.match(/padding:([^;]+);/) || [])[1];
  assert.ok(padding, '.wrap 找不到 padding 简写声明，门禁假设已失效');
  const top = padding.trim().split(/\s+(?![^(]*\))/)[0];
  assert.strictEqual(top, 'env(safe-area-inset-top, 0px)',
    '.wrap 顶边只能是裸 env(safe-area-inset-top, 0px)：加了固定基数，'
    + 'play 面（env 恒为 0）就会在内容前多出等量空白。当前写法：' + top);
});

test('首页顶部零预留：--hm-home-pad-top 必须是 0px', () => {
  assert.match(html, /--hm-home-pad-top:\s*0px/,
    'mine.html 要把 core/home.js 的 .home padding-top 覆盖成 0px，否则顶部又多 4px');
  assert.match(homeJs, /padding-top:var\(--hm-home-pad-top,/,
    'core/home.js 的 .home padding-top 不再走变量，mine.html 的覆盖就失效了（静默失效，页面上才看得见）');
});

test('env() 一律带 0px 兜底，缺省值缺失会让整条 calc 失效', () => {
  const uses = html.match(/env\(safe-area-inset-[a-z]+[^)]*\)/g) || [];
  assert.ok(uses.length >= 10, '安全区用法太少，改动可能被回退了');
  for (const u of uses) {
    assert.match(u, /,\s*0px\)/, `${u} 缺少 0px 兜底`);
  }
});
