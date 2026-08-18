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
const I18n = LocaleCore.createI18n(cfg.i18n);

function embedded() {
  const m = html.match(/<script id="gameConfig" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'mine.html 缺内嵌 gameConfig JSON 块');
  return JSON.parse(m[1]);
}

function htmlFunction(name) {
  const m = html.match(new RegExp('  function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}'));
  assert.ok(m, 'mine.html 缺函数 ' + name);
  return m[0].trim();
}

function htmlArray(name) {
  const m = html.match(new RegExp('var ' + name + ' = (\\[[\\s\\S]*?\\]);'));
  assert.ok(m, 'mine.html 缺数组 ' + name);
  return vm.runInNewContext(m[1]);
}

function htmlClickHandler(id) {
  const marker = "$('" + id + "').addEventListener('click', function () {";
  const start = html.indexOf(marker);
  assert.ok(start >= 0, 'mine.html 缺点击处理 ' + id);
  const bodyStart = start + marker.length;
  const end = html.indexOf('\n  });', bodyStart);
  assert.ok(end >= 0, 'mine.html 点击处理未闭合 ' + id);
  return 'function clickHandler() {' + html.slice(bodyStart, end) + '\n}';
}

function htmlDebugSolve() {
  const m = html.match(/solve: function \(\) \{([\s\S]*?)\},\n\s*home:/);
  assert.ok(m, 'mine.html 缺调试 solve 实现');
  return 'function debugSolve() {' + m[1] + '\n}';
}

function renderAccountInBothLocales(name) {
  const elements = {};
  for (const id of ['btnAccount', 'accountAvatar', 'accountStatus', 'accountAction']) {
    elements[id] = {
      textContent: '',
      title: '',
      attributes: {},
      setAttribute(key, value) { this.attributes[key] = String(value); }
    };
  }
  const sandbox = {
    I18n,
    LANG: 'en',
    Plat: {
      mode: 'online',
      user: { name },
      core: {
        accountPresentation(user) {
          assert.strictEqual(user.name, name, 'renderAccount 未把当前 SDK user 交给 PlatformCore');
          return { avatar: '👩‍💻', name };
        }
      }
    },
    $(id) { return elements[id]; }
  };
  const source = [
    htmlFunction('t'),
    htmlFunction('renderAccount'),
    'renderAccount();',
    'var enSnapshot = {',
    "  avatar: $('accountAvatar').textContent,",
    "  status: $('accountStatus').textContent,",
    "  title: $('accountStatus').title,",
    "  action: $('accountAction').textContent,",
    "  aria: $('btnAccount').attributes['aria-label']",
    '};',
    "LANG = 'zh';",
    'renderAccount();',
    'JSON.stringify({ en: enSnapshot, zh: {',
    "  avatar: $('accountAvatar').textContent,",
    "  status: $('accountStatus').textContent,",
    "  title: $('accountStatus').title,",
    "  action: $('accountAction').textContent,",
    "  aria: $('btnAccount').attributes['aria-label']",
    '} });'
  ].join('\n');
  return JSON.parse(vm.runInNewContext(source, sandbox));
}

