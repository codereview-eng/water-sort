'use strict';
/* water config↔页面消费一致性（issue #1 · 首页统一）：
   ① water.html 内嵌 gameConfig 必须与 games/water/game.config.json 逐字段一致；
   ② screens.home 声明必须能被 ShellCore+HomeCore(+water 扩展) 真实渲染（拒绝「config 是文档」回潮）；
   ③ 首页手写 markup 必须已移除，页面确实经 ShellCore 装配。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Shell = require('./core/shell.js');
const Home = require('./core/home.js');
const WaterHome = require('./water-home.js');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/water/game.config.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, 'water.html'), 'utf8');

function embedded() {
  const m = html.match(/<script id="gameConfig" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'water.html 缺内嵌 gameConfig JSON 块');
  return JSON.parse(m[1]);
}

test('water.html 内嵌 gameConfig 与 games/water/game.config.json 逐字段一致', () => {
  assert.deepStrictEqual(embedded(), cfg);
});

test('screens.home 声明可被 ShellCore+HomeCore+water 扩展完整渲染且含全部回填锚点', () => {
  const parts = Shell.create(Home.registry(WaterHome.extensions()), { home: cfg.screens.home }).render('home', {});
  assert.strictEqual(parts.length, cfg.screens.home.modules.length);
  for (const p of parts) assert.ok(typeof p === 'string' && p.length > 0, '模块渲染产出空 markup');
  const joined = parts.join('');
  for (const id of ['btnStart', 'startLv', 'enVal', 'enBar', 'enSub', 'btnWeekly', 'wkBadge', 'wkEntryTitle', 'wkEntrySub', 'wkEntryFrag', 'btnLb', 'stWins', 'stBottles', 'btnIdentity', 'idName', 'idAvatar', 'idSource', 'idSub', 'idAction', 'sfxToggle', 'langSel']) {
    assert.ok(joined.includes('id="' + id + '"'), '缺回填锚点 ' + id);
  }
  /* 两栏身份合一：旧的「玩家名称行 + run.ceo 账号行」不得再出现，
     否则首页又是两个名字，且其中一个还带本地改名入口 */
  for (const gone of ['btnProfile', 'profileLabel', 'btnAccount', 'accountStatus', 'accountAction']) {
    assert.ok(!joined.includes('id="' + gone + '"'), '首页仍残留旧两栏锚点 ' + gone);
  }
});

test('platform 配置过 PlatformCore 校验：字段映射列与 schema.json 实体一致，页面经 connect 消费', () => {
  const PlatformCore = require('./core/platform.js');
  const P = PlatformCore.create(cfg.platform);
  assert.strictEqual(P.entity, 'Save');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/water/schema.json'), 'utf8'));
  const entity = schema.entities[cfg.platform.entity];
  assert.ok(entity, 'games/water/schema.json 缺实体 ' + cfg.platform.entity);
  for (const key of Object.keys(cfg.platform.fields)) {
    const col = cfg.platform.fields[key].col;
    assert.ok(entity.fields[col], 'schema.json 实体缺列 ' + col + '（fields.' + key + ' 映射悬空）');
  }
  assert.strictEqual(entity.fields.updated_ms, 'number', 'schema 必须声明 updated_ms number（云档判新列）');
  assert.ok(html.includes('PlatformCore.connect(GAME_CFG.platform)'), '页面未经 PlatformCore 消费 platform 配置');
  assert.ok(html.includes('<script src="./core/platform.js"></script>'), '页面未引入 core/platform.js');
  const joined = Shell.create(Home.registry(WaterHome.extensions()), { home: cfg.screens.home }).render('home', {}).join('');
  assert.ok(joined.includes('id="btnIdentity"'), '首页缺 identity-row 回填锚点');
});

