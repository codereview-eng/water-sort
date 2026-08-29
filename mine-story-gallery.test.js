'use strict';
/* 剧情图鉴门禁（2026-08-29）：首页设置图标下的 🎬 入口 —— 列全部 CG，
   没解锁的挂锁、已解锁的点了重播。
   分两层锁：
     ① 数据层 MineStory.list()：解锁语义（看过 或 进度越过触发点）、锁着不剧透字幕；
     ② 接线层 mine.html：config 里有入口、action 在白名单里、弹窗真渲染锁与重播按钮。
   只测 ① 挡不住「入口没接上/点了没反应」（教训见 repo memory「页面接线要单独测」）；
   接线断言一律在【函数体窗口】里找调用点，避免注释误命中
   （教训见 repo memory「HTML 门禁 regex 会自我误报」）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = __dirname;
const Story = require('./mine-story.js');
const mine = readFileSync(join(ROOT, 'mine.html'), 'utf8');
const cfg = JSON.parse(readFileSync(join(ROOT, 'games/mine/game.config.json'), 'utf8'));
const scan = readFileSync(join(ROOT, 'scripts/i18n-cjk-scan.mjs'), 'utf8');

function windowAfter(src, anchor, span, label) {
  const i = src.indexOf(anchor);
  assert.ok(i >= 0, `找不到锚点：${label || anchor}`);
  return src.slice(i, i + span);
}

test('MineStory.list()：每段 CG 都有解锁态，锁着的不返回字幕（不剧透）', () => {
  const rows = Story.list(1);
  assert.strictEqual(rows.length, Story.CG.length, 'list 必须列全部 CG，而不是只列解锁的');
  for (const r of rows) {
    assert.ok(typeof r.id === 'string' && r.id, '缺 id');
    assert.strictEqual(typeof r.at, 'number', '缺触发关卡 at');
    assert.strictEqual(typeof r.unlocked, 'boolean', '缺解锁态');
  }
  // 新玩家（第 1 关，什么都没看过）：全锁，且一个字幕都不给
  assert.deepStrictEqual(rows.map((r) => r.unlocked), rows.map(() => false), '新玩家应当全部锁着');
  assert.deepStrictEqual(rows.map((r) => r.caption), rows.map(() => ''), '锁着的条目不得带字幕');
});

test('MineStory.list()：进度越过触发点即解锁 —— 关掉「剧情动画」的玩家也能补看', () => {
  /* 解锁不能只认 seen：设置里关掉剧情动画的玩家一路打过去从没 seen 过任何一段，
     只认 seen 的话他的图鉴永远是一排锁，正是「已经通关却看不到」的坑。 */
  const at101 = Story.list(101);
  const byId = Object.fromEntries(at101.map((r) => [r.id, r]));
  assert.strictEqual(byId.cg0.unlocked, true, '开局段：越过第 1 关即应解锁');
  assert.strictEqual(byId.cg1.unlocked, true, '通关第 100 关后，cg1 应解锁');
  assert.strictEqual(byId.cg2.unlocked, false, '还没到第 200 关，cg2 必须仍锁着');
  assert.ok(byId.cg1.caption.length > 0, '解锁后必须给出该段字幕作为条目说明');
  // 边界：刚好停在触发关（第 100 关还没通）不算解锁
  assert.strictEqual(Story.list(100).find((r) => r.id === 'cg1').unlocked, false,
    '停在第 100 关（未通关）时 cg1 不得解锁');
  assert.strictEqual(Story.list(1).find((r) => r.id === 'cg0').unlocked, false,
    '还在第 1 关（没开打）时开局段不得解锁');
});

