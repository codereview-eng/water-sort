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
  const fn = windowAfter(mine, 'function openStory() {', 2400, 'mine openStory');
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

test('多语言运行时 gate 覆盖到图鉴弹窗', () => {
  assert.ok(scan.includes("'story-dialog'") && scan.includes('#dkStory'),
    'i18n 运行时扫描必须走一遍剧情图鉴，否则新文案漏翻正好在盲区');
});
