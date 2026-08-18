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

test('accountPresentation: 超长 nickname 不截断，emoji ZWJ 保持完整首字素', () => {
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
});

test('accountPresentation: 清除危险格式字符，纯不可见 nickname 回退', () => {
  const P = Platform.create(CFG);
  assert.deepStrictEqual(P.accountPresentation({ name: 'Ali\u202Ece\u200B' }), {
    avatar: 'A',
    name: 'Alice'
  });
  assert.deepStrictEqual(
    P.accountPresentation({ name: '\u200B\u200C\u200D\u2060\uFEFF\u202E' }),
    { avatar: '☁', name: '' }
  );
});

test('accountPresentation: 无 Intl.Segmenter 时仍保留 emoji ZWJ 首字素', () => {
  const P = Platform.create(CFG);
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
  try {
    assert.deepStrictEqual(P.accountPresentation({ name: '👨‍👩‍👧‍👦家庭' }), {
      avatar: '👨‍👩‍👧‍👦',
      name: '👨‍👩‍👧‍👦家庭'
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