test('MineStory.list()：条目说明跟随 setLang —— CG 字幕不在页面字典里，是漏翻的藏身处', () => {
  /* 用户实报（2026-08-29）：英文界面里图鉴条目仍是中文字幕。
     根因 = openStory 渲染前没 setLang，而 SUBS 的默认语言是 zh。
     这里同时锁住数据层的语言开关与页面层的调用顺序。 */
  try {
    Story.setLang('en');
    const en = Story.list(101).find((r) => r.id === 'cg1').caption;
    assert.ok(en.length > 0 && !/[\u4e00-\u9fff]/.test(en), '英文模式下字幕不得是中文：' + en);
    Story.setLang('zh');
    const zh = Story.list(101).find((r) => r.id === 'cg1').caption;
    assert.ok(/[\u4e00-\u9fff]/.test(zh), '中文模式下应给中文字幕：' + zh);
  } finally { Story.setLang('zh'); }
});

test('接线：openStory 必须【先 setLang 再取数据】，否则英文界面漏中文字幕', () => {
  const fn = windowAfter(mine, 'function openStory() {', 2400, 'mine openStory');
  const iLang = fn.indexOf('setLang(');
  const iList = fn.indexOf('.list(');
  assert.ok(iLang >= 0, 'openStory 必须把当前语言同步给 MineStory');
  assert.ok(iLang < iList, 'setLang 必须在 list() 之前调用（先定语言再取字幕）');
});

test('MineStory.replay()：未知 id 也必须回调收口，不留死分支', () => {
  let called = false;
  Story.replay('no-such-cg', () => { called = true; });
  assert.ok(called, 'replay 遇到未知 id 必须调 done()（不变量 1：任何分支都要收口）');
});

test('首页入口：设置图标下面有一个 🎬 剧情格，action 走 story', () => {
  const rails = cfg.screens.home.modules.filter((m) => m.type === 'side-rail');
  const left = rails.find((m) => m.props.side === 'left');
  assert.ok(left, '首页缺左侧图标列');
  const ids = left.props.items.map((it) => it.id);
  const iSet = ids.indexOf('dkSet');
  const iStory = ids.indexOf('dkStory');
  assert.ok(iStory >= 0, '首页缺剧情图鉴入口 dkStory');
  assert.strictEqual(iStory, iSet + 1, '剧情图标必须紧挨在设置图标【下面】（用户拍板 2026-08-29）');
  const item = left.props.items[iStory];
  assert.strictEqual(item.action, 'story', '剧情图标的 action 必须是 story');
  assert.ok(item.icon && item.icon.length > 0, '剧情图标缺 icon');
  assert.ok(/^[\x00-\x7F]+$/.test(item.label), 'config 里的 label 必须是英文安全 fallback');
});

test('接线：story 在 action 白名单里，且静态文案按 tabStory 回填', () => {
  const bind = windowAfter(mine, 'function bindHome() {', 1400, 'mine bindHome');
  assert.ok(/story:\s*openStory/.test(bind), 'action 白名单缺 story → 点了会直接抛「未实现的 action」');
  const i18n = windowAfter(mine, 'function applyStaticI18n() {', 2600, 'mine applyStaticI18n');
  assert.ok(/dkStory:\s*'tabStory'/.test(i18n), '剧情图标的文字标签必须按语言回填，否则英文下仍是中文');
});

test('接线：图鉴弹窗真的画出锁 / 重播按钮，并在重播前先收窗', () => {
  const fn = windowAfter(mine, 'function openStory() {', 7000, 'mine openStory');
  assert.ok(fn.includes('MineStory'), '图鉴必须读 MineStory，不许自己另存一份解锁态');
  assert.ok(fn.includes('.list('), '解锁判定必须走 MineStory.list（唯一权威）');
  assert.ok(fn.includes('🔒'), '没解锁的条目必须显示一把锁');
  assert.ok(fn.includes('data-cg='), '已解锁的条目必须带 data-cg，才能点开重播');
  assert.ok(fn.includes("t('storyLockedAt'") && fn.includes("t('storyLockedStart'"),
    '锁着的条目必须写清解锁条件（通关第几关）');
  assert.ok(fn.includes('.replay('), '点已解锁条目必须调 MineStory.replay 重播');
  const order = fn.indexOf('hideDialog()') < fn.indexOf('.replay(');
  assert.ok(fn.includes('hideDialog()') && order, 'CG 是全屏层：必须先收弹窗再播，否则弹窗压在动画上');
  assert.ok(fn.includes('dialog(') && fn.includes("t('gotIt')"),
    '图鉴弹窗必须走统一 dialog（带✕/遮罩/Esc 三条退出路）');
});

