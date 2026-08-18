'use strict';
/* core/platform.js 单测：config fail-fast + 字段映射 + 合并策略 + 登录引导判定（纯函数层） */
const test = require('node:test');
const assert = require('node:assert');
const Platform = require('./platform.js');

const CFG = {
  entity: 'Save',
  loginPromptAfterClears: 3,
  fields: {
    level: { col: 'level', merge: 'max' },
    clears: { col: 'clears', merge: 'max' },
    toolMine: { col: 'tool_mine', merge: 'newest' },
    energy: { col: 'energy', merge: 'newest' },
    alias: { col: 'alias', merge: 'newest' }
  }
};

test('create: config fail-fast（实体/阈值/字段映射形状）', () => {
  assert.throws(() => Platform.create(null), /必须是对象/);
  assert.throws(() => Platform.create({ fields: CFG.fields }), /entity/);
  assert.throws(() => Platform.create({ entity: 'Save', fields: {} }), /fields/);
  assert.throws(() => Platform.create({ entity: 'Save', loginPromptAfterClears: -1, fields: CFG.fields }), /loginPromptAfterClears/);
  assert.throws(() => Platform.create({ entity: 'Save', loginPromptAfterClears: 1.5, fields: CFG.fields }), /loginPromptAfterClears/);
  assert.throws(() => Platform.create({ entity: 'Save', fields: { a: { col: 'updated_ms', merge: 'max' } } }), /保留列名/);
  assert.throws(() => Platform.create({ entity: 'Save', fields: { a: { col: 'x', merge: 'sum' } } }), /merge/);
  assert.throws(() => Platform.create({ entity: 'Save', fields: { a: { col: 'x', merge: 'max' }, b: { col: 'x', merge: 'max' } } }), /重复/);
  const P = Platform.create(CFG);
  assert.strictEqual(P.entity, 'Save');
  assert.strictEqual(P.loginPromptAfterClears, 3);
  assert.strictEqual(Platform.create({ entity: 'S', fields: CFG.fields }).loginPromptAfterClears, 3, '默认阈值 3');
});

test('toRow/fromRow: 键列互映，undefined 不落列，updated_ms 由 nowMs 落', () => {
  const P = Platform.create(CFG);
  const row = P.toRow({ level: 7, clears: 6, toolMine: 2, alias: '玩家A', extraLocal: 1 }, 1755000000000);
  assert.deepStrictEqual(row, { updated_ms: 1755000000000, level: 7, clears: 6, tool_mine: 2, alias: '玩家A' });
  assert.throws(() => P.toRow({}, NaN), /nowMs/);
  const patch = P.fromRow({ level: 8, tool_mine: 3, alias: null, junk: 9 });
  assert.deepStrictEqual(patch, { level: 8, toolMine: 3 }, 'null/未映射列不进补丁');
  assert.deepStrictEqual(P.fromRow(null), {});
});

test('mergeSave: 云端无行 → 本地原样 + dirtyCloud（首次上写）', () => {
  const P = Platform.create(CFG);
  const local = { level: 5, clears: 4, toolMine: 1, updatedMs: 100 };
  const r = P.mergeSave(local, null);
  assert.deepStrictEqual(r.save, local);
  assert.strictEqual(r.dirtyCloud, true);
});

test('mergeSave: max 字段两边取大（进度只进不退），双向 dirty 判定', () => {
  const P = Platform.create(CFG);
  // 云端进度更高：本地升级，云端该字段无需回写
  let r = P.mergeSave({ level: 3, clears: 2, updatedMs: 200 }, { level: 9, clears: 8, updated_ms: 100 });
  assert.strictEqual(r.save.level, 9);
  assert.strictEqual(r.save.clears, 8);
  // 本地进度更高：云端需要回写
  r = P.mergeSave({ level: 12, clears: 11, updatedMs: 200 }, { level: 9, clears: 8, updated_ms: 100 });
  assert.strictEqual(r.save.level, 12);
  assert.strictEqual(r.dirtyCloud, true);
  // 完全一致：云端无需回写
  r = P.mergeSave({ level: 9, clears: 8, updatedMs: 100 }, { level: 9, clears: 8, updated_ms: 100 });
  assert.strictEqual(r.dirtyCloud, false);
});

