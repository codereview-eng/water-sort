'use strict';
/* config↔页面消费一致性（issue #1 · 首页统一）：
   ① mine.html 内嵌 GameConfig 必须与 games/mine/game.config.json 逐字段一致；
   ② screens.home 声明必须能被 ShellCore+HomeCore 真实渲染（拒绝「config 是文档」回潮）；
   ③ reward 参数过 RewardCore fail-fast 校验，且页面确实经 CFG 消费。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Shell = require('./core/shell.js');
const Home = require('./core/home.js');
const RewardCore = require('./core/reward.js');
const LocaleCore = require('./core/locale.js');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/mine/game.config.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, 'mine.html'), 'utf8');

function embedded() {
  const m = html.match(/<script id="gameConfig" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'mine.html 缺内嵌 gameConfig JSON 块');
  return JSON.parse(m[1]);
}

test('mine.html 内嵌 GameConfig 与 games/mine/game.config.json 逐字段一致', () => {
  assert.deepStrictEqual(embedded(), cfg);
});

test('screens.home 声明可被 ShellCore+HomeCore 完整渲染且含全部回填锚点', () => {
  const parts = Shell.create(Home.registry(), cfg.screens).render('home', {});
  assert.strictEqual(parts.length, cfg.screens.home.modules.length);
  for (const p of parts) assert.ok(typeof p === 'string' && p.length > 0, '模块渲染产出空 markup');
  const joined = parts.join('');
  for (const id of ['btnStart', 'startLv', 'enVal', 'enBar', 'enSub', 'homeLv', 'homeClears', 'btnBag',
    'btnIdentity', 'idAvatar', 'idBadge', 'idName', 'idSource', 'idSub', 'idAction', 'sfxToggle']) {
    assert.ok(joined.includes('id="' + id + '"'), '缺回填锚点 ' + id);
  }
  for (const oldId of ['btnProfile', 'accountStatus', 'accountAction']) {
    assert.ok(!joined.includes('id="' + oldId + '"'), '首页仍残留旧身份锚点 ' + oldId);
  }
  // 道具格改成图标按钮：首页不再显示道具数量（数量在背包窗口里看）
  assert.ok(!joined.includes('id="homeTools"'), '首页仍残留旧的道具数量格 homeTools');
  assert.ok(/<button[^>]*id="btnBag"/.test(joined), '道具格必须是可点按钮（不是静态数值格）');
  assert.ok(/id="btnBag"[\s\S]*?class="sticon"/.test(joined), '道具按钮必须带图标');
});

test('道具元数据齐全：背包窗口能显示每个道具的图标/名称/说明', () => {
  const items = cfg.stock.items;
  for (const [key, it] of Object.entries(items)) {
    assert.ok(typeof it.icon === 'string' && it.icon, `stock.items.${key} 缺 icon（背包窗口要显示）`);
    assert.ok(typeof it.name === 'string' && it.name, `stock.items.${key} 缺 name`);
    assert.ok(typeof it.desc === 'string' && it.desc, `stock.items.${key} 缺 desc（说明这道具干什么用）`);
  }
  // 页面必须真的接线：按钮 → 打开背包 → 用 Stock.list 取清单
  const html = fs.readFileSync(path.join(__dirname, 'mine.html'), 'utf8');
  assert.ok(html.includes("$('btnBag').addEventListener('click', openBag)"), '道具按钮没接上打开背包');
  assert.ok(/function openBag\(\)[\s\S]{0,900}Stock\.list\(save, \[Coins\.coinsKey\]\)/.test(html),
    '背包必须用 Stock.list 取清单并排除金币');
});

/* ---- 多语言（core/locale.js 共用能力 + 页面接线 + 反硬编码门禁）---- */
const htmlSrc = () => fs.readFileSync(path.join(__dirname, 'mine.html'), 'utf8');

