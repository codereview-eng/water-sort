/* 桥接层 core 单元测试：宿主探测/双实现合同 + 存档版本迁移 + fail-fast
   （issue #1 · S16/S17 的机制面；场景级断言见 fixtures/S16–S17） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('./bridge.js');

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), _m: m };
};
const mockTg = () => ({ initDataUnsafe: { user: { id: 42 } }, CloudStorage: memStorage() });

test('宿主探测一次：有 Telegram.WebApp 即 telegram，否则 web', () => {
  assert.equal(B.detectHost({ Telegram: { WebApp: {} } }), 'telegram');
  assert.equal(B.detectHost({}), 'web');
  assert.equal(B.detectHost(null), 'web');
});

test('两实现满足同一 Host 合同；web 前缀纯配置', () => {
  const tg = B.createTelegramHost(mockTg());
  const st = memStorage();
  const web = B.createWebHost(st, { storagePrefix: 'g1:' });
  for (const h of [tg, web]) B.assertHost(h);
  assert.equal(tg.userId(), '42');
  assert.equal(web.userId(), 'web-anon');
  web.storageSet('save', 'x');
  assert.equal(st.getItem('g1:save'), 'x', '前缀来自 config');
  assert.equal(web.storageGet('save'), 'x');
});

test('S16 fail-fast：TG 缺关键能力/缺 user id/web 非法配置 拒绝静默降级', () => {
  assert.throws(() => B.createTelegramHost(null), /缺 WebApp/);
  assert.throws(() => B.createTelegramHost({ initDataUnsafe: {} }), /缺关键能力 "CloudStorage"/);
  assert.throws(() => B.createTelegramHost({ CloudStorage: memStorage() }), /缺关键能力 "initDataUnsafe"/);
  assert.throws(() => B.createTelegramHost({ initDataUnsafe: {}, CloudStorage: memStorage() }), /user\.id/);
  assert.throws(() => B.createWebHost({}), /需要 storage/);
  assert.throws(() => B.createWebHost(memStorage(), { prefix: 'x' }), /未知键/);
  assert.throws(() => B.assertHost({ kind: 'web' }), /Host 合同缺/);
});

test('存档：无存档给默认值；save/load 回环带版本戳', () => {
  const host = B.createWebHost(memStorage(), {});
  const st = B.createSaveStore({ version: 1, defaults: { coins: 0 } }, host);
  assert.deepEqual(st.load(), { coins: 0, __v: 1 });
  st.save({ coins: 9 });
  assert.deepEqual(st.load(), { coins: 9, __v: 1 });
});

test('存档：迁移链顺序执行 v1→v3，默认值合并', () => {
  const host = B.createWebHost(memStorage(), {});
  host.storageSet('save', JSON.stringify({ v: 1, data: { a: 1 } }));
  const st = B.createSaveStore({
    version: 3,
    migrations: { 1: (d) => ({ ...d, b: 2 }), 2: (d) => ({ ...d, c: 3 }) },
    defaults: { z: 0 }
  }, host);
  assert.deepEqual(st.load(), { z: 0, a: 1, b: 2, c: 3, __v: 3 });
});

test('S17 fail-fast：迁移链断裂/迁移表越界/版本超前/存档损坏/非法 version', () => {
  const host = B.createWebHost(memStorage(), {});
  assert.throws(() => B.createSaveStore({ version: 3, migrations: { 2: (d) => d } }, host), /迁移链断裂：缺 1→2/);
  assert.throws(() => B.createSaveStore({ version: 2, migrations: { 1: (d) => d, 5: (d) => d } }, host), /超出/);
  assert.throws(() => B.createSaveStore({ version: 0 }, host), /须是 >=1/);
  assert.throws(() => B.createSaveStore({ version: 1, ttl: 3 }, host), /未知键/);
  host.storageSet('save', JSON.stringify({ v: 9, data: {} }));
  assert.throws(() => B.createSaveStore({ version: 1 }, host).load(), /超前/);
  host.storageSet('save', '{broken');
  assert.throws(() => B.createSaveStore({ version: 1 }, host).load(), /损坏/);
  host.storageSet('save', JSON.stringify({ data: {} }));
  assert.throws(() => B.createSaveStore({ version: 1 }, host).load(), /缺版本号/);
});