test('mergeSave: newest 字段按时间戳判新（换设备场景）', () => {
  const P = Platform.create(CFG);
  // 云端更新（另一台设备刚玩过）：道具/体力/昵称用云端
  let r = P.mergeSave({ level: 5, toolMine: 1, energy: 30, alias: '旧名', updatedMs: 100 },
    { level: 5, tool_mine: 4, energy: 90, alias: '新名', updated_ms: 900 });
  assert.strictEqual(r.save.toolMine, 4);
  assert.strictEqual(r.save.energy, 90);
  assert.strictEqual(r.save.alias, '新名');
  // 本地更新：保本地并回写云
  r = P.mergeSave({ level: 5, toolMine: 1, energy: 30, updatedMs: 900 }, { level: 5, tool_mine: 4, energy: 90, updated_ms: 100 });
  assert.strictEqual(r.save.toolMine, 1);
  assert.strictEqual(r.save.energy, 30);
  assert.strictEqual(r.dirtyCloud, true);
});

test('mergeSave: 单边缺值不丢档（云缺列用本地，本地缺键收云端）', () => {
  const P = Platform.create(CFG);
  const r = P.mergeSave({ level: 5, updatedMs: 100 }, { level: 5, tool_mine: 2, updated_ms: 900 });
  assert.strictEqual(r.save.toolMine, 2, '本地缺键收云端');
  const r2 = P.mergeSave({ level: 5, toolMine: 3, updatedMs: 100 }, { level: 5, updated_ms: 900 });
  assert.strictEqual(r2.save.toolMine, 3, '云缺列保本地');
  assert.strictEqual(r2.dirtyCloud, true, '云缺列需回写');
});

test('mergeSave: localFresh（换设备刚初始化就登录）→ 云端优先，默认档不反向覆盖云档', () => {
  const P = Platform.create(CFG);
  // 新设备：本地是刚初始化的默认档（时间戳更新但无游玩痕迹），云端是老档
  const local = { level: 1, clears: 0, toolMine: 2, energy: 120, alias: '玩家1234', updatedMs: 900 };
  const cloud = { level: 9, clears: 8, tool_mine: 5, energy: 30, alias: '老玩家', updated_ms: 100 };
  const r = P.mergeSave(local, cloud, { localFresh: true });
  assert.strictEqual(r.save.level, 9);
  assert.strictEqual(r.save.toolMine, 5, 'newest 字段云端优先');
  assert.strictEqual(r.save.energy, 30);
  assert.strictEqual(r.save.alias, '老玩家');
  // 不带 localFresh 时按时间戳（本地新 → 本地赢），对照确认开关生效
  const r2 = P.mergeSave(local, cloud);
  assert.strictEqual(r2.save.toolMine, 2);
});

test('mergeSave: 空字符串视为缺值（未设置昵称不覆盖云端昵称）', () => {
  const P = Platform.create(CFG);
  const r = P.mergeSave({ level: 5, alias: '', updatedMs: 900 }, { level: 5, alias: '老玩家', updated_ms: 100 });
  assert.strictEqual(r.save.alias, '老玩家');
  const r2 = P.mergeSave({ level: 5, alias: '本地名', updatedMs: 900 }, { level: 5, alias: '', updated_ms: 100 });
  assert.strictEqual(r2.save.alias, '本地名');
});

test('shouldPromptLogin: 满 N 盘且未提示过才提示；0 = 永不', () => {
  const P = Platform.create(CFG);
  assert.strictEqual(P.shouldPromptLogin({ clears: 2, prompted: false }), false);
  assert.strictEqual(P.shouldPromptLogin({ clears: 3, prompted: false }), true);
  assert.strictEqual(P.shouldPromptLogin({ clears: 30, prompted: true }), false);
  const never = Platform.create({ entity: 'S', loginPromptAfterClears: 0, fields: CFG.fields });
  assert.strictEqual(never.shouldPromptLogin({ clears: 99, prompted: false }), false);
  assert.throws(() => P.shouldPromptLogin(null), /state/);
});