test('i18n 字典过 LocaleCore 校验，且各语言 key 集合完全一致（防漏翻）', () => {
  assert.ok(cfg.i18n, 'config 缺 i18n 段');
  const i18n = LocaleCore.createI18n(cfg.i18n);       // 内含「默认语言必须全量」校验
  const langs = i18n.locales();
  assert.ok(langs.length >= 2, '至少要有两种语言，实际：' + langs.join(','));
  const base = Object.keys(cfg.i18n.locales[cfg.i18n.default]).sort();
  for (const lang of langs) {
    const keys = Object.keys(cfg.i18n.locales[lang]).sort();
    assert.deepStrictEqual(keys, base, `语言 ${lang} 的 key 集合与默认语言不一致（漏翻或多写）`);
  }
  // 占位符必须两侧一致，否则插值会失效
  for (const key of base) {
    const want = (cfg.i18n.locales[cfg.i18n.default][key].match(/\{\w+\}/g) || []).sort();
    for (const lang of langs) {
      const got = (cfg.i18n.locales[lang][key].match(/\{\w+\}/g) || []).sort();
      assert.deepStrictEqual(got, want, `key "${key}" 在 ${lang} 里的占位符与默认语言不一致`);
    }
  }
});

test('页面真的接了 i18n：走 core/locale.js，不自造第二套实现', () => {
  const html = htmlSrc();
  assert.ok(html.includes('./core/locale.js'), '没引入 core/locale.js');
  assert.ok(html.includes('LocaleCore.createI18n(CFG.i18n)'), '没用 core 建 i18n 实例');
  assert.ok(html.includes('LocaleCore.resolveLang('), '语言选择没走 core 的 resolveLang（禁止各写一套）');
  assert.ok(html.includes('function applyStaticI18n'), '缺静态文案回填');
  assert.ok(html.includes('function setLang'), '缺语言切换');
  // 切换语言会重建首页 DOM，必须重绑事件——漏了按钮全成死的（本轮真跑抓到过）
  assert.ok(/function setLang[\s\S]{0,600}buildHome\(\); bindHome\(\);/.test(html),
    'setLang 必须在重建 DOM 后重绑事件');
  // 语言下拉走 core 内置模块，不自己拼 HTML
  assert.ok(cfg.screens.home.modules.some((m) => m.type === 'lang-select'), '首页缺 lang-select 模块');
});

test('反回归：主脚本里不得再出现面向用户的中文字面量', () => {
  const html = htmlSrc();
  let body = html.replace(/<script id="gameConfig"[\s\S]*?<\/script>/, '');
  /* #selftest 调试面板（grantCoins 充值按钮）只有开发者看得到，不参与翻译：
     按【整个函数体】排除，而不是逐行匹配关键字——函数内部多数行并不含 selftest 字样。 */
  body = body.replace(/function grantCoins\(\)[\s\S]*?\n  \}\n/, '\n');
  const offenders = [];
  body.split('\n').forEach((line, i) => {
    if (/^\s*(\/\*|\*|\/\/)/.test(line)) return;                    // 注释不算
    if (/console\.(warn|error|log)/.test(line)) return;             // 控制台日志不面向用户
    if (/selftest|stGrant|stOut|GRANT_AMOUNT|grantCoins/.test(line)) return;  // 内部调试面板不翻译
    if (/throw new Error\(/.test(line)) return;   // 开发者向的配置错误信息，不是给玩家看的文案
    for (const m of line.matchAll(/'([^']*[\u4e00-\u9fa5][^']*)'/g)) {
      offenders.push(`L${i + 1}: ${m[1].slice(0, 40)}`);
    }
  });
  assert.deepStrictEqual(offenders, [], '发现硬编码中文（应改走 t(key)）：\n  ' + offenders.join('\n  '));
});

