/* 每周活动「看得见的图」门禁（2026-09-03）。

   首坏现场：彩雷的周活动页从上线起就只有文字和 emoji —— 三个奖励档在代码里
   叫「第 N 张图」，却从来没有任何一张图被画出来；仓里其实早有 10 周的主题图
   （assets/weekly/banners/*.webp，倒水那边在用），彩雷只是没接线。
   这类缺陷不会让任何东西报错：页面照常渲染、测试照常绿、构建照常出包，
   只有玩家会奇怪「说好的图呢」。所以判据必须落在「图真的进了页面、也真的进了产物」上。

   本文件锁四件事：
   1. 配置是唯一权威：每周都声明 banner + anim，且文件真的存在（路径不许代码去拼）；
   2. 覆盖到当前周并留出提前量：过期了要在玩家看不到图**之前**红；
   3. 页面确实消费了这两条路径（主题卡背景图 / 每张图的缩略图 / 领奖动画）；
   4. 缺图时的降级是「明说 + 可观测」，不是留一块空白。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync, statSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = __dirname;
const html = readFileSync(join(ROOT, 'mine.html'), 'utf8');
const build = readFileSync(join(ROOT, 'scripts', 'build-publish-mine.mjs'), 'utf8');
const CFG_REL = 'assets/weekly/weekly-config.json';
const cfg = JSON.parse(readFileSync(join(ROOT, CFG_REL), 'utf8'));
const weeks = Object.keys(cfg).filter((k) => !k.startsWith('_'));

/* 与 core/weekly.js 的 isoWeekKey 同一口径（所在周的周四决定 ISO 年），
   这里独立实现一份是故意的：门禁若复用被测代码，代码错了门禁跟着错。 */
function isoWeekKey(now) {
  const d = new Date(now);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return t.getUTCFullYear() + '-W' + String(wk).padStart(2, '0');
}

test('每周活动配置：每周都声明主题图与领奖动图，且文件真的在', () => {
  assert.ok(weeks.length >= 10, `只配了 ${weeks.length} 周，活动图轮换会很快用完`);
  for (const wk of weeks) {
    assert.match(wk, /^\d{4}-W\d{2}$/, `周 key ${wk} 不是 ISO 周格式，客户端取不到`);
    for (const field of ['banner', 'anim']) {
      const rel = cfg[wk][field];
      assert.ok(rel, `${wk} 缺 ${field}`);
      assert.ok(existsSync(join(ROOT, rel)), `${wk} 的 ${field} 指向 ${rel}，文件不存在 → 玩家点开是 404`);
      assert.ok(statSync(join(ROOT, rel)).size > 1024, `${rel} 太小，八成是空壳`);
    }
    assert.match(cfg[wk].anim, /\.gif$/, `${wk} 的 anim 必须是动图`);
  }
});

/* 这条会随时间逼近失效日：那正是它的作用 —— 在玩家先发现「本周没有图」之前先红。
   续期动作：给 weekly-config.json 补新的周 key，并放好对应的 webp + gif。 */
test('周图配置必须覆盖当前周，并至少还剩 3 周提前量', () => {
  const now = Date.now();
  const need = [0, 1, 2, 3].map((i) => isoWeekKey(now + i * 7 * 86400000));
  const missing = need.filter((k) => !weeks.includes(k));
  assert.deepStrictEqual(missing, [],
    `这些周还没配主题图：${missing.join(', ')}（到那一周活动页就没图了，现在补还来得及）`);
});

