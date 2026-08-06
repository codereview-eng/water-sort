/* UI 骨架 core 单元测试：注册表 + 声明式 screens + fail-fast
   （issue #1 · S15 的机制面；场景级断言见 fixtures/S15） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Shell = require('./shell.js');

const reg = () => new Map([
  ['banner', (p) => 'banner:' + (p.text || '')],
  ['list', (p, ctx) => 'list:' + (ctx || '') + ':' + (p.n || 0)]
]);

test('默认配置 = 无此系统（无 screens 声明即空 shell）', () => {
  const sh = Shell.create(reg(), null);
  assert.deepEqual(sh.screens(), []);
  assert.throws(() => sh.render('home'), /未声明 screen/);
});

test('开关 = 模块在不在数组里；顺序 = 数组序；props 透传、ctx 注入', () => {
  const sh = Shell.create(reg(), {
    home: { modules: [{ type: 'list', props: { n: 3 } }, { type: 'banner', props: { text: 'hi' } }] },
    result: { modules: [{ type: 'banner' }] }
  });
  assert.deepEqual(sh.render('home', 'u1'), ['list:u1:3', 'banner:hi']);
  assert.deepEqual(sh.render('result'), ['banner:']);
  assert.deepEqual(sh.modules('home'), ['list', 'banner']);
});

test('fail-fast：未注册 type/未知声明键/非法 registry/非法 props 一律加载期抛错', () => {
  assert.throws(() => Shell.create({}, {}), /必须是 Map/);
  assert.throws(() => Shell.create(new Map([['x', 1]]), {}), /必须是函数/);
  assert.throws(() => Shell.create(reg(), { home: { modules: [{ type: 'ghost' }] } }), /未注册模块 type/);
  assert.throws(() => Shell.create(reg(), { home: { modules: [{ type: 'banner', if: 'x' }] } }), /未知键/);
  assert.throws(() => Shell.create(reg(), { home: { modules: [{ props: {} }] } }), /缺 type/);
  assert.throws(() => Shell.create(reg(), { home: { modules: [{ type: 'banner', props: [] }] } }), /props 必须是对象/);
  assert.throws(() => Shell.create(reg(), { home: { modules: {} } }), /必须是数组/);
  assert.throws(() => Shell.create(reg(), { home: { modules: [], theme: 'x' } }), /未知键/);
});