test('身份显示：单栏身份行接线齐全，游戏内没有任何本地改名入口', () => {
  assert.ok(html.includes('<script src="./core/identity.js"></script>'), '页面未引入 core/identity.js');
  for (const hook of ['IdentityCore.resolve', 'function renderIdentity', "getElementById('btnIdentity')",
    'IdentityCore.renameUrl', 'IdentityCore.takeRenameFlag', 'IdentityCore.renameOutcome']) {
    assert.ok(html.includes(hook), '页面缺身份行接线 ' + hook);
  }
  /* 定案：改名只能改 run.ceo 上本游戏的云端名称，游戏内不得有输入框/prompt */
  for (const banned of ['profileInput', 'profileEditTitle', 'normalizeAlias', 'window.prompt', 'renderAccount(']) {
    assert.ok(!html.includes(banned), '页面仍残留本地改名/旧账号行代码 ' + banned);
  }
  /* 改名跳转必须走平台契约参数名，且默认只改本游戏 */
  const Identity = require('./core/identity.js');
  const url = Identity.renameUrl({ apex: 'https://run.ceo', slug: 'water-sort', returnTo: 'https://play-water-sort.run.ceo/' });
  assert.ok(url.startsWith('https://run.ceo/coder/play/nickname?'), '改名地址不是平台改名页');
  assert.ok(url.includes('scope=perGame'), '改名默认必须是 perGame');
});

test('water 扩展不与通用模块重名，且页面经 ShellCore 消费、手写首页已移除', () => {
  assert.throws(() => Home.registry(new Map([['logo', () => '']])), /重名/);
  assert.ok(html.includes('ShellCore.create(HomeCore.registry(WaterHome.extensions())'), '页面未经 ShellCore 渲染 screens.home');
  assert.ok(!/<button class="eventbtn" id="btnWeekly">\s*</.test(html), '仍有手写 btnWeekly markup（首页必须由模块渲染）');
  assert.ok(!/<div class="logo">倒水排序<em>/.test(html), '仍有手写 logo markup（首页必须由模块渲染）');
});

/* 单一权威实现：语言选择必须走 core/locale.js，两个游戏同源，不许各写一套。
   （2026-08-20：倒水原本自带 detectLang/resolveLang 副本，与彩雷各写一份，已合并到 core） */