test('P0 容器：任何弹窗都必须有高度上限，列表区自己滚', () => {
  /* 首坏就是这条：.dialog 没有 max-height/overflow，内容多高窗就多高，
     底部按钮被顶出视口且没有任何东西可滚（剧情图鉴 11 行就撞线）。
     断言写在通用容器上，背包/连胜/设置窗一并受保护。 */
  const css = mine.slice(mine.indexOf('.dialog{'), mine.indexOf('.dialog{') + 700);
  assert.ok(/max-height:\s*calc\(100vh/.test(css), '.dialog 必须有视口高度上限');
  assert.ok(/max-height:\s*calc\(100dvh/.test(css), '.dialog 应同时给 dvh（移动端浏览器工具条会吃掉 vh）');
  const listCss = mine.slice(mine.indexOf('#dlgList{'), mine.indexOf('#dlgList{') + 240);
  assert.ok(/overflow-y:\s*auto/.test(listCss), '列表区必须自己滚');
  assert.ok(/min-height:\s*0/.test(listCss), 'flex 子项不写 min-height:0 就不会真正滚（会把父容器撑破）');
});

test('P1 分卷：卷头带进度、连续锁段合并、默认展开当前卷并滚过去', () => {
  const fn = windowAfter(mine, 'function openStory() {', 7000, 'mine openStory');
  assert.ok(fn.includes('data-vol='), '必须有可折叠的卷头（否则万关就是一条长列表）');
  assert.ok(fn.includes("t('storyVolumeProgress'"), '卷头必须显示这一卷解锁了几段');
  assert.ok(fn.includes("t('storyChapterRange'") && fn.includes("t('storyLockedFrom'"),
    '连续锁着的段必须合并成一行「第 N–M 章 · 从第 X 关起解锁」');
  assert.ok(/anyLocked|openG/.test(fn), '必须算出「玩家正在推进的那一卷」作为默认展开项');
  assert.ok(fn.includes('scrollTop'), '打开图鉴必须滚到当前卷，不能让玩家自己找');
  assert.ok(fn.includes('list.onclick'), '卷会反复开合、列表整块重画 ⇒ 必须事件委托，不能逐个绑');
});

test('P2 规模：加关卡只改一个数字，1 万关的表由规则生成', () => {
  const before = Story.plan();
  try {
    const p = Story.setPlan({ count: 101 });          // 序章 + 100 章 = 第 10000 关
    assert.strictEqual(p.count, 101);
    assert.strictEqual(Story.CG.length, 101, '段数应跟着 count 走');
    const last = Story.CG[100];
    assert.strictEqual(last.at, 10000, '第 100 章应落在第 10000 关');
    assert.strictEqual(last.v, 'cg/cg100.mp4', '素材路径必须由规则推出，不靠手写');
    assert.ok(Story.MEDIA['cg/cg100.mp4'] && Story.MEDIA['cg/bgm100.opus'],
      '映射表必须跟着一起生成（构建的齐全性核对读的就是它）');
    const rows = Story.list(10001);
    assert.strictEqual(rows.length, 101);
    assert.ok(rows.every((r) => r.unlocked), '全通关后 101 段应全部解锁');
    // 序章没字幕会回落成空串，但绝不能让整表崩掉：只有 cg0..cg10 写了字幕
    assert.strictEqual(rows[100].caption, '', '没写字幕的段应安静地没有字幕，而不是报错');
  } finally {
    Story.setPlan(before);
    assert.strictEqual(Story.CG.length, 11, '测试后必须还原成当前真实节奏');
  }
});

test('多语言运行时 gate 覆盖到图鉴弹窗', () => {
  assert.ok(scan.includes("'story-dialog'") && scan.includes('#dkStory'),
    'i18n 运行时扫描必须走一遍剧情图鉴，否则新文案漏翻正好在盲区');
});