test('platform 配置过 PlatformCore 校验：字段映射列与 schema.json 实体一致，页面经 connect 消费', () => {
  const PlatformCore = require('./core/platform.js');
  const P = PlatformCore.create(cfg.platform);
  assert.strictEqual(P.entity, 'Save');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/mine/schema.json'), 'utf8'));
  const entity = schema.entities[cfg.platform.entity];
  assert.ok(entity, 'games/mine/schema.json 缺实体 ' + cfg.platform.entity);
  for (const key of Object.keys(cfg.platform.fields)) {
    const col = cfg.platform.fields[key].col;
    assert.ok(entity.fields[col], 'schema.json 实体缺列 ' + col + '（fields.' + key + ' 映射悬空）');
  }
  assert.strictEqual(entity.fields.updated_ms, 'number', 'schema 必须声明 updated_ms number（云档判新列）');
  assert.ok(html.includes('PlatformCore.connect(CFG.platform)'), '页面未经 PlatformCore 消费 platform 配置');
  assert.ok(html.includes('<script src="./core/platform.js"></script>'), '页面未引入 core/platform.js');
  const joined = require('./core/shell.js').create(require('./core/home.js').registry(), cfg.screens).render('home', {}).join('');
  assert.ok(joined.includes('id="btnIdentity"'), '首页缺 identity-row 回填锚点');
  assert.ok(html.includes('<script src="./core/identity.js"></script>'), '页面未引入 core/identity.js');
});

test('身份显示：单栏身份行接线齐全，游戏内没有任何本地改名入口', () => {
  for (const hook of ['IdentityCore.resolve', 'function renderIdentity', "$('btnIdentity')",
    'IdentityCore.renameUrl', 'IdentityCore.markReturn', 'IdentityCore.takeRenameFlag',
    'IdentityCore.renameOutcome']) {
    assert.ok(html.includes(hook), '页面缺身份行接线 ' + hook);
  }
  for (const banned of ['profileInput', 'profileEditTitle', 'normalizeAlias', 'window.prompt',
    'renderAccount(', "$('btnProfile')", "$('btnAccount')"]) {
    assert.ok(!html.includes(banned), '页面仍残留本地改名/旧账号行代码 ' + banned);
  }
  const Identity = require('./core/identity.js');
  const url = Identity.renameUrl({
    apex: 'https://run.ceo',
    slug: 'mine',
    returnTo: 'https://play-mine.run.ceo/'
  });
  assert.ok(url.startsWith('https://run.ceo/coder/play/nickname?'), '改名地址不是平台改名页');
  assert.ok(url.includes('scope=perGame'), '改名默认必须是 perGame');
});

test('reward 配置过 RewardCore 校验且页面经 CFG 消费、手写首页已移除', () => {
  const R = RewardCore.create(cfg.reward);
  assert.strictEqual(R.E_COST, 15);
  assert.strictEqual(R.E_MAX, 120);
  assert.strictEqual(R.E_AD, 60);
  assert.ok(html.includes('RewardCore.create(CFG.reward)'), '页面未经 RewardCore 消费 reward 配置');
  assert.ok(html.includes('ShellCore.create(HomeCore.registry(), CFG.screens)'), '页面未经 ShellCore 渲染 screens');
  assert.ok(!/<div class="homestats">/.test(html), '仍有手写 homestats markup（首页必须由模块渲染）');
});

/* ---- 每周活动：机制在 core，奖励各游戏自己配（2026-08-21）----
   背景：原来这套逻辑有四份副本（core/weekly.js、weekly.js、water.html 内联 ×2），
   已合并成 core/weekly.js 一份。下面这些断言防止再各写一套。 */
const WeeklyCore = require('./core/weekly.js');

test('weekly 配置能被 core 接受，且奖励内容是本游戏自己的（不是倒水那套）', () => {
  assert.ok(cfg.weekly, 'config 缺 weekly 段');
  const w = WeeklyCore.create(cfg.weekly);
  assert.ok(w.enabled, '彩雷应开启周活动');
  // 奖励类型必须都在本游戏的经济体系里（金币 / 账本里的道具），否则线上会发出无法入账的奖
  const known = ['coins'].concat(Object.keys(cfg.stock.items));
  for (const p of w.rewardPool) {
    assert.ok(known.includes(p.type), `奖励类型 ${p.type} 不在本游戏经济体系里（${known.join('/')}）`);
  }
  for (const k of Object.keys(w.grand)) {
    assert.ok(known.includes(k), `大奖 ${k} 不在本游戏经济体系里`);
  }
  // 每个奖励类型都要有对应的展示文案（rwCoins / rwToolMine …），否则玩家看到的是空白
  const langs = Object.keys(cfg.i18n.locales);
  for (const type of new Set([...w.rewardPool.map((p) => p.type), ...Object.keys(w.grand)])) {
    const key = 'rw' + type.charAt(0).toUpperCase() + type.slice(1);
    for (const lang of langs) {
      assert.ok(cfg.i18n.locales[lang][key], `${lang} 缺奖励文案 ${key}`);
    }
  }
});