test('语言选择走 core/locale.js，页面不得自带第二份决策链实现', () => {
  assert.ok(html.includes('<script src="./core/locale.js"></script>'), '未引入 core/locale.js');
  assert.ok(html.includes('LocaleCore.resolveLang('), '语言选择未走 core 的 resolveLang');
  // 不得再有本地实现（注释里提到名字不算，这里查函数声明）
  assert.ok(!/function detectLang\s*\(/.test(html), 'water.html 仍自带 detectLang 实现（应删，统一走 core）');
  assert.ok(!/const cand = \(m && m\[1\]\) \|\| tgCode/.test(html), '仍残留旧的本地语言检测逻辑');
  // 可用语言必须由字典派生，不能写死
  assert.ok(/LANG_AVAILABLE = Object\.keys\(I18N\)/.test(html), '可用语言应由 I18N 字典派生');
});

test('两个游戏共用同一份 core 语言实现（同源断言）', () => {
  const mineHtml = fs.readFileSync(path.join(__dirname, 'mine.html'), 'utf8');
  for (const [name, src] of [['water.html', html], ['mine.html', mineHtml]]) {
    assert.ok(src.includes('./core/locale.js'), name + ' 未引入 core/locale.js');
    assert.ok(src.includes('LocaleCore.resolveLang('), name + ' 未走 core 的 resolveLang');
  }
  // core 必须真的导出这三个共用函数
  const L = require('./core/locale.js');
  for (const fn of ['resolveLang', 'matchLang', 'htmlLang', 'createI18n']) {
    assert.strictEqual(typeof L[fn], 'function', 'core/locale.js 缺导出 ' + fn);
  }
});

/* ---- 广告统一走 core（2026-08-21）：倒水原本自带第四份实现（Monetag 桥 + 演示模式白送）---- */
const AdPlayCore = require('./core/adplay.js');
const PlacementsCore = require('./core/placements.js');

test('广告走 core，不得再自带 Monetag 桥与「演示模式」白送', () => {
  assert.ok(html.includes('<script src="./core/adplay.js"></script>'), '未引入 core/adplay.js');
  assert.ok(html.includes('AdPlayCore.create('), '未用 core 建广告实例');
  assert.ok(!/MONETAG_ZONE_ID/.test(html), '仍残留本地 Monetag 常量（zone 应写在 config.ads.play.zoneId）');
  // 旧实现的特征：拿到 show_<zone> 就直接调、或未配置就 setTimeout 后白送
  assert.ok(!/window\['show_'\s*\+\s*MONETAG_ZONE_ID\]/.test(html), '仍残留本地 Monetag 桥');
  assert.ok(!/setTimeout\(resolve,\s*1200\)/.test(html), '仍残留「演示模式」直接发奖');
  // 兜底卡必须存在（Monetag 无填充时不能白送）
  assert.ok(html.includes('function houseAd'), '缺兜底广告卡实现');
  // 倒水的广告卡是运行时用 JS 建的（不是静态 HTML），所以查建它的代码
  assert.ok(/el\.id = 'adMask'/.test(html), '缺兜底广告卡 DOM 构建');
  assert.ok(/appendChild\(el\)/.test(html), '广告卡未挂到页面上');
});

test('广告按环境分流：TMA zone 只在 Telegram 内用，网页流量走 Website zone', () => {
  const mineCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/mine/game.config.json'), 'utf8'));
  const mineHtml = fs.readFileSync(path.join(__dirname, 'mine.html'), 'utf8');

  for (const [name, gcfg, src] of [['water', cfg, html], ['mine', mineCfg, mineHtml]]) {
    // 两边都走同一份 core
    assert.ok(src.includes('./core/adplay.js'), name + ' 未引入 core/adplay.js');
    assert.ok(/AdPlayCore\.create\(/.test(src), name + ' 未用 core 建实例');

    const list = gcfg.ads.play.sources;
    assert.ok(Array.isArray(list) && list.length > 0, name + ' 缺 ads.play.sources');

    // Monetag 的 TMA zone 必须限定 env=telegram —— 否则网页流量会打到 Mini App 广告位（无效流量）
    const tma = list.filter((x) => typeof x === 'object' && x.type === 'monetag' && x.zoneId);
    for (const z of tma) {
      assert.strictEqual(z.env, 'telegram',
        `${name}: Monetag zone ${z.zoneId} 必须限定 env=telegram（TMA 通道只对 Telegram 内流量有效）`);
    }
    // 必须给网页流量留一个源（web 专用或不限环境），否则浏览器里永远只有兜底卡
    const webCapable = list.some((x) => {
      const o = typeof x === 'string' ? { type: x } : x;
      return o.type !== 'house' && (o.env === 'web' || !o.env);
    });
    assert.ok(webCapable, name + ' 网页流量没有任何真实广告源（浏览器里只会看到兜底卡）');

    // 兜底必须在链尾
    const last = list[list.length - 1];
    assert.strictEqual((typeof last === 'string' ? last : last.type), 'house', name + ' 最后一个源必须是 house');

    // SDK 改为按需加载：不得再往 head 静态塞 zone 标签（会把 TMA 的 SDK 灌给网页流量）
    assert.ok(!/libtl\.com\/sdk\.js" data-zone=/.test(src), name + ' 仍有静态 Monetag SDK 标签');
    assert.ok(/function loadMonetagSdk/.test(src), name + ' 缺按需 SDK 加载器');
  }

  // 各自可配仍成立（兜底时长不同）
  const water = AdPlayCore.create(cfg.ads.play, { houseAd: (s, d) => d(true) });
  const mine = AdPlayCore.create(mineCfg.ads.play, { houseAd: (s, d) => d(true) });
  assert.notStrictEqual(water.houseSeconds, mine.houseSeconds, '兜底时长各自可配');

  // 实证分流：同一份配置在两种环境下选出的源不同
  const tgEnv = { Telegram: { WebApp: { initData: 'x', initDataUnsafe: { user: { id: 1 } } } } };
  const inTg = AdPlayCore.create(mineCfg.ads.play, { env: tgEnv, houseAd: (s, d) => d(true) });
  const inWeb = AdPlayCore.create(mineCfg.ads.play, { env: {}, houseAd: (s, d) => d(true) });
  assert.strictEqual(inTg.inTelegram(), true);
  assert.strictEqual(inWeb.inTelegram(), false);
  const tgZones = inTg.sourceList.filter((x) => x.env === 'telegram');
  assert.ok(tgZones.length > 0, 'Telegram 环境应有专属广告源');
});


test('网页侧变现分工：Direct Link 管奖励，Multitag 管被动，且都不进 Telegram', () => {
  const mineCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/mine/game.config.json'), 'utf8'));
  const mineHtml = fs.readFileSync(path.join(__dirname, 'mine.html'), 'utf8');

  for (const [name, gcfg, src] of [['water', cfg, html], ['mine', mineCfg, mineHtml]]) {
    const list = gcfg.ads.play.sources;

    // ① 奖励流程：浏览器侧必须是 directlink（六种网站格式里唯一有玩家主动触发语义的）
    const dl = list.find((x) => typeof x === 'object' && x.type === 'directlink');
    assert.ok(dl, name + ' 缺 directlink 源（浏览器里就只剩兜底卡，没有真实广告收入）');
    assert.strictEqual(dl.env, 'web', name + ' directlink 必须限定 env=web（Telegram 内开外部标签体验灾难）');
    assert.match(dl.url, /^https:\/\//, name + ' directlink.url 必须是 https');

    // ② 被动收入：Multitag 必须限定 web，且只声明在首页
    const mt = gcfg.ads.passive && gcfg.ads.passive.multitag;
    assert.ok(mt && mt.src && mt.zone, name + ' 缺 ads.passive.multitag');
    assert.strictEqual(mt.env, 'web', name + ' multitag 必须限定 env=web');
    assert.deepStrictEqual(mt.screens, ['home'],
      name + ' multitag 只能声明在首页：它含 Onclick popunder，对局中每点一格都是一次 click');

    // ③ 页面接线：按需注入，不得静态引入（静态引入等于在 Telegram 里也加载）
    assert.ok(/function loadMultitag/.test(src), name + ' 缺 loadMultitag 注入器');
    /* 只查真正的 <script src="..."> 标签。不能用 includes(url) 粗判：
       内嵌的 gameConfig JSON 里本来就有 "src":"<url>"，那会误报。 */
    const staticTag = new RegExp('<script[^>]*\\ssrc=["\']' + mt.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.ok(!staticTag.test(src), name + ' 不得把 multitag 静态写成 <script src>（Telegram 里也会加载）');
    assert.ok(/AdPlay\.inTelegram\(\)/.test(src), name + ' loadMultitag 必须先判环境');
    assert.ok(/openUrl: openExternal/.test(src), name + ' 未把 openExternal 注入 core（directlink 会不可用）');

    // ④ window.open 的 noopener 坑：写进 features 会返回 null，把成功误判成被拦。
    //    必须先剥注释再断言 —— 代码里正解释这个坑的注释本身就含反面写法，直接扫会自我误报。
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')            // 块注释
      .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1');      // 行注释（避开 https:// 里的双斜杠）
    assert.ok(!/window\.open\([^)]*noopener/.test(codeOnly),
      name + ": window.open 的 features 不能含 noopener（规范返回 null，会把成功误判为被拦弹窗）");
    assert.ok(/window\.open\(/.test(codeOnly), name + ' openExternal 里没有真的 window.open');
  }

  // ⑤ Direct Link 按访问计费 → 必须有每日上限，否则易被判无效流量
  const caps = mineCfg.ads.placements;
  assert.ok(caps['tool-refill'].capping && caps['tool-refill'].capping.maxPerDay > 0,
    'tool-refill 缺 maxPerDay（Direct Link 无上限领奖会被判无效流量）');
});
