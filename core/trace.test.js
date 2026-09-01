'use strict';
/* 门禁：客户端埋点缓冲（core/trace.js）。
   它是「手机上出了问题能不能查」的唯一通道，所以这几条都是硬约束：
     ① 事件跨刷新还在（localStorage 持久化）
     ② 超出上限丢最旧、且丢了多少要能看见（dropped 计数，不许静默截断）
     ③ 存储不可用（隐私模式/配额满）时不许把游戏带崩，降级成内存缓冲并计数
     ④ 文本输出带「距上一条多少毫秒」——「弹窗刚出现就被关掉」这类问题就是靠间隔看出来的 */
const test = require('node:test');
const assert = require('node:assert');
const TraceCore = require('./trace.js');

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

test('事件持久化：新实例（等价于刷新页面）读得回上一次的记录', () => {
  const store = memStore();
  const a = TraceCore.create({ key: 'k', store, cap: 10 });
  a.log('win_detected', { lv: 7 });
  a.log('dialog_open', { kind: 'win' });
  const b = TraceCore.create({ key: 'k', store, cap: 10 });
  assert.deepStrictEqual(b.list().map((r) => r.e), ['win_detected', 'dialog_open']);
  assert.strictEqual(b.list()[0].d, 'lv=7');
});

test('超出上限丢最旧，并且丢了多少必须看得见', () => {
  const store = memStore();
  const t = TraceCore.create({ key: 'k', store, cap: 3 });
  for (let i = 0; i < 6; i++) t.log('e' + i);
  assert.deepStrictEqual(t.list().map((r) => r.e), ['e3', 'e4', 'e5']);
  assert.strictEqual(t.stats().dropped, 3, '静默截断 = 排查时误以为「事件根本没发生」');
  assert.ok(/dropped=3/.test(t.text()), '文本里也要写明丢了多少');
});

test('存储不可用（隐私模式/配额满）不许把游戏带崩，降级要计数', () => {
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  const t = TraceCore.create({ key: 'k', store: boom, cap: 5 });
  t.log('win_detected');
  t.log('dialog_open');
  assert.strictEqual(t.list().length, 2, '存不下也要留在内存里，本次会话仍可查');
  assert.ok(t.stats().writeFails >= 2, '降级次数要可观测');
  assert.ok(/writeFails=/.test(t.text()));
});

test('文本输出带事件间隔：「弹窗刚出现就被关掉」一眼可见', () => {
  const store = memStore();
  let now = 1000;
  const t = TraceCore.create({ key: 'k', store, cap: 10, clock: () => now });
  t.log('dialog_open', { kind: 'win' });
  now += 60;
  t.log('dialog_dismiss', { kind: 'win', via: 'mask' });
  const lines = t.text().split('\n');
  assert.ok(/dialog_open kind=win/.test(lines[1]));
  assert.ok(/\+60ms dialog_dismiss kind=win via=mask/.test(lines[2]),
    '第二条要显示距上一条 60ms —— 这就是「手指余波把胜利窗点没了」的指纹');
});

test('长值截断留标记，不假装完整；undefined 字段不进文本', () => {
  const t = TraceCore.create({ key: 'k', store: memStore(), cap: 5, valueCap: 8 });
  const row = t.log('e', { long: 'abcdefghijklmn', skip: undefined, ok: true, num: 1.25 });
  assert.strictEqual(row.d, 'long=abcdefgh… ok=1 num=1.3');
});

test('last() 取最近一条指定事件（页面里算 dismiss 距 open 多久要用）', () => {
  const t = TraceCore.create({ key: 'k', store: memStore(), cap: 10 });
  t.log('dialog_open', { kind: 'dead' });
  t.log('dialog_open', { kind: 'win' });
  t.log('toast');
  assert.strictEqual(t.last('dialog_open').d, 'kind=win');
  assert.strictEqual(t.last('nope'), null);
});

test('clear() 连持久化一起清掉', () => {
  const store = memStore();
  const t = TraceCore.create({ key: 'k', store, cap: 5 });
  t.log('e1');
  t.clear();
  assert.deepStrictEqual(t.list(), []);
  assert.strictEqual(store.getItem('k'), null);
  assert.strictEqual(TraceCore.create({ key: 'k', store, cap: 5 }).list().length, 0);
});
