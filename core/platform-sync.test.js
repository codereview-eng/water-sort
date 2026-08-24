'use strict';
/* core/platform.js 云同步调度单测：防抖 + 最长等待（maxWait），防止被高频写入饿死。
   回归的现场（2026-08-20）：倒水首页每秒结算体力都会调一次 queueSync，
   纯防抖每次都重新计时 → 云端一次都没写成功 → 道具消耗同步不上去，重新登录就被云端旧值打回默认。 */
const test = require('node:test');
const assert = require('node:assert');
const Platform = require('./platform.js');

const DEBOUNCE = 1500;
const MAXWAIT = 5000;
const delay = (first, now) => Platform.nextSyncDelay(first, now, DEBOUNCE, MAXWAIT);

test('没有排队中的同步：按正常防抖等待', () => {
  assert.strictEqual(delay(0, 10000), DEBOUNCE);
});

test('排队中且离最长等待还远：仍按防抖（合并连续写入，省请求）', () => {
  assert.strictEqual(delay(10000, 10200), DEBOUNCE);
  assert.strictEqual(delay(10000, 13000), DEBOUNCE);
});

test('临近最长等待：只等到截止点，不再被新写入推迟', () => {
  assert.strictEqual(delay(10000, 14000), 1000, '第一次排队 10000 + 5000 截止 → 只剩 1000ms');
  assert.strictEqual(delay(10000, 14800), 200);
});

test('已到/超过最长等待：立即冲刷', () => {
  assert.strictEqual(delay(10000, 15000), 0);
  assert.strictEqual(delay(10000, 20000), 0, '超时再多也不返回负数');
});

test('饥饿回归：每 0.65 秒来一次写入，最长等待内必须冲刷一次', () => {
  const first = 100000;
  let now = first;
  let fired = false;
  for (let i = 0; i < 20; i += 1) {           // 13 秒的高频写入
    const d = delay(first, now);
    if (now + d <= now + 650) { fired = true; break; }   // 下一次写入到来前就会触发
    now += 650;
  }
  assert.ok(fired, '纯防抖会永远推迟；有最长等待就一定会在期限内落一次云端');
  assert.ok(now - first <= MAXWAIT, '冲刷发生在最长等待之内，实测 ' + (now - first) + 'ms');
});
