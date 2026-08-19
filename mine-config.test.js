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
const PlatformCore = require('./core/platform.js');
const MineEngine = require('./mine-engine.js');
const MineLevels = require('./mine-levels.js');

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

function pageScripts() {
  return Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g), match => {
    const attrs = match[1];
    const src = attrs.match(/\bsrc=(["'])(.*?)\1/);
    const type = attrs.match(/\btype=(["'])(.*?)\1/);
    return {
      src: src ? src[2] : '',
      type: type ? type[2] : '',
      source: match[2]
    };
  });
}

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  tokens() { return new Set(String(this.owner.className || '').split(/\s+/).filter(Boolean)); }
  write(tokens) { this.owner.className = Array.from(tokens).join(' '); }
  add(...names) {
    const tokens = this.tokens();
    names.forEach(name => tokens.add(name));
    this.write(tokens);
  }
  remove(...names) {
    const tokens = this.tokens();
    names.forEach(name => tokens.delete(name));
    this.write(tokens);
  }
  toggle(name, force) {
    const tokens = this.tokens();
    const add = force === undefined ? !tokens.has(name) : !!force;
    if (add) tokens.add(name);
    else tokens.delete(name);
    this.write(tokens);
    return add;
  }
  contains(name) { return this.tokens().has(name); }
}

class FakeElement {
  constructor(tagName, id, document) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.id = id || '';
    this.ownerDocument = document;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.childNodes = [];
    this.listeners = new Map();
    this.parentNode = null;
    this.textContent = '';
    this.title = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.selected = false;
    this.onclick = null;
    this.onpointerdown = null;
    this.queries = new Map();
    this._innerHTML = '';
  }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    this.childNodes = [];
    if (this._innerHTML && this.ownerDocument) {
      this.ownerDocument.mountMarkup(this, this._innerHTML);
    }
  }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    this.childNodes.push(child);
    if (child.id) this.ownerDocument.register(child);
    return child;
  }
  contains(node) {
    if (node === this) return true;
    return this.children.some(child => child.contains && child.contains(node));
  }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) {
      if (selector === '.cell' && node.classList && node.classList.contains('cell')) return node;
    }
    return null;
  }
  querySelector(selector) { return this.queries.get(selector) || null; }
  setQuery(selector, value) { this.queries.set(selector, value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatch(type, init) {
    const event = Object.assign({
      type,
      target: this,
      currentTarget: this,
      preventDefault() {}
    }, init || {});
    const property = this['on' + type];
    if (typeof property === 'function') property.call(this, event);
    for (const fn of this.listeners.get(type) || []) fn.call(this, event);
    return event;
  }
}

class FakeDocument {
  constructor() {
    this.byId = new Map();
    this.listeners = new Map();
    this.queries = new Map();
    this.queryLists = new Map();
    this.documentElement = { lang: '' };
    this.title = '';
    this.hidden = false;
    this.pointElement = null;
  }
  register(element) {
    if (element.id) this.byId.set(element.id, element);
    return element;
  }
  mountMarkup(owner, markup) {
    const tagRe = /<([a-z][\w-]*)\b([^>]*)>/gi;
    let match;
    while ((match = tagRe.exec(markup))) {
      const attrs = match[2];
      const id = attrs.match(/\bid=(["'])(.*?)\1/);
      if (!id) continue;
      const element = new FakeElement(match[1], id[2], this);
      const className = attrs.match(/\bclass=(["'])(.*?)\1/);
      if (className) element.className = className[2];
      owner.appendChild(element);
    }

    if (owner.id === 'home') {
      const logo = new FakeElement('div', '', this);
      const logoEm = new FakeElement('em', '', this);
      logo.childNodes.push({ nodeValue: '' });
      logo.appendChild(logoEm);
      logo.setQuery('em', logoEm);
      if (/class=(["'])logo\1/.test(markup)) this.queries.set('#home .logo', logo);

      if (/class=(["'])hintline\1/.test(markup)) {
        this.queries.set('#home .hintline', new FakeElement('div', '', this));
      }
      if (/class=(["'])max mono\1/.test(markup)) {
        this.queries.set('.energy .max', new FakeElement('span', '', this));
      }
      const labels = Array.from(markup.matchAll(/<div class=(["'])st\1>[\s\S]*?<span>([\s\S]*?)<\/span><\/div>/g));
      this.queryLists.set('#home .homestats .st span',
        labels.map(() => new FakeElement('span', '', this)));
    }

    if (owner.id === 'btnStart') {
      const leading = markup.split(/<span\b/i)[0].replace(/<[^>]+>/g, '');
      owner.childNodes.unshift({ nodeValue: leading });
      const smallMatch = markup.match(/<small>([\s\S]*?)<\/small>/i);
      if (smallMatch) {
        const small = new FakeElement('small', '', this);
        small.textContent = smallMatch[1];
        owner.setQuery('small', small);
      }
    }
  }
  createElement(tagName) { return new FakeElement(tagName, '', this); }
  getElementById(id) { return this.byId.get(id) || null; }
  querySelector(selector) { return this.queries.get(selector) || null; }
  querySelectorAll(selector) { return this.queryLists.get(selector) || []; }
  elementFromPoint() { return this.pointElement; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatch(type, init) {
    const event = Object.assign({ type, target: this }, init || {});
    for (const fn of this.listeners.get(type) || []) fn.call(this, event);
    return event;
  }
}

function makePageDocument() {
  const document = new FakeDocument();
  const ids = [
    'gameConfig',
    'home', 'game', 'btnBack', 'hearts', 'hudLv', 'hudLeft', 'hudTime', 'board',
    'toolMine', 'cntMine', 'toolSafe', 'cntSafe', 'toast', 'overlay', 'dlgTitle',
    'dlgBody', 'dlgMain', 'dlgSub'
  ];
  const elements = {};
  for (const id of ids) elements[id] = document.register(new FakeElement('div', id, document));
  elements.gameConfig.textContent = JSON.stringify(cfg);
  elements.home.hidden = false;
  elements.game.hidden = true;

  function textNode(value) { return { nodeValue: value || '' }; }
  function decorated(selector) {
    const root = new FakeElement('div', '', document);
    const em = new FakeElement('em', '', document);
    root.childNodes.push(textNode(''));
    root.appendChild(em);
    root.setQuery('em', em);
    document.queries.set(selector, root);
    return root;
  }
  decorated('#game .title');
  document.queries.set('#game .hintline', new FakeElement('div', '', document));
  document.queryLists.set('#game .hud .box .k',
    [0, 1, 2].map(() => new FakeElement('span', '', document)));
  elements.toolMine.childNodes.push(textNode(''));
  elements.toolSafe.childNodes.push(textNode(''));
  return { document, elements };
}

async function createPageRuntime(options) {
  options = options || {};
  const { document, elements } = makePageDocument();
  const vibrations = [];
  const storage = new Map();
  let now = 1000;
  let nextTimer = 1;
  const timeouts = new Map();
  const intervals = new Map();
  const windowListeners = new Map();
  const sessionListeners = new Map();
  const hasInitialUser = Object.prototype.hasOwnProperty.call(options, 'user');
  const session = {
    mode: 'online',
    user: hasInitialUser ? options.user : { name: options.name || 'Alice' },
    core: null,
    loadCloudCalls: 0,
    syncCalls: [],
    loadCloud() {
      this.loadCloudCalls += 1;
      return Promise.resolve(options.cloudRow || null);
    },
    saveCloud() { return Promise.resolve(); },
    queueSync(getSave) { this.syncCalls.push(getSave()); },
    flush() {},
    on(event, fn) {
      sessionListeners.set(event, fn);
      return function () { sessionListeners.delete(event); };
    },
    loginCalls: 0,
    login() {
      this.loginCalls += 1;
      return new Promise(function () {});
    },
    logout() { this.user = null; },
    emit(event, payload) {
      if (event === 'authexpired') this.user = null;
      const fn = sessionListeners.get(event);
      if (fn) fn(payload);
    }
  };
  class FakeDate extends Date {
    static now() { return now; }
  }
  class FakeAudioContext {
    constructor() { this.currentTime = 0; this.destination = {}; }
    createOscillator() {
      return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}
      };
    }
  }
  const navigator = { language: 'en-US' };
  if (options.vibrate !== null) {
    navigator.vibrate = options.vibrate || function (ms) {
      vibrations.push(ms);
      return true;
    };
  }
  const sandbox = {
    console,
    document,
    navigator,
    location: {
      search: '?lang=en',
      protocol: 'https:',
      hostname: 'play-color-mines.run.ceo',
      origin: 'https://play-color-mines.run.ceo',
      href: 'https://play-color-mines.run.ceo/mine.html?lang=en',
      assign() {}
    },
    history: { replaceState() {} },
    sessionStorage: {
      getItem(key) { return storage.has('session:' + key) ? storage.get('session:' + key) : null; },
      setItem(key, value) { storage.set('session:' + key, String(value)); },
      removeItem(key) { storage.delete('session:' + key); }
    },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    Date: FakeDate,
    AudioContext: FakeAudioContext,
    webkitAudioContext: FakeAudioContext,
    prompt() { return null; },
    setTimeout(fn) {
      const id = nextTimer++;
      timeouts.set(id, fn);
      return id;
    },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn) {
      const id = nextTimer++;
      intervals.set(id, fn);
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const loadedScripts = [];
  let mainScripts = 0;
  for (const script of pageScripts()) {
    if (script.type === 'application/json') continue;
    if (script.src) {
      assert.match(script.src, /^\.\//, 'mine.html 外部脚本必须使用仓内相对路径: ' + script.src);
      const filename = path.resolve(__dirname, script.src);
      assert.ok(filename.startsWith(__dirname + path.sep), 'mine.html 外部脚本越出仓根: ' + script.src);
      vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename: script.src });
      loadedScripts.push(script.src);
      if (!session.core && context.PlatformCore && typeof context.PlatformCore.create === 'function') {
        const browserPlatform = context.PlatformCore;
        session.core = browserPlatform.create(cfg.platform);
        context.PlatformCore = Object.assign({}, browserPlatform, {
          connect() { return Promise.resolve(session); }
        });
      }
      continue;
    }
    if (!script.source.trim()) continue;
    if (script.source.includes('window.__mine = {') && script.source.includes('boardEl.onpointerdown = onTap')) {
      mainScripts += 1;
    }
    vm.runInContext(script.source, context, { filename: 'mine.html:inline' });
  }
  assert.strictEqual(mainScripts, 1, 'mine.html 必须且只能有一个真实主 inline IIFE');
  assert.ok(session.core, 'mine.html 的真实脚本链未加载 PlatformCore');
  for (const [id, element] of document.byId) elements[id] = element;
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();

  function pointer(type, idx, event) {
    const board = elements.board;
    const target = idx == null ? null : board.children[idx];
    document.pointElement = event && Object.prototype.hasOwnProperty.call(event, 'pointTarget')
      ? event.pointTarget
      : target;
    const init = Object.assign({
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: idx == null ? -1 : idx,
      clientY: 0,
      target
    }, event || {});
    delete init.pointTarget;
    if (type === 'pointerdown') return board.dispatch(type, init);
    return document.dispatch(type, init);
  }

  return {
    context,
    document,
    elements,
    loadedScripts,
    vibrations,
    session,
    advance(ms) { now += ms; },
    flushTimeouts() {
      const callbacks = Array.from(timeouts.values());
      timeouts.clear();
      callbacks.forEach(fn => fn());
    },
    start() {
      elements.btnStart.dispatch('click');
      assert.strictEqual(typeof elements.board.onpointerdown, 'function',
        '页面启动后未安装 board pointerdown');
      for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
        assert.ok((document.listeners.get(type) || []).length > 0,
          '页面启动后未安装 document ' + type);
      }
      assert.ok(context.window.__mine && typeof context.window.__mine.solve === 'function',
        '页面启动后未安装 window.__mine');
    },
    pointer,
    state() { return context.window.__mine.state(); },
    account() {
      return {
        avatar: elements.idAvatar.firstChild ? elements.idAvatar.firstChild.nodeValue : elements.idAvatar.textContent,
        name: elements.idName.textContent,
        source: elements.idSource.textContent,
        status: elements.idSub.textContent,
        action: elements.idAction.textContent,
        state: elements.btnIdentity.dataset.state
      };
    }
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
  for (const id of ['btnStart', 'startLv', 'enVal', 'enBar', 'enSub', 'homeLv', 'homeClears', 'homeTools', 'btnIdentity', 'idName', 'idAvatar', 'idSource', 'idSub', 'idAction', 'sfxToggle', 'langSel', 'langLabel']) {
    assert.ok(joined.includes('id="' + id + '"'), '缺回填锚点 ' + id);
  }
  for (const gone of ['btnProfile', 'profileLabel', 'btnAccount', 'accountStatus', 'accountAction']) {
    assert.ok(!joined.includes('id="' + gone + '"'), '首页仍残留旧两栏锚点 ' + gone);
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

test('真实 HTML 按 script 标签顺序加载，首页锚点只能由 ShellCore 渲染结果生成', async () => {
  const page = await createPageRuntime();
  assert.deepStrictEqual(page.loadedScripts, [
    './core/shell.js',
    './core/home.js',
    './core/reward.js',
    './core/locale.js',
    './core/identity.js',
    './core/platform.js',
    './mine-engine.js',
    './mine-levels.js'
  ]);
  for (const id of [
    'btnStart', 'startLv', 'enVal', 'enBar', 'enSub', 'homeLv', 'homeClears',
    'homeTools', 'btnIdentity', 'idName', 'idAvatar', 'idSource', 'idSub',
    'idAction', 'sfxLabel', 'sfxToggle', 'langLabel', 'langSel'
  ]) {
    assert.ok(page.document.getElementById(id), 'ShellCore 首页渲染缺入口锚点 ' + id);
  }
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
  assert.ok(joined.includes('id="btnIdentity"'), '首页缺 identity-row 回填锚点');
  assert.ok(html.includes('<script src="./core/identity.js"></script>'), '页面未引入 core/identity.js');
});

test('登录账号行经真实页面启动消费 PlatformCore nickname，并随语言入口重渲染', async () => {
  const name = '👩‍💻-' + 'A'.repeat(72);
  const page = await createPageRuntime({ name });
  const en = page.account();
  assert.strictEqual(en.avatar, '👩', '账号头像必须来自 IdentityCore 的首码点规则');
  assert.strictEqual(en.name, name, '英文登录态未展示完整昵称');
  assert.strictEqual(en.status, 'Cloud sync on · name and leaderboards match everywhere');
  assert.strictEqual(en.action, '');

  page.elements.langSel.value = 'zh';
  page.elements.langSel.dispatch('change', { target: page.elements.langSel });
  const zh = page.account();
  assert.strictEqual(zh.avatar, '👩', '切换语言不得改变账号头像');
  assert.strictEqual(zh.name, name, '中文登录态未展示完整昵称');
  assert.strictEqual(zh.status, '云同步已开 · 名字与排行榜全设备一致');
  assert.strictEqual(zh.action, '');
  assert.match(html, /\.profilerow \.profilename\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/,
    '长昵称只能由 CSS 单行视觉省略，DOM 文本必须保持完整');
});

test('登录跳转终止旧页面；回跳后的新页面从 SDK nickname 恢复云档与同步', async () => {
  const anonymous = await createPageRuntime({ user: null });
  assert.strictEqual(anonymous.account().status, 'Progress stays in this browser');
  assert.strictEqual(anonymous.account().action, 'Sign in');
  anonymous.elements.btnIdentity.dispatch('click');
  assert.strictEqual(anonymous.session.loginCalls, 1, '匿名页必须发起一次 SDK 顶层登录跳转');
  assert.strictEqual(anonymous.account().status, 'Progress stays in this browser',
    '旧页面不得依赖永不 resolve 的 login Promise 伪造登录态');
  assert.strictEqual(anonymous.session.loadCloudCalls, 0,
    '旧页面终止前不得提前拉取登录用户云档');

  const returned = await createPageRuntime({ user: { name: 'Alice' } });
  assert.strictEqual(returned.account().name, 'Alice',
    '登录回跳后的新页面必须立即展示 SDK nickname');
  assert.strictEqual(returned.account().action, '');
  assert.strictEqual(returned.session.loadCloudCalls, 1,
    '回跳后的新页面必须拉取一次云档');
  assert.strictEqual(returned.session.syncCalls.length, 1,
    '云档合并落本地后必须触发一次回写同步');

  returned.session.emit('authexpired');
  assert.strictEqual(returned.account().status, 'Session expired · new progress kept in this browser',
    '认证失效后账号行必须立即回到退出状态');
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

test('真实事件接线仅在第二次有效 pointerup 后挖正确雷并轻震一次 18ms', async () => {
  const data = MineLevels.get(1);
  const mines = [];
  data.board.mines.forEach((col, row) => mines.push(row * data.size + col));
  const mine = mines[0];
  const safe = Array.from({ length: data.size * data.size }, (_, idx) => idx)
    .find(idx => !mines.includes(idx));

  const correct = await createPageRuntime();
  correct.start();
  correct.pointer('pointerdown', mine);
  correct.pointer('pointerup', mine);
  correct.advance(100);
  correct.pointer('pointerdown', mine);
  assert.deepStrictEqual(Array.from(correct.state().found), [],
    '第二次 pointerdown 尚未完成手势，不得提前挖雷');
  assert.deepStrictEqual(correct.vibrations, [], '第二次 pointerdown 不得提前震动');
  correct.pointer('pointerup', mine);
  assert.deepStrictEqual(Array.from(correct.state().found), [mine], '有效第二次 pointerup 未执行真实 dig');
  assert.deepStrictEqual(correct.vibrations, [18], '正确雷双击必须精确触发一次 18ms 轻震');

  const secondary = await createPageRuntime();
  secondary.start();
  secondary.pointer('pointerdown', mine, { isPrimary: false });
  secondary.pointer('pointerup', mine, { isPrimary: false });
  secondary.advance(100);
  secondary.pointer('pointerdown', mine, { isPrimary: false });
  secondary.pointer('pointerup', mine, { isPrimary: false });
  assert.deepStrictEqual(Array.from(secondary.state().found), [], '非主指针不得挖格');
  assert.deepStrictEqual(secondary.vibrations, [], '非主指针不得震动');

  const rightButton = await createPageRuntime();
  rightButton.start();
  rightButton.pointer('pointerdown', mine, { button: 2 });
  rightButton.pointer('pointerup', mine, { button: 2 });
  rightButton.advance(100);
  rightButton.pointer('pointerdown', mine, { button: 2 });
  rightButton.pointer('pointerup', mine, { button: 2 });
  assert.deepStrictEqual(Array.from(rightButton.state().found), [], '右键不得挖格');
  assert.deepStrictEqual(rightButton.vibrations, [], '右键不得震动');

  for (const invalidRelease of [
    { isPrimary: false, label: '非主指针抬起' },
    { button: 2, label: '右键抬起' }
  ]) {
    const release = await createPageRuntime();
    release.start();
    release.pointer('pointerdown', mine);
    release.pointer('pointerup', mine);
    release.advance(100);
    release.pointer('pointerdown', mine);
    release.pointer('pointerup', mine, invalidRelease);
    assert.deepStrictEqual(Array.from(release.state().found), [],
      invalidRelease.label + '不得提交第二次挖格');
    assert.deepStrictEqual(release.vibrations, [],
      invalidRelease.label + '不得触发震动');
  }

  const otherPointer = await createPageRuntime();
  otherPointer.start();
  otherPointer.pointer('pointerdown', mine, { pointerId: 1 });
  otherPointer.pointer('pointerup', mine, { pointerId: 1 });
  otherPointer.advance(100);
  otherPointer.pointer('pointerdown', mine, { pointerId: 1 });
  otherPointer.pointer('pointerup', mine, { pointerId: 2 });
  assert.deepStrictEqual(Array.from(otherPointer.state().found), [],
    '不同 pointerId 的 pointerup 不得提交挖格');
  assert.deepStrictEqual(otherPointer.vibrations, [],
    '不同 pointerId 的 pointerup 不得触发震动');
  otherPointer.pointer('pointercancel', mine, { pointerId: 1 });
  otherPointer.pointer('pointerdown', mine, { pointerId: 1 });
  otherPointer.pointer('pointerup', mine, { pointerId: 1 });
  assert.deepStrictEqual(Array.from(otherPointer.state().found), [],
    '取消原指针后的一次合法点击不得误完成陈旧双击');
  assert.deepStrictEqual(otherPointer.vibrations, [],
    '取消原指针后的合法单击不得触发震动');

  const wrongCellRelease = await createPageRuntime();
  wrongCellRelease.start();
  wrongCellRelease.pointer('pointerdown', mine);
  wrongCellRelease.pointer('pointerup', mine);
  wrongCellRelease.advance(100);
  wrongCellRelease.pointer('pointerdown', mine);
  wrongCellRelease.pointer('pointerup', safe);
  assert.deepStrictEqual(Array.from(wrongCellRelease.state().found), [],
    '未发生 pointermove 的错格 pointerup 不得提交挖格');
  assert.deepStrictEqual(wrongCellRelease.vibrations, [],
    '未发生 pointermove 的错格 pointerup 不得触发震动');
  wrongCellRelease.pointer('pointerdown', mine);
  wrongCellRelease.pointer('pointerup', mine);
  assert.deepStrictEqual(Array.from(wrongCellRelease.state().found), [],
    '错格抬起后首次复击原雷格不得误完成陈旧双击');
  assert.strictEqual(wrongCellRelease.state().lives, 3,
    '错格抬起后首次复击原雷格不得误扣生命');
  assert.deepStrictEqual(wrongCellRelease.vibrations, [],
    '错格抬起后首次复击原雷格不得触发震动');
  wrongCellRelease.advance(100);
  wrongCellRelease.pointer('pointerdown', mine);
  wrongCellRelease.pointer('pointerup', mine);
  assert.deepStrictEqual(Array.from(wrongCellRelease.state().found), [mine],
    '清除陈旧 tap chain 后，新的第二次合法点击应正常挖雷');
  assert.deepStrictEqual(wrongCellRelease.vibrations, [18],
    '新的合法双击只应震动一次');
});

test('未完成单击与 tap chain 不得跨重开操作新的棋盘', async () => {
  const data = MineLevels.get(1);
  const mines = [];
  data.board.mines.forEach((col, row) => mines.push(row * data.size + col));
  const mine = mines[0];
  const safe = Array.from({ length: data.size * data.size }, (_, idx) => idx)
    .find(idx => !mines.includes(idx));

  const pendingSingle = await createPageRuntime();
  pendingSingle.start();
  pendingSingle.pointer('pointerdown', safe);
  pendingSingle.pointer('pointerup', safe);
  pendingSingle.context.window.__mine.start();
  pendingSingle.flushTimeouts();
  assert.strictEqual(pendingSingle.elements.board.children[safe].classList.contains('safe'), false,
    '旧棋盘未完成的单击计时器不得在新棋盘补标记');

  const staleChain = await createPageRuntime();
  staleChain.start();
  staleChain.pointer('pointerdown', mine);
  staleChain.pointer('pointerup', mine);
  staleChain.context.window.__mine.home();
  staleChain.context.window.__mine.start();
  staleChain.advance(100);
  staleChain.pointer('pointerdown', mine);
  staleChain.pointer('pointerup', mine);
  assert.deepStrictEqual(Array.from(staleChain.state().found), [],
    '重开后的第一次同格点击不得接续旧棋盘 tap chain');
  assert.deepStrictEqual(staleChain.vibrations, [],
    '重开后的第一次同格点击不得震动');
});

test('真实页面 move/cancel、单击、错误格、两类道具与 window.__mine 均不误震', async () => {
  const data = MineLevels.get(1);
  const mines = [];
  data.board.mines.forEach((col, row) => mines.push(row * data.size + col));
  const mine = mines[0];
  const safe = Array.from({ length: data.size * data.size }, (_, idx) => idx)
    .find(idx => !mines.includes(idx));

  const moved = await createPageRuntime();
  moved.start();
  moved.pointer('pointerdown', mine);
  moved.pointer('pointerup', mine);
  moved.advance(100);
  moved.pointer('pointerdown', mine);
  moved.pointer('pointermove', safe);
  moved.pointer('pointerup', safe);
  assert.deepStrictEqual(Array.from(moved.state().found), [], '第二次手势移动后不得挖雷');
  assert.deepStrictEqual(moved.vibrations, [], '第二次手势移动后不得震动');

  const cancelled = await createPageRuntime();
  cancelled.start();
  cancelled.pointer('pointerdown', mine);
  cancelled.pointer('pointerup', mine);
  cancelled.advance(100);
  cancelled.pointer('pointerdown', mine);
  cancelled.pointer('pointercancel', mine);
  assert.deepStrictEqual(Array.from(cancelled.state().found), [], '第二次手势取消后不得挖雷');
  assert.deepStrictEqual(cancelled.vibrations, [], '第二次手势取消后不得震动');

  const single = await createPageRuntime();
  single.start();
  single.pointer('pointerdown', safe);
  single.pointer('pointerup', safe);
  single.flushTimeouts();
  assert.strictEqual(single.elements.board.children[safe].classList.contains('safe'), true,
    '单击计时完成后应从真实页面入口标记安全格');
  assert.deepStrictEqual(single.vibrations, [], '单击标记不得震动');

  const wrong = await createPageRuntime();
  wrong.start();
  wrong.pointer('pointerdown', safe);
  wrong.pointer('pointerup', safe);
  wrong.advance(100);
  wrong.pointer('pointerdown', safe);
  wrong.pointer('pointerup', safe);
  assert.strictEqual(wrong.state().lives, 2, '错误格双击应扣一次生命');
  assert.deepStrictEqual(wrong.vibrations, [], '错误格双击不得震动');

  const direct = await createPageRuntime();
  direct.start();
  assert.strictEqual(direct.context.window.__mine.dig(mine), true, '真实 window.__mine.dig 应返回命中雷结果');
  assert.ok(Array.from(direct.state().found).includes(mine), '真实 window.__mine.dig 未完成找雷');
  assert.deepStrictEqual(direct.vibrations, [], 'window.__mine.dig 程序化入口不得震动');

  const solved = await createPageRuntime();
  solved.start();
  solved.context.window.__mine.solve();
  assert.strictEqual(solved.state().found.length, data.size, '真实 window.__mine.solve 未找完本关雷');
  assert.deepStrictEqual(solved.vibrations, [], 'window.__mine.solve 程序化入口不得震动');

  const tools = await createPageRuntime();
  tools.start();
  assert.ok((tools.elements.toolMine.listeners.get('click') || []).length > 0, 'toolMine 未安装真实点击入口');
  assert.ok((tools.elements.toolSafe.listeners.get('click') || []).length > 0, 'toolSafe 未安装真实点击入口');
  tools.elements.toolMine.dispatch('click');
  tools.elements.toolSafe.dispatch('click');
  assert.deepStrictEqual(tools.vibrations, [], 'toolMine 与 toolSafe 实际入口均不得震动');

  const missingApi = await createPageRuntime({ vibrate: null });
  missingApi.start();
  assert.doesNotThrow(() => {
    missingApi.pointer('pointerdown', mine);
    missingApi.pointer('pointerup', mine);
    missingApi.advance(100);
    missingApi.pointer('pointerdown', mine);
    missingApi.pointer('pointerup', mine);
  }, '无 Vibration API 时正确雷双击不应报错');

  const rejectedApi = await createPageRuntime({ vibrate() { throw new Error('blocked'); } });
  rejectedApi.start();
  assert.doesNotThrow(() => {
    rejectedApi.pointer('pointerdown', mine);
    rejectedApi.pointer('pointerup', mine);
    rejectedApi.advance(100);
    rejectedApi.pointer('pointerdown', mine);
    rejectedApi.pointer('pointerup', mine);
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

/* 幽灵安全标记回归（真行为，非源码正则）：
   单击会挂一个 DBL_MS 延迟计时器去标记格子；若第二次手势被取消（pointercancel / 非主指针 /
   右键）或在别的格子抬手，那个计时器必须一并清掉。旧代码只重置双击链、留着计时器，
   于是用户明明取消了操作，320ms 后格子仍被标成「安全 ✕」——扫雷里会诱导玩家挖到雷上。
   本测试用假计时器把时间真正推过 DBL_MS，断言 toggleMark 未被调用（旧代码必红）。
   真页面复验脚本：test/manual/mine-ghost-mark.mjs（CDP 合成真实 PointerEvent）。 */
function ghostMarkSandbox() {
  const timers = new Map();
  let seq = 0;
  const sandbox = {
    DBL_MS: 320,
    clickTimer: null,
    lastTap: { idx: -1, t: 0 },
    drag: null,
    S: { done: false },
    marked: [],
    dug: [],
    setTimeout(fn, ms) { seq += 1; timers.set(seq, { fn, at: ms }); return seq; },
    clearTimeout(id) { timers.delete(id); },
    toggleMark(idx) { sandbox.marked.push(idx); },
    dig(idx) { sandbox.dug.push(idx); return false; },
    vibrateCorrectMine() {},
    applyMark() {},
    cellIdxFromPoint(ev) { return ev.idx; },
    Date,
    advance() { Array.from(timers.values()).forEach((t) => t.fn()); timers.clear(); }
  };
  const src = ['resetTapChain', 'resetGestureState', 'samePointer', 'commitTap', 'onDragEnd']
    .map(htmlFunction).join('\n');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

test('第二次手势在别的格子抬手：不得留下幽灵安全标记', () => {
  const sb = ghostMarkSandbox();
  // 第一次单击格子 3 —— 挂上 320ms 的延迟标记
  sb.drag = { pointerId: 1, startIdx: 3, moved: false };
  vm.runInContext('onDragEnd({ pointerId: 1, type: "pointerup", isPrimary: true, button: 0, idx: 3 })', sb);
  assert.deepStrictEqual(sb.marked, [], '延迟未到就标记，双击将无法成立');
  // 第二次按下格子 3，却在格子 4 抬手 = 放弃这次点击
  sb.drag = { pointerId: 1, startIdx: 3, moved: false };
  vm.runInContext('onDragEnd({ pointerId: 1, type: "pointerup", isPrimary: true, button: 0, idx: 4 })', sb);
  sb.advance(); // 时间推过 DBL_MS
  assert.deepStrictEqual(sb.marked, [], '取消的手势仍然标记了格子（幽灵安全标记）');
});

test('第二次手势被系统取消（pointercancel）：不得留下幽灵安全标记', () => {
  const sb = ghostMarkSandbox();
  sb.drag = { pointerId: 1, startIdx: 5, moved: false };
  vm.runInContext('onDragEnd({ pointerId: 1, type: "pointerup", isPrimary: true, button: 0, idx: 5 })', sb);
  sb.drag = { pointerId: 1, startIdx: 5, moved: false };
  vm.runInContext('onDragEnd({ pointerId: 1, type: "pointercancel", isPrimary: true, button: 0, idx: 5 })', sb);
  sb.advance();
  assert.deepStrictEqual(sb.marked, [], 'pointercancel 后仍然标记了格子（幽灵安全标记）');
});

test('正常单击仍然照常标记（防止修复矫枉过正）', () => {
  const sb = ghostMarkSandbox();
  sb.drag = { pointerId: 1, startIdx: 7, moved: false };
  vm.runInContext('onDragEnd({ pointerId: 1, type: "pointerup", isPrimary: true, button: 0, idx: 7 })', sb);
  sb.advance();
  assert.deepStrictEqual(sb.marked, [7], '正常单击应在延迟后标记该格');
});

test('通关保持游戏页并弹出下一关或返回主页二选一', () => {
  const onWin = htmlFunction('onWin');
  let args = null;
  let nextLevel = null;
  let wentHome = false;
  let gestureResets = 0;
  const sandbox = {
    S: { done: false, lv: 7, size: 9 },
    save: { level: 7, clears: 2 },
    resetGestureState() { gestureResets += 1; },
    stopTimer() {},
    persist() {},
    dialog(...values) { args = values; },
    startLevel(level) { nextLevel = level; },
    showHome() { wentHome = true; },
    t(key) { return I18n.t('zh', key); }
  };
  vm.runInNewContext(onWin + '\nonWin();', sandbox);
  assert.strictEqual(gestureResets, 1, '通关时必须清除未完成手势状态');
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
