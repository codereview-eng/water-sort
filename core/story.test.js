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

/* ── 播放机的声音路径：用可注入的假 window 真跑一遍 ────────────────────────
   首坏（2026-08-29）：图鉴点「重播」全程无声。CG 的 mp4 没有音轨，声音 100%
   来自 BGM；而 startBgm 被 st.muted 挡着，只有「播放开始之后再来一次手势」
   才解锁 —— 触发重播的那次点击的 pointerdown 早于播放机注册监听器，于是
   永远等不到那次手势。这里锁的是「由手势触发的播放必须直接有声」。 */
function fakeWin() {
  const nodes = {};
  const listeners = { pointerdown: [], keydown: [] };
  const audios = [];
  let audioPlayResult = () => Promise.resolve();
  const mkNode = (id) => {
    const n = {
      id,
      style: {},
      textContent: '',
      innerHTML: '',
      readyState: 4,
      muted: null,
      defaultMuted: null,
      volume: null,
      src: null,
      playCalls: 0,
      setAttribute() {},
      removeAttribute() {},
      appendChild() {},
      load() {},
      pause() {},
      play() { n.playCalls++; return Promise.resolve(); },
      querySelector(sel) { return (nodes[sel] = nodes[sel] || mkNode(sel)); }
    };
    return n;
  };
  const store = {};
  return {
    audios,
    listeners,
    node: (sel) => nodes[sel],
    setAudioPlay(fn) { audioPlayResult = fn; },
    fire(type) { listeners[type].slice().forEach((f) => f()); },
    win: {
      document: {
        createElement: (tag) => mkNode(tag),
        body: { appendChild() {} },
        addEventListener(t, f) { if (listeners[t]) listeners[t].push(f); },
        removeEventListener(t, f) {
          if (!listeners[t]) return;
          const i = listeners[t].indexOf(f);
          if (i >= 0) listeners[t].splice(i, 1);
        }
      },
      navigator: {},                     // 没有 userActivation ⇒ 只能靠 gesture 标记
      location: { hash: '' },
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); }
      },
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      URL: { createObjectURL: () => 'blob:x' },
      Audio: function (src) {
        const a = { src, volume: 1, played: false, pause() {} };
        a.play = function () { a.played = true; return audioPlayResult(); };
        audios.push(a);
        return a;
      }
    }
  };
}

const PLAYCFG = { count: 2, cadence: 100, seenKey: 'k.seen', media: { video: 'cg/cg{i}.mp4', bgm: 'cg/bgm{i}.opus' } };

test('图鉴重播必须直接有声：视频不静音 + BGM 立即起播（不等下一次手势）', () => {
  const f = fakeWin();
  const s = StoryCore.create(PLAYCFG, f.win);
  s.replay('cg0', () => {});
  const vid = f.node('#cgVideo');
  assert.strictEqual(vid.muted, false, '由手势触发的重播不得静音起播');
  vid.onplaying();                                   // 播放机在 playing 后才起 BGM
  assert.strictEqual(f.audios.length, 1, '重播必须立刻创建 BGM，声音全靠它（mp4 无音轨）');
  assert.strictEqual(f.audios[0].src, 'cg/bgm0.opus');
  assert.ok(f.audios[0].played, 'BGM 必须真的 play()');
});

test('BGM 被自动播放策略挡掉后，下一次手势要能补回来（不能被幂等判定吃掉）', () => {
  const f = fakeWin();
  f.setAudioPlay(() => Promise.reject(new Error('NotAllowedError')));
  const s = StoryCore.create(PLAYCFG, f.win);
  s.replay('cg0', () => {});
  f.node('#cgVideo').onplaying();
  return Promise.resolve().then(() => {
    f.setAudioPlay(() => Promise.resolve());
    f.fire('pointerdown');
    assert.strictEqual(f.audios.length, 2, '挡掉过一次后，手势必须能再起一次 BGM');
    assert.ok(f.audios[1].played);
  });
});

test('CG 收口必须摘掉手势监听器（否则每播一段泄漏一对）', () => {
  const f = fakeWin();
  const s = StoryCore.create(PLAYCFG, f.win);
  s.replay('cg0', () => {});
  assert.strictEqual(f.listeners.pointerdown.length, 1, '播放期间挂着手势兜底');
  f.node('#cgSkip').onclick();                        // 跳过 ⇒ end()
  assert.strictEqual(f.listeners.pointerdown.length, 0, 'end() 必须摘监听器');
  assert.strictEqual(f.listeners.keydown.length, 0);
});
