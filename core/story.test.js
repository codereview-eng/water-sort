'use strict';
/* core/story.js 门禁：剧情 CG 通用层（2026-08-29 从彩雷下沉）。
   本文件锁两件事：
     ① 通用性 —— 换一份 config 就是另一个游戏的 CG（节奏/素材路径/字幕/存档键全可配），
        core 里不许残留任何彩雷专有的字面量；
     ② 图鉴 markup 由 core 产出 —— 别的游戏零抄代码，只声明配置 + 十几行接线。
   播放机本身（video/BGM/看门狗）要真浏览器才验得了，由 test/manual/mine-cg-gate-check.mjs
   与 mine-story-gallery-check.mjs 在真页面上把关，这里不假装测过。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const StoryCore = require('./story.js');
const src = readFileSync(join(__dirname, 'story.js'), 'utf8');

/* 另一个虚构游戏的配置：节奏、素材路径、字幕、存档键全不一样 */
const OTHER = {
  cadence: 50,
  count: 4,
  volume: 2,
  seenKey: 'foo.story.seen',
  media: { video: 'movies/act{i}.webm', bgm: 'movies/theme{i}.ogg' },
  subs: { cg1: { zh: '第一幕', en: 'Act one' } }
};

test('core 里没有任何彩雷专有的字面量（否则谈不上通用）', () => {
  /* 只查会真正造成耦合的东西：写死的存档键、剧情文案、彩雷的全局名。
     注释里的出处说明（「由彩雷的 mine-story.js 下沉」）不算耦合，不在此列。 */
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '');       // 去掉块注释再查
  for (const bad of ['cm.story.seen', '灯落镇', 'Lumen Hollow', '彩色扫雷',
    'MineStory', 'mine-engine', 'CFG.']) {
    assert.ok(!body.includes(bad), `core/story.js 不该出现游戏专有内容：${bad}`);
  }
  assert.ok(!/['"]cg\/cg\d/.test(body), '素材路径必须来自配置模板，不许在 core 里写死具体文件名');
});

test('换一份配置就是另一个游戏的 CG：节奏 / 路径 / 存档键全跟配置走', () => {
  const s = StoryCore.create(OTHER);
  assert.strictEqual(s.CG.length, 4);
  assert.deepStrictEqual(s.CG.map((c) => c.at), [0, 50, 100, 150], '触发关卡按 cadence 生成');
  assert.strictEqual(s.CG[2].v, 'movies/act2.webm', '视频路径按模板展开');
  assert.strictEqual(s.CG[2].m, 'movies/theme2.ogg', '音乐路径按模板展开');
  assert.strictEqual(s.seenKey, 'foo.story.seen',
    '已看记录的存档键必须可配 —— 两个游戏共用一个键会互相污染进度');
  assert.ok(s.MEDIA['movies/act3.webm'], '映射表跟着一起生成（构建的素材核对读的就是它）');
});

test('缺省值兜底：只给 count 也能跑（其余走 core 缺省）', () => {
  const s = StoryCore.create({ count: 3 });
  assert.deepStrictEqual(s.CG.map((c) => c.at), [0, 100, 200]);
  assert.strictEqual(s.CG[1].v, 'cg/cg1.mp4');
  assert.strictEqual(s.plan().volume, 10);
});

test('解锁语义：看过 或 进度越过触发点；锁着的不返回字幕', () => {
  const s = StoryCore.create(OTHER);
  const at1 = s.list(1);
  assert.deepStrictEqual(at1.map((r) => r.unlocked), [false, false, false, false]);
  assert.deepStrictEqual(at1.map((r) => r.caption), ['', '', '', ''], '锁着的条目不得剧透字幕');
  const at90 = s.list(90);
  assert.deepStrictEqual(at90.map((r) => r.unlocked), [true, true, false, false],
    '第 90 关：越过开局与第 50 关两段，第 100 关那段还锁着');
  assert.deepStrictEqual(s.list(120).map((r) => r.unlocked), [true, true, true, false],
    '第 120 关：第 100 关那段也解锁了（边界：越过才算）');
  assert.strictEqual(s.list(60)[1].caption, '第一幕', '解锁后给出该段字幕');
  s.setLang('en');
  assert.strictEqual(s.list(60)[1].caption, 'Act one', '字幕跟随语言');
  s.setLang('zh');
});

test('图鉴分卷：卷按 cadence×volume 划，当前卷 = 含第一个未解锁段那卷', () => {
  const s = StoryCore.create(OTHER);          // cadence 50 × volume 2 ⇒ 一卷 100 关
  const g = s.gallery(60);
  assert.deepStrictEqual(g.vols.map((v) => [v.from, v.to]), [[1, 100], [101, 200]]);
  assert.strictEqual(g.vols[0].unlocked, 2, '第 1 卷已解锁 2 段');
  assert.strictEqual(g.current, 1, '第 60 关时玩家还在第 1 卷');
  assert.strictEqual(s.gallery(999).current, 2, '全通关后停在最后一卷');
});

test('图鉴 markup 由 core 产出：卷头 / 可点重播行 / 合并锁段行', () => {
  const s = StoryCore.create({ cadence: 100, count: 11, volume: 5, subs: { cg1: { zh: '一', en: 'one' } } });
  // 文案由宿主注入：这里用「键:参数」形式，注意别带引号（markup 会被转义）
  const t = (k, v) => k + (v ? ':' + Object.keys(v).map((x) => v[x]).join('-') : '');
  const view = s.galleryHtml({ level: 250, t });
  assert.ok(view.html.includes('data-cg="cg0"'), '解锁段必须是可点的重播行');
  assert.ok(view.html.includes('🔒'), '未解锁必须显示锁');
  assert.ok(view.html.includes('storyChapterRange:3-5'),
    '一卷内连续锁着的段必须合并成一行（第 3–5 章）');
  assert.ok(view.html.includes('data-vol="2"') && view.html.includes('aria-expanded'),
    '多卷时必须画可折叠卷头');
  assert.strictEqual(view.current, 1);
  assert.ok(view.open[1], '默认展开当前卷');
  // 折叠当前卷后，段行应当消失（列表行数可控是万关方案的根据）
  const collapsed = s.galleryHtml({ level: 250, open: {}, t });
  assert.ok(!collapsed.html.includes('data-cg='), '卷全折叠时不渲染任何段行');
});

test('规模：1 万关（101 段）时可见行数被压到 25 行以内', () => {
  const s = StoryCore.create({ cadence: 100, count: 101, volume: 10 });
  const t = (k, v) => k + (v ? JSON.stringify(v) : '');
  const html = s.galleryHtml({ level: 250, t }).html;
  const rows = (html.match(/class="bagrow/g) || []).length;
  assert.ok(rows <= 25, `平铺会是 101 行，分卷后应 ≤25，实际 ${rows}`);
  assert.strictEqual((html.match(/data-vol=/g) || []).length, 10, '应分成 10 卷');
});

test('replay 未知 id 也要收口（不变量 1：任何分支都有出口）', () => {
  const s = StoryCore.create(OTHER);
  let called = false;
  s.replay('nope', () => { called = true; });
  assert.ok(called);
});

test('无配置也不炸：count 缺省为 0 ⇒ 空图鉴而不是抛错', () => {
  const s = StoryCore.create({});
  assert.strictEqual(s.CG.length, 0);
  assert.strictEqual(s.list(9999).length, 0);
  assert.ok(s.galleryHtml({ level: 1, t: (k) => k }).html.includes('storyEmpty'));
});