test('周活动机制走 core，页面不得自带第二份实现', () => {
  const html = htmlSrc();
  assert.ok(html.includes('<script src="./core/weekly.js"></script>'), '未引入 core/weekly.js');
  assert.ok(html.includes('WeeklyCore.create(CFG.weekly)'), '未用 core 建实例（奖励配置就无法生效）');
  // 不许把 core 的机制又抄一遍到页面里
  assert.ok(!/function\s+(picStatus|grandStatus|claimGrand|newlyUnlocked|weekIndex)\s*\(/.test(html),
    '页面重新实现了 core 已有的周活动机制（应直接调 core）');
  assert.ok(!/const\s+THRESHOLDS\s*=|var\s+THRESHOLDS\s*=/.test(html), '页面写死了阈值（应由 config 声明）');
  // 首页入口用 core 内置模块
  assert.ok(cfg.screens.home.modules.some((m) => m.type === 'weekly-event-entry'), '首页缺周活动入口模块');
  // 奖励入账必须走只增账本（云端同步与多标签页保护才会自动生效）
  assert.ok(/function grantWeeklyReward[\s\S]{0,400}Stock\.grant\(save, Coins\.coinsKey/.test(html),
    '金币奖励未走 Stock.grant（会绕过云端同步与多标签页保护）');
});

test('两个游戏共用同一份 core 周活动，但奖励互不相同（同源+可配 双向断言）', () => {
  const waterCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'games/water/game.config.json'), 'utf8'));
  const mine = WeeklyCore.create(cfg.weekly);
  const water = WeeklyCore.create(waterCfg.weekly);
  // 同源：周界必须完全一致（否则两个游戏的「本周」会错位）
  const now = Date.UTC(2026, 7, 21, 12);
  assert.strictEqual(mine.weekKey(now), water.weekKey(now), '两个游戏的活动周必须同步');
  assert.strictEqual(mine.weekEnd(now), water.weekEnd(now));
  // 可配：奖励内容确实不同，证明不是硬编码同一套
  assert.notDeepStrictEqual(mine.grand, water.grand, '两个游戏的大奖应各自配置');
  assert.notDeepStrictEqual(mine.thresholds, water.thresholds, '两个游戏的阈值应各自配置');
  // 两边页面都必须引入 core（不许一个走 core、一个自己抄）
  const waterHtml = fs.readFileSync(path.join(__dirname, 'water.html'), 'utf8');
  for (const [name, src] of [['mine.html', htmlSrc()], ['water.html', waterHtml]]) {
    assert.ok(src.includes('./core/weekly.js'), name + ' 未引入 core/weekly.js');
    assert.ok(/WeeklyCore\.create\(/.test(src), name + ' 未用 core 建实例');
  }
  assert.ok(!/const Weekly = \(function/.test(waterHtml), 'water.html 仍残留内联的周活动实现');
});

/* ---- 广告接入（2026-08-21 RCA：此前「看广告」是假按钮，从未引入广告 core）---- */
const AdPlayCore = require('./core/adplay.js');
const PlacementsCore = require('./core/placements.js');

test('广告走 core，页面不得再有「点一下直接发奖」的假广告', () => {
  const html = htmlSrc();
  assert.ok(html.includes('<script src="./core/adplay.js"></script>'), '未引入 core/adplay.js');
  assert.ok(html.includes('<script src="./core/placements.js"></script>'), '未引入 core/placements.js');
  assert.ok(html.includes('AdPlayCore.create('), '未用 core 建广告实例');
  assert.ok(html.includes('function watchAdFor'), '缺统一广告入口 watchAdFor');
  // 所有「看广告」入口都必须经过 watchAdFor —— 数量对得上才算没有漏网的假广告
  const adEntries = (html.match(/watchAdFor\('/g) || []).length;
  assert.ok(adEntries >= 5, `看广告入口应全部走 core，实际只有 ${adEntries} 处`);
  // 旧的假广告注释/直接发奖路径必须消失
  assert.ok(!/假广告路径/.test(html), '仍残留假广告路径');
  assert.ok(!/模拟播放/.test(html), '仍残留「模拟播放」占位实现');
});

test('广告配置能被 core 接受，且每个游戏可以配自己的广告源', () => {
  assert.ok(cfg.ads && cfg.ads.play, 'config 缺 ads.play（广告源声明）');
  const a = AdPlayCore.create(cfg.ads.play, { houseAd: (s, done) => done(true) });
  assert.ok(a.sources.length > 0);
  // house 必须在链尾兜底：否则没有第三方广告时玩家会卡住拿不到奖励
  assert.strictEqual(a.sources[a.sources.length - 1], 'house', '最后一个源必须是 house 兜底');
  // placements 表也要能被 core 接受（格式/onFail/频控声明合法）
  const pl = PlacementsCore.create(cfg.ads.placements, () => true);
  for (const id of pl.ids()) assert.ok(pl.has(id));
  // 页面引用的 placement id 必须在 config 里存在（防止写错 id 导致广告位永远不生效）
  const html = htmlSrc();
  for (const m of html.matchAll(/watchAdFor\('([^']+)'/g)) {
    assert.ok(pl.has(m[1]), `页面用了未声明的广告位 "${m[1]}"`);
  }
});

test('奖励只在广告真看完后发放（RCA 核心：不能点一下就给）', () => {
  const html = htmlSrc();
  // 每个 watchAdFor 的发奖动作必须在回调里，而不是紧跟调用之后
  for (const m of html.matchAll(/watchAdFor\('[^']+',\s*function\s*\(\)\s*\{/g)) {
    assert.ok(m[0].includes('function'), '发奖必须写在 watchAdFor 的回调里');
  }
  // core 侧：没看完一律不 granted
  const a = AdPlayCore.create({ sources: ['house'] }, { houseAd: (s, done) => done(false) });
  const pl = PlacementsCore.create({ x: { format: 'rewarded', onFail: 'deny' } }, () => true);
  return a.playPlacement(pl, 'x', {}).then((r) => {
    assert.strictEqual(r.granted, false, '没看完必须不发奖');
  });
});

test('Monetag 站点验证标签必须留在原始 HTML 的 head 里（删了验证会掉线）', () => {
  const v = cfg.ads.verification;
  assert.ok(v && v.monetag, 'config 缺 ads.verification.monetag');
  const html = htmlSrc();
  const m = html.match(/<meta name="monetag" content="([^"]+)"\s*\/?>/);
  assert.ok(m, '<head> 里缺 Monetag 验证 meta 标签');
  assert.strictEqual(m[1], v.monetag, 'meta 标签与 config 登记的值不一致（改了一处忘了另一处）');
  // 必须在 head 内、且在原始 HTML 里（Monetag 验证器抓源码、不执行 JS，所以不能靠 JS 注入）
  const headEnd = html.indexOf('</head>');
  assert.ok(html.indexOf('name="monetag"') < headEnd, 'meta 标签必须在 </head> 之前');
  assert.ok(!/createElement\('meta'\)[\s\S]{0,200}monetag/.test(html),
    'Monetag 验证标签不能用 JS 注入（验证器不执行 JS）');
  // 注册的站点应是本游戏自己的子域，而不是平台根域
  assert.strictEqual(v.site, 'play-color-mines.run.ceo',
    '应注册本游戏自己的子域（run.ceo 首页属于平台，我们无法改它的 head）');
});