test('活动页真的把当周主题图画出来了（卡片背景 + 每张图的缩略图）', () => {
  assert.match(html, /id="wkBanner"/, '活动卡缺当周主题图元素');
  assert.match(html, /banEl\.src = wkBanner/, '主题图没被真正赋 src，等于没接线');
  assert.match(html, /class="thumb"/, '三张「图」没有各自的缩略图，玩家还是只看到文字');
  assert.match(html, /object-position:' \+ pos/, '缩略图没有按左/中/右取不同的三分之一');
});

/* 呼应既有教训：弱化态不许抽掉色相 —— 那是这张图的身份，
   抽掉之后玩家不知道自己在收集什么。压暗可以，去饱和不行。 */
test('未解锁的图只压暗、不去饱和', () => {
  assert.match(html, /\.wkpic\.locked \.thumb img\{filter:brightness\(/, '锁态缩略图应当只降亮度');
  assert.ok(!/\.wkpic\.locked[^{]*\{[^}]*grayscale/.test(html), '锁态不许用 grayscale 抽掉色相');
});

test('领取时播放该周动画：三张图与大奖两条领取路径都接了', () => {
  assert.match(html, /function showWeeklyArt\(/, '缺少领奖动画函数');
  const hits = (html.match(/showWeeklyArt\(/g) || []).length;
  assert.ok(hits >= 3, `showWeeklyArt 应被定义并至少接到「领单张图」「领大奖」两处，实际出现 ${hits} 次`);
  assert.match(html, /art\.anim/, '领奖动画没有读配置里的 anim 路径');
});

test('领奖动画走标准 dialog()，不另开一个关不掉的层', () => {
  const at = html.indexOf('function showWeeklyArt(');
  const body = html.slice(at, at + 1400);
  assert.match(body, /dialog\(t\('wkArtTitle'/, '必须走 dialog()，✕/遮罩/Esc 三条退出路才自动继承');
  assert.ok(!/classList\.add\('show'\)/.test(body), '不许自己打开遮罩层绕过统一关闭入口');
});

/* 降级分支可观测（本机纪律第 5 条）：拉配置失败要记异常本体，
   正常与降级两侧都要能计数，缺图时用户看到的东西要与「正常但内容为空」可区分。 */
test('缺图/拉配置失败：有原因、可计数、玩家能分辨', () => {
  assert.match(html, /trace\('weekly_art_config', \{[\s\S]{0,400}?err_name/,
    '拉配置失败必须记 err_name/err_msg，否则线上没图谁也说不出为什么');
  assert.match(html, /trace\('weekly_art_config', \{\s*\n?\s*ok: 1/,
    '成功一侧也要记事件，否则算不出降级率');
  assert.match(html, /trace\('weekly_art_img'/, '图片加载失败是静默的，必须单独留痕');
  assert.match(html, /wkArtNoImg/, '没有图时要明说，不能只留一块空白让玩家以为没领到');
});

test('构建产物必须带上每周活动素材（漏了只会在玩家点开时静默 404）', () => {
  assert.match(build, /weekly-config\.json/, '构建脚本没处理每周活动配置');
  assert.match(build, /for \(const field of \['banner', 'anim'\]\)/, '构建没逐周核对两类素材');
  assert.match(build, /但文件不存在/, '构建对缺素材应当 fail-close，而不是出一个少图的包');
});

/* ============ 已领取也能重看动画（2026-09-07 用户实报） ============
   首坏现场：领取那一下会弹出这周的动图，但那是**唯一**一次机会——
   关掉之后已领取的行按钮变灰写「已领取」，怎么点都再看不到那幅画的动画版。
   收集类奖励的价值恰恰在「收藏后能反复看」，所以判据落在三件事上：
     ① 已领取的图行可点（按钮不灰、整行都是热区），点了走同一个放映函数；
     ② 已领的大奖同口径（按钮改「重看」且可点，只有未达标才灰）；
     ③ 重看**只放映不入账**——不许借重看再发一份奖励或改存档。 */
const vm = require('node:vm');

/* 按大括号配平抽函数体（不能切到「下一个 function」，会把后面的顶层代码算进来） */
function sliceFn(head) {
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

test('已领取的图：按钮不灰、整行可点，点了重看动画', () => {
  assert.match(html, /data-replay="' \+ i \+ '"/, '已领取的行没给重看入口（data-replay）');
  assert.ok(!/data-replay="' \+ i \+ '"[^']*disabled/.test(html), '重看按钮不许是 disabled');
  assert.match(html, /querySelectorAll\('\.wkpic\.claimed'\)[\s\S]{0,200}?wkReplayPic\(/,
    '整行没绑重看：只有按钮能点的话，玩家点画面本身会没反应');
  assert.match(html, /\.wkpic\.claimed\{cursor:pointer/, '已领取的行要有可点的手型提示');
});

test('已领的大奖：按钮改「重看」且保持可点，只有未达标才灰', () => {
  assert.match(html, /gb\.textContent = gs === 'claimed' \? t\('wkReplay'\)/,
    '大奖领完后按钮仍写「已领取」，玩家不知道还能重看');
  assert.match(html, /gb\.disabled = gs === 'locked'/, '已领取的大奖按钮不许灰掉');
  assert.match(html, /wkReplayGrand\(/, '大奖没接重看函数');
});

test('「重看」在两种语言里都有文案（占位符漂移会静默显示 key）', () => {
  for (const lang of ['en', 'zh']) {
    const dict = JSON.parse(readFileSync(join(ROOT, 'games/mine/game.config.json'), 'utf8')).i18n.locales[lang];
    assert.ok(dict.wkReplay, `${lang} 缺 wkReplay`);
  }
  assert.match(html, /"wkReplay"/, '内嵌配置副本没同步 wkReplay（页面读的是内嵌那份）');
});

/* 只放映不入账：把 wkReplayPic / wkReplayGrand 真跑一遍，
   任何入账函数被碰到就红——静态 grep 看不出「重看顺手又发了一份奖」。 */
test('重看只放映，不再发奖、不改存档', () => {
  const shown = [];
  const traced = [];
  const sandbox = {
    WeeklyCtl: { state: { r0: { type: 'coins', n: 30 }, claimed: [true, false, false], frags: 999 },
      load() { throw new Error('重看不该重新加载/覆写存档'); },
      claim() { throw new Error('重看不许走领取'); },
      claimGrand() { throw new Error('重看不许走领大奖'); },
      flush() { throw new Error('重看不许写存档'); } },
    Weekly: { grand: { coins: 500 } },
    grantWeeklyReward() { throw new Error('重看不许入账'); },
    Stock: { grant() { throw new Error('重看不许动只增账本'); } },
    showWeeklyArt: (pic, txt) => shown.push([pic, txt]),
    trace: (ev, d) => traced.push([ev, d]),
    wkPicName: (i) => 'pic' + i,
    wkThemeName: () => '本周主题',
    rewardText: (type, n) => type + '×' + n,
    t: (k, p) => k + (p ? ':' + JSON.stringify(p) : '')
  };
  vm.createContext(sandbox);
  vm.runInContext(sliceFn('function wkReplayPic('), sandbox);
  vm.runInContext(sliceFn('function wkReplayGrand('), sandbox);
  vm.runInContext('wkReplayPic(0); wkReplayGrand();', sandbox);

  assert.strictEqual(shown.length, 2, '两条重看路径都应当放映一次');
  assert.strictEqual(shown[0][0], 'pic0', '重看单张图要用这张图的名字');
  assert.match(shown[0][1], /coins×30/, '重看应当写清当时领到了什么');
  assert.strictEqual(shown[1][0], '本周主题', '重看大奖用整幅周图的主题名');
  assert.deepStrictEqual(traced.map((x) => x[0]), ['weekly_art_replay', 'weekly_art_replay'],
    '两条重看路径都要留痕，否则算不出「有多少人回头看」');
  assert.deepStrictEqual(traced.map((x) => x[1].kind), ['pic', 'grand'], '重看事件要能分辨图/大奖');
});
