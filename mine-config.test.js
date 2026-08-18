'use strict';
/* config↔页面消费一致性（issue #1 · 首页统一）：
   ① mine.html 内嵌 GameConfig 必须与 games/mine/game.config.json 逐字段一致；
   ② screens.home 声明必须能被 ShellCore+HomeCore 真实渲染（拒绝「config 是文档」回潮）；
   ③ reward 参数过 RewardCore fail-fast 校验，且页面确实经 CFG 消费。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
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
  for (const id of ['btnStart', 'startLv', 'enVal', 'enBar', 'enSub', 'homeLv', 'homeClears', 'homeTools', 'btnProfile', 'sfxToggle', 'langSel', 'langLabel']) {
    assert.ok(joined.includes('id="' + id + '"'), '缺回填锚点 ' + id);
  }
});

test('i18n 配置覆盖顾客可见核心文案，且 en/zh 均有完整值', () => {
  const I18n = LocaleCore.createI18n(cfg.i18n);
  assert.deepStrictEqual(I18n.locales().sort(), ['en', 'zh']);
  const required = [
    'langName', 'title', 'logoMain', 'logoSub', 'start', 'startCost',
    'homeProgress', 'homeClears', 'homeTools', 'profileLabel', 'player',
    'profileSource', 'sfxLabel', 'sfxOn', 'sfxOff', 'langLabel',
    'homeHint1', 'homeHint2', 'back', 'hudLevel', 'hudMines', 'hudTime',
    'boardAria', 'toolMine', 'toolSafe', 'gameHint', 'energyFull',
    'energyRefill', 'notMine', 'safeHint'
  ];
  for (const locale of ['en', 'zh']) {
    for (const key of required) {
      assert.strictEqual(typeof cfg.i18n.locales[locale][key], 'string', locale + ' 缺 i18n key ' + key);
      assert.ok(cfg.i18n.locales[locale][key].length > 0, locale + ' i18n key 为空 ' + key);
    }
  }
});

test('mine.html 消费 LocaleCore 并接通语言选择、即时切换和本地持久化', () => {
  assert.ok(html.includes('<script src="./core/locale.js"></script>'), '页面未加载 core/locale.js');
  assert.ok(html.includes('LocaleCore.createI18n(CFG.i18n)'), '页面未消费 GameConfig i18n');
  assert.ok(html.includes("var LANG_KEY = 'mine_lang'"), '页面未声明独立语言持久化键');
  assert.ok(html.includes("$('langSel').addEventListener('change'"), '语言选择器未绑定 change');
  assert.ok(html.includes('function populateLangSel()'), '页面未从配置生成语言选项');
  assert.ok(html.includes('function applyLang(lang)'), '页面未实现即时整页语言切换');
  assert.ok(html.includes('document.documentElement.lang'), '切换语言未同步 html lang');
});

test('初始语言解析：无效 URL 参数继续回退到已保存语言和浏览器语言', () => {
  const normalize = html.match(/  function normalizeLang\(lang\) \{[\s\S]*?\n  \}/);
  const resolve = html.match(/  function resolveInitialLang\(\) \{[\s\S]*?\n  \}/);
  assert.ok(normalize && resolve, '页面缺初始语言解析函数');
  function run(search, saved, browserLang) {
    return vm.runInNewContext(normalize[0] + '\n' + resolve[0] + '\nresolveInitialLang();', {
      I18n: { locales: () => ['en', 'zh'] },
      CFG: { i18n: { default: 'en' } },
      LANG_KEY: 'mine_lang',
      location: { search },
      localStorage: { getItem: () => saved },
      navigator: { language: browserLang }
    });
  }
  assert.strictEqual(run('?lang=en', 'zh', 'zh-CN'), 'en', '有效 URL 参数应优先');
  assert.strictEqual(run('?lang=fr', 'zh', 'en-US'), 'zh', '无效 URL 参数不应覆盖已保存语言');
  assert.strictEqual(run('?lang=fr', 'fr', 'zh-CN'), 'zh', 'URL 与存档均无效时应继续使用浏览器语言');
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
  assert.ok(html.includes('Plat.core.accountPresentation(Plat.user)'), '登录账号行未消费 SDK user.name 展示昵称');
  assert.ok(html.includes("$('accountAvatar').textContent = view.avatar"), '登录账号行未按昵称首字更新头像');
  assert.match(html, /\.profilerow \.profilename\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/, '长昵称未配置单行省略');
  const joined = require('./core/shell.js').create(require('./core/home.js').registry(), cfg.screens).render('home', {}).join('');
  assert.ok(joined.includes('id="btnAccount"'), '首页缺 account-row 回填锚点');
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