function createPointerHarness(options) {
  options = options || {};
  let now = 1000;
  let nextTimer = 1;
  const timers = new Map();
  const vibrations = [];
  const cells = new Map();
  const sandbox = {
    S: {
      done: false,
      size: 5,
      mines: new Set(options.mines || [3]),
      found: new Set(),
      marks: new Set(),
      opened: new Set(),
      lives: 3
    },
    lastTap: { idx: -1, t: 0 },
    DBL_MS: 320,
    drag: null,
    clickTimer: null,
    Date: { now() { return now; } },
    setTimeout(fn) {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    cellEl(idx) {
      if (!cells.has(idx)) {
        const classes = new Set();
        cells.set(idx, {
          classList: {
            add(...names) { names.forEach(name => classes.add(name)); },
            remove(...names) { names.forEach(name => classes.delete(name)); }
          }
        });
      }
      return cells.get(idx);
    },
    blip() {},
    renderHud() {},
    onWin() {},
    onDead() {},
    toast() {},
    t(key) { return I18n.t('zh', key); }
  };
  if (Object.prototype.hasOwnProperty.call(options, 'navigator')) {
    if (options.navigator !== undefined) sandbox.navigator = options.navigator;
  } else {
    sandbox.navigator = {
      vibrate(ms) {
        vibrations.push(ms);
        return true;
      }
    };
  }
  vm.runInNewContext([
    htmlFunction('vibrateCorrectMine'),
    htmlFunction('toggleMark'),
    htmlFunction('dig'),
    htmlFunction('onTap'),
    htmlDebugSolve()
  ].join('\n'), sandbox);

  function cellTarget(idx) {
    const cell = { dataset: { idx: String(idx) } };
    cell.closest = selector => selector === '.cell' ? cell : null;
    return cell;
  }

  return {
    sandbox,
    vibrations,
    advance(ms) { now += ms; },
    pendingTimers() { return timers.size; },
    flushTimers() {
      const callbacks = Array.from(timers.values());
      timers.clear();
      callbacks.forEach(fn => fn());
    },
    tap(idx, event) {
      sandbox.onTap(Object.assign({
        isPrimary: true,
        pointerType: 'mouse',
        button: 0,
        target: cellTarget(idx)
      }, event));
    },
    dig(idx) { return sandbox.dig(idx); },
    solve() { return sandbox.debugSolve(); }
  };
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
    'energyRefill', 'notMine', 'safeHint', 'accountLabel', 'loggedIn',
    'loggedInNamed', 'loggedOut', 'login', 'logout'
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
  const joined = require('./core/shell.js').create(require('./core/home.js').registry(), cfg.screens).render('home', {}).join('');
  assert.ok(joined.includes('id="btnAccount"'), '首页缺 account-row 回填锚点');
});