test('accountPresentation: 仅返回 SDK nickname/字素头像，非字符串与空值安全回退', () => {
  const P = Platform.create(CFG);
  assert.deepStrictEqual(P.accountPresentation({ name: ' Player-7H9K2M4Q8C ' }), {
    avatar: 'P',
    name: 'Player-7H9K2M4Q8C'
  });
  assert.deepStrictEqual(P.accountPresentation({ name: '   ' }), { avatar: '☁', name: '' });
  assert.deepStrictEqual(P.accountPresentation({ name: 12345 }), { avatar: '☁', name: '' });
  assert.deepStrictEqual(P.accountPresentation(null), { avatar: '☁', name: '' });
});

test('accountPresentation: 超长 nickname 不截断，标准 Segmenter 返回完整首字素', () => {
  const P = Platform.create(CFG);
  const longName = `Player-${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(4)}-完整尾部`;
  assert.deepStrictEqual(P.accountPresentation({ name: longName }), {
    avatar: 'P',
    name: longName
  });
  assert.deepStrictEqual(P.accountPresentation({ name: '👩‍💻研发者' }), {
    avatar: '👩‍💻',
    name: '👩‍💻研发者'
  });
  assert.deepStrictEqual(P.accountPresentation({ name: 'A\u200DB' }), {
    avatar: 'A\u200D',
    name: 'A\u200DB'
  }, '普通字符间 ZWJ 不得把后一字符并入首字素');
  assert.deepStrictEqual(P.accountPresentation({ name: 'क्षेत्र' }), {
    avatar: 'क्षे',
    name: 'क्षेत्र'
  }, 'Indic 连写与元音标记保持完整');
  assert.deepStrictEqual(P.accountPresentation({ name: '🇺🇳代表' }), {
    avatar: '🇺🇳',
    name: '🇺🇳代表'
  });
  assert.deepStrictEqual(P.accountPresentation({ name: '1️⃣号' }), {
    avatar: '1️⃣',
    name: '1️⃣号'
  });
});

test('accountPresentation: 清除危险格式字符，纯不可见 nickname 回退', () => {
  const P = Platform.create(CFG);
  assert.deepStrictEqual(P.accountPresentation({ name: 'Ali\u202Ece\u200B' }), {
    avatar: 'A',
    name: 'Alice'
  });
  assert.deepStrictEqual(P.accountPresentation({ name: 'Alice\u2800' }), {
    avatar: 'A',
    name: 'Alice'
  }, 'Braille Blank 不得形成视觉同名后缀');
  assert.deepStrictEqual(P.accountPresentation({ name: 'Alice\u200D ' }), {
    avatar: 'A',
    name: 'Alice'
  }, '尾随空白不得让 ZWJ 绕过昵称边界清理');
  assert.deepStrictEqual(P.accountPresentation({ name: 'Alice\u200C\t' }), {
    avatar: 'A',
    name: 'Alice'
  }, '尾随空白不得让 ZWNJ 绕过昵称边界清理');
  assert.deepStrictEqual(P.accountPresentation({ name: 'A\u{E0001}lice' }), {
    avatar: 'A',
    name: 'Alice'
  }, 'Default_Ignorable 不得穿透可见昵称');
  assert.deepStrictEqual(
    P.accountPresentation({ name: '\u{E0001}' }),
    { avatar: '☁', name: '' }
  );
  assert.deepStrictEqual(
    P.accountPresentation({ name: '\u200B\u200C\u200D\u2060\uFEFF\u202E' }),
    { avatar: '☁', name: '' }
  );
});

test('accountPresentation: 保留合法 subdivision flag tag 字素，清除孤立 tag 字符', () => {
  const P = Platform.create(CFG);
  const england = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
  const scotland = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';
  const wales = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}';
  for (const flag of [england, scotland, wales]) {
    const name = flag + '队长';
    assert.deepStrictEqual(P.accountPresentation({ name }), {
      avatar: flag,
      name
    });
  }
  assert.deepStrictEqual(
    P.accountPresentation({ name: 'A\u{E0067}\u{E0062}\u{E007F}B' }),
    { avatar: 'A', name: 'AB' },
    '脱离合法旗帜字素的 tag 字符必须过滤'
  );
});