test('登录账号行真实消费完整 SDK nickname，并随当前语言重渲染状态', () => {
  const name = '👩‍💻-' + 'A'.repeat(72);
  const view = renderAccountInBothLocales(name);
  assert.strictEqual(view.en.avatar, '👩‍💻', '账号头像必须使用 PlatformCore 给出的完整字素');
  assert.strictEqual(view.zh.avatar, '👩‍💻', '切换语言不得改变账号头像');
  assert.strictEqual(view.en.status, name + ' · cloud sync on', '英文登录态未用 loggedInNamed 插入完整昵称');
  assert.strictEqual(view.zh.status, name + ' · 进度云同步', '中文登录态未用 loggedInNamed 插入完整昵称');
  assert.strictEqual(view.en.title, name, '英文账号 title 不得截断昵称');
  assert.strictEqual(view.zh.title, name, '中文账号 title 不得截断昵称');
  assert.strictEqual(view.en.action, 'Sign out');
  assert.strictEqual(view.zh.action, '退出');
  assert.ok(view.en.aria.includes(view.en.status) && view.en.aria.includes(view.en.action),
    '英文账号 aria-label 未包含可见状态与操作');
  assert.ok(view.zh.aria.includes(view.zh.status) && view.zh.aria.includes(view.zh.action),
    '中文账号 aria-label 未包含可见状态与操作');
  assert.match(html, /\.profilerow \.profilename\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/,
    '长昵称只能由 CSS 单行视觉省略，DOM 文本必须保持完整');
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

test('叉号与雷按格子宽度响应式缩放，小格同步缩小且不再固定为 12/15px', () => {
  assert.match(html, /\.cell\{[^}]*container-type:inline-size;/s, 'cell 未建立自身尺寸容器');
  assert.match(html, /\.cell \.mk::before\{[^}]*font-size:32px;[^}]*line-height:1;/s, '普通格缺响应式不支持时的符号保底尺寸');
  assert.match(html, /\.cell\.small \.mk::before\{[^}]*font-size:20px;/s, '小格缺响应式不支持时的符号保底尺寸');
  assert.match(html, /@supports \(font-size:1cqi\)\{[\s\S]*?\.cell \.mk::before\{font-size:clamp\(18px,58cqi,48px\);\}[\s\S]*?\.cell\.small \.mk::before\{font-size:clamp\(12px,58cqi,30px\);\}/,
    '容器单位必须写在符号子元素上，才能相对自身格子缩放');
  assert.doesNotMatch(html, /@supports \(font-size:1cqi\)\{[\s\S]*?\.cell\{font-size:[^}]*cqi[^}]*\}/,
    '容器自身不能用自身 cqi 计算字号，否则会退回视口单位');
  assert.doesNotMatch(html, /\.cell\.mine \.mk::before\{[^}]*font-size:\.95em;/s, '雷仍被额外缩小');
  assert.match(html, /@media \(min-width:700px\)\{[\s\S]*?\.hintline\{font-size:13px; color:#b9c5d3; line-height:1\.65;\}[\s\S]*?\.hud \.k,\.topbar \.backbtn\{color:#aeb9c8;\}/,
    '桌面说明和次级标签缺少可读性增强');
});

test('仅主指针左键同格双击正确雷时挖开并轻震一次 18ms', () => {
  const correct = createPointerHarness({ mines: [3] });
  correct.tap(3);
  assert.strictEqual(correct.pendingTimers(), 1, '首次主指针点击应等待双击窗口');
  assert.deepStrictEqual(correct.vibrations, [], '首次点击不得震动');
  correct.advance(100);
  correct.tap(3);
  assert.strictEqual(correct.sandbox.S.found.has(3), true, '同格双击未执行真实 dig');
  assert.strictEqual(correct.pendingTimers(), 0, '完成双击后必须取消单击标记计时器');
  assert.deepStrictEqual(correct.vibrations, [18], '正确雷双击必须精确触发一次 18ms 轻震');

  const secondary = createPointerHarness({ mines: [3] });
  secondary.tap(3, { isPrimary: false });
  secondary.advance(100);
  secondary.tap(3, { isPrimary: false });
  assert.strictEqual(secondary.sandbox.S.found.size, 0, '非主指针不得挖格');
  assert.strictEqual(secondary.pendingTimers(), 0, '非主指针不得启动单击计时器');
  assert.deepStrictEqual(secondary.vibrations, [], '非主指针不得震动');

  const rightButton = createPointerHarness({ mines: [3] });
  rightButton.tap(3, { button: 2 });
  rightButton.advance(100);
  rightButton.tap(3, { button: 2 });
  assert.strictEqual(rightButton.sandbox.S.found.size, 0, '右键不得挖格');
  assert.strictEqual(rightButton.pendingTimers(), 0, '右键不得启动单击计时器');
  assert.deepStrictEqual(rightButton.vibrations, [], '右键不得震动');
});

test('单击、错误格、道具和调试入口均不震，Vibration API 缺失或失败安全降级', () => {
  const single = createPointerHarness({ mines: [3] });
  single.tap(4);
  assert.deepStrictEqual(single.vibrations, [], '单击等待阶段不得震动');
  single.flushTimers();
  assert.strictEqual(single.sandbox.S.marks.has(4), true, '单击计时完成后应执行真实 toggleMark');
  assert.deepStrictEqual(single.vibrations, [], '单击标记安全格不得震动');

  const wrong = createPointerHarness({ mines: [3] });
  wrong.tap(4);
  wrong.advance(100);
  wrong.tap(4);
  assert.strictEqual(wrong.sandbox.S.opened.has(4), true, '错误格双击未执行真实 dig');
  assert.strictEqual(wrong.sandbox.S.lives, 2, '错误格双击应扣一次生命');
  assert.deepStrictEqual(wrong.vibrations, [], '错误格双击不得震动');

  const direct = createPointerHarness({ mines: [3] });
  assert.strictEqual(direct.dig(3), true, '程序化 dig 应返回命中雷结果');
  assert.strictEqual(direct.sandbox.S.found.has(3), true, '程序化 dig 未完成找雷');
  assert.deepStrictEqual(direct.vibrations, [], 'window.__mine.dig 程序化入口不得震动');

  const solved = createPointerHarness({ mines: [1, 3] });
  solved.solve();
  assert.deepStrictEqual(Array.from(solved.sandbox.S.found).sort(), [1, 3],
    'window.__mine.solve 未通过页面真实 dig 找完雷');
  assert.deepStrictEqual(solved.vibrations, [], 'window.__mine.solve 程序化入口不得震动');

  const toolCalls = [];
  const toolHandler = htmlClickHandler('toolMine');
  vm.runInNewContext(toolHandler + '\nclickHandler();', {
    navigator: { vibrate(ms) { toolCalls.push(ms); return true; } },
    S: { done: false, size: 5, board: {}, found: new Set(), marks: new Set() },
    save: { toolMine: 1 },
    MineEngine: { pickUnfoundMine() { return 2; } },
    persist() {},
    cellEl() { return { classList: { add() {}, remove() {} } }; },
    renderHud() {}, onWin() {}, toast() {}, offerAdTool() {}
  });
  assert.deepStrictEqual(toolCalls, [], '找雷道具路径不得触发震动');

  const missingApi = createPointerHarness({ mines: [3], navigator: undefined });
  assert.doesNotThrow(() => {
    missingApi.tap(3);
    missingApi.advance(100);
    missingApi.tap(3);
  }, '无 Vibration API 时正确雷双击不应报错');

  const rejectedApi = createPointerHarness({
    mines: [3],
    navigator: { vibrate() { throw new Error('blocked'); } }
  });
  assert.doesNotThrow(() => {
    rejectedApi.tap(3);
    rejectedApi.advance(100);
    rejectedApi.tap(3);
  }, '浏览器拒绝震动时不应阻断正确雷双击');
});

test('每种颜色配置唯一淡色底纹，覆盖离散纹理族并由渲染完整消费', () => {
  const colors = htmlArray('COLORS');
  const textures = htmlArray('REGION_TEXTURES');
  const expectedColors = [
    '#7f9cf5', '#f56d6d', '#f5c66d', '#6dd3a8', '#c98df0', '#6dc4f0',
    '#f09db8', '#a8d36d', '#f0a56d', '#8f8ff0', '#6df0d8'
  ];
  const expectedTextures = [
    { image: 'repeating-linear-gradient(45deg, rgba(15,22,32,.11) 0 1.4px, transparent 1.4px 8px)', size: 'auto' },
    { image: 'repeating-linear-gradient(-45deg, rgba(15,22,32,.11) 0 1.4px, transparent 1.4px 8px)', size: 'auto' },
    { image: 'repeating-linear-gradient(0deg, rgba(15,22,32,.12) 0 1.2px, transparent 1.2px 7px)', size: 'auto' },
    { image: 'repeating-linear-gradient(90deg, rgba(15,22,32,.12) 0 1.2px, transparent 1.2px 7px)', size: 'auto' },
    { image: 'repeating-linear-gradient(45deg, rgba(15,22,32,.08) 0 1px, transparent 1px 9px), repeating-linear-gradient(-45deg, rgba(15,22,32,.08) 0 1px, transparent 1px 9px)', size: 'auto' },
    { image: 'repeating-linear-gradient(0deg, rgba(15,22,32,.08) 0 1px, transparent 1px 9px), repeating-linear-gradient(90deg, rgba(15,22,32,.08) 0 1px, transparent 1px 9px)', size: 'auto' },
    { image: 'radial-gradient(circle, rgba(15,22,32,.14) 0 1.25px, transparent 1.5px)', size: '7px 7px' },
    { image: 'radial-gradient(circle at 25% 25%, rgba(15,22,32,.12) 0 1.15px, transparent 1.4px), radial-gradient(circle at 75% 75%, rgba(15,22,32,.12) 0 1.15px, transparent 1.4px)', size: '12px 12px' },
    { image: 'repeating-radial-gradient(circle at center, rgba(15,22,32,.10) 0 1px, transparent 1px 5px)', size: 'auto' },
    { image: 'conic-gradient(from 45deg, rgba(15,22,32,.10) 25%, transparent 0 50%, rgba(15,22,32,.10) 0 75%, transparent 0)', size: '8px 8px' },
    { image: 'repeating-linear-gradient(60deg, rgba(15,22,32,.11) 0 1.2px, transparent 1.2px 11px), repeating-linear-gradient(-60deg, rgba(15,22,32,.06) 0 1px, transparent 1px 11px)', size: 'auto' }
  ];
  assert.deepStrictEqual(Array.from(colors), expectedColors, '彩雷 11 色区域色板发生漂移');
  assert.deepStrictEqual(Array.from(textures, texture => ({
    image: texture.image,
    size: texture.size
  })), expectedTextures, '彩雷 11 组区域底纹发生漂移');
  assert.strictEqual(new Set(colors).size, 11, '11 种区域颜色必须互不重复');
  assert.strictEqual(textures.length, colors.length, '每种颜色都必须有对应底纹');
  assert.strictEqual(new Set(textures.map(texture => texture.image + '|' + texture.size)).size,
    textures.length, '不同颜色的底纹必须可区分');
  for (const texture of textures) {
    assert.strictEqual(typeof texture.image, 'string', '底纹缺 image');
    assert.strictEqual(typeof texture.size, 'string', '底纹缺 background-size');
    assert.match(texture.image, /gradient\(/, '底纹必须使用可缩放 CSS gradient');
    const alphas = [...texture.image.matchAll(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/g)].map(m => Number(m[1]));
    assert.ok(alphas.length > 0 && Math.max(...alphas) <= 0.14, '底纹透明度必须克制，不能盖过底色');
  }
  assert.ok(textures.some(texture => /repeating-linear-gradient\(0deg/.test(texture.image)),
    '底纹缺水平线编码');
  assert.ok(textures.some(texture => /repeating-linear-gradient\(90deg/.test(texture.image)),
    '底纹缺垂直线编码');
  assert.ok(textures.some(texture => /(^|,\s*)radial-gradient\(circle/.test(texture.image)),
    '底纹缺点阵编码');
  assert.ok(textures.some(texture => texture.image.includes('repeating-radial-gradient(')),
    '底纹缺环纹编码');
  assert.ok(textures.some(texture => texture.image.includes('conic-gradient(')),
    '底纹缺块状编码');
  assert.ok(textures.some(texture => (texture.image.match(/gradient\(/g) || []).length >= 2),
    '底纹缺交叉线或网格等叠层编码');
  const renderBoard = htmlFunction('renderBoard');
  assert.ok(renderBoard.includes('d.style.backgroundColor = COLORS[region];'), '棋盘未消费颜色配置');
  assert.ok(renderBoard.includes('var texture = REGION_TEXTURES[region];'), '棋盘未读取底纹配置');
  assert.ok(renderBoard.includes('d.style.backgroundImage = texture.image;'), '棋盘未消费底纹图案');
  assert.ok(renderBoard.includes('d.style.backgroundSize = texture.size;'), '棋盘未消费底纹尺寸');
  assert.match(html, /\.cell\.safe \.mk::before\{[^}]*font-weight:900;[^}]*-webkit-text-stroke:\.035em currentColor;/s,
    '手机小格中的叉号缺少加粗描边');
});

test('通关保持游戏页并弹出下一关或返回主页二选一', () => {
  const onWin = htmlFunction('onWin');
  let args = null;
  let nextLevel = null;
  let wentHome = false;
  const sandbox = {
    S: { done: false, lv: 7, size: 9 },
    save: { level: 7, clears: 2 },
    stopTimer() {},
    persist() {},
    dialog(...values) { args = values; },
    startLevel(level) { nextLevel = level; },
    showHome() { wentHome = true; },
    t(key) { return I18n.t('zh', key); }
  };
  vm.runInNewContext(onWin + '\nonWin();', sandbox);
  assert.strictEqual(wentHome, false, '通关弹窗出现前不应自动返回主页');
  assert.strictEqual(sandbox.S.done, true);
  assert.strictEqual(sandbox.save.level, 8);
  assert.strictEqual(sandbox.save.clears, 3);
  assert.ok(args, '通关未弹出选择');
  assert.strictEqual(args[2], '下一关');
  assert.strictEqual(args[4], '返回首页');
  args[3]();
  assert.strictEqual(nextLevel, 8, '主操作未进入下一关');
  args[5]();
  assert.strictEqual(wentHome, true, '次操作未返回主页');
});