test('accountPresentation: 无 Intl.Segmenter 时头像安全回退，不伪造不完整字素', () => {
  const P = Platform.create(CFG);
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
  try {
    assert.deepStrictEqual(P.accountPresentation({ name: '👨‍👩‍👧‍👦家庭' }), {
      avatar: '☁',
      name: '👨‍👩‍👧‍👦家庭'
    });
    assert.deepStrictEqual(P.accountPresentation({ name: 'A\u200DB' }), {
      avatar: '☁',
      name: 'A\u200DB'
    });
    assert.deepStrictEqual(P.accountPresentation({ name: 'क्षेत्र' }), {
      avatar: '☁',
      name: 'क्षेत्र'
    });
  } finally {
    if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    else delete Intl.Segmenter;
  }
});

test('accountPresentation: 结果不携带 SDK id/token 等敏感字段', () => {
  const P = Platform.create(CFG);
  const sentinel = 'SDK_SECRET_SENTINEL';
  const view = P.accountPresentation({ name: 'Alice', id: sentinel, token: sentinel });
  assert.deepStrictEqual(Object.keys(view).sort(), ['avatar', 'name']);
  assert.strictEqual(JSON.stringify(view).includes(sentinel), false);
});

test('loadSdk: Node 环境（无 window）安全返回 null，永不 reject', async () => {
  const v = await Platform.loadSdk();
  assert.strictEqual(v, null);
});

test('connect: SDK 不可用 → local 降级会话（mode/reason/core 在位）', async () => {
  const s = await Platform.connect(CFG);
  assert.strictEqual(s.mode, 'local');
  assert.strictEqual(s.reason, 'SDK_UNAVAILABLE');
  assert.strictEqual(s.user, null);
  assert.strictEqual(typeof s.core.mergeSave, 'function');
});

test('connect: 登录按顶层跳转终止旧会话，回跳新会话恢复用户/云同步，失效与退出自行清空', async () => {
  const oldWindow = global.window;
  const oldDocument = global.document;
  let loginCalls = 0;
  const createdRows = [];
  const table = {
    list() { return Promise.resolve([]); },
    create(row) {
      createdRows.push(row);
      return Promise.resolve({ id: 'row-1' });
    },
    update() { return Promise.resolve(); }
  };
  const pendingLogin = new Promise(function () {});
  const anonymousPlay = {
    user: null,
    db: { Save: table },
    login() {
      loginCalls += 1;
      return pendingLogin;
    },
    logout() {
      this.user = null;
      return undefined;
    },
    on() {
      return function () {};
    }
  };
  let activePlay = anonymousPlay;
  global.window = {
    Play: { init() { return Promise.resolve(activePlay); } },
    location: { protocol: 'https:' }
  };
  global.document = {};
  try {
    const anonymousSession = await Platform.connect(CFG, { syncDebounceMs: 1 });
    assert.strictEqual(anonymousSession.user, null);
    assert.strictEqual(anonymousSession.login(), pendingLogin,
      'login 必须原样返回 SDK 的永不 resolve 跳转 Promise');
    assert.strictEqual(loginCalls, 1);
    assert.strictEqual(anonymousSession.user, null,
      '旧页面不得等待 login continuation 伪造同运行时登录态');

    const authExpiredHandlers = [];
    activePlay = {
      user: { name: 'Alice' },
      db: { Save: table },
      login() { return pendingLogin; },
      logout() { this.user = null; },
      on(event, fn) {
        if (event === 'authexpired') authExpiredHandlers.push(fn);
        return function () {};
      }
    };
    const session = await Platform.connect(CFG, { syncDebounceMs: 1 });
    assert.deepStrictEqual(session.user, { name: 'Alice' },
      '登录回跳后的新页面必须从 Play.init() 恢复用户');
    session.queueSync(() => ({ level: 2, updatedMs: 100 }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(createdRows.length, 1, '回跳新页面必须允许首次同步真正写云端');
    assert.strictEqual(createdRows[0].level, 2);

    activePlay.user = null;
    authExpiredHandlers[0]();
    assert.strictEqual(session.user, null,
      '即使业务方未注册监听，认证失效也必须清空 session.user');

    activePlay.user = { name: 'Alice' };
    const logoutSession = await Platform.connect(CFG);
    logoutSession.logout();
    assert.strictEqual(session.user, null, '退出后必须清空 session.user');
    assert.strictEqual(logoutSession.user, null, '退出后必须清空当前新会话的 session.user');
  } finally {
    if (oldWindow === undefined) delete global.window;
    else global.window = oldWindow;
    if (oldDocument === undefined) delete global.document;
    else global.document = oldDocument;
  }
});
