/* tgid.test.js — 兜底身份解析测试(issue #20)。node --test */
const { test } = require('node:test');
const assert = require('node:assert');
const { parseTgWebAppData, displayName } = require('./tgid.js');

/* 按 Telegram 真实编码规则自造合规样例:
   hash = #tgWebAppData=<encodeURIComponent(inner)>&tgWebAppVersion=...
   inner = query_id=...&user=<encodeURIComponent(JSON)>&auth_date=...&hash=... */
function makeHash(userJsonStr, opts) {
  const o = opts || {};
  const kv = [];
  kv.push('query_id=AAHdF6IQAAAAAN0XohDhrOrc');
  if (userJsonStr != null) kv.push('user=' + encodeURIComponent(userJsonStr));
  kv.push('auth_date=1700000000');
  kv.push('hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaea2e8e2');
  const inner = kv.join('&');
  return '#tgWebAppData=' + encodeURIComponent(inner) +
    '&tgWebAppVersion=7.10&tgWebAppPlatform=' + (o.platform || 'android');
}

test('tgid: first+last 完整用户', () => {
  const h = makeHash(JSON.stringify({
    id: 279058397, first_name: '张', last_name: '三',
    username: 'zhang3', language_code: 'zh-hans',
  }));
  const u = parseTgWebAppData(h);
  assert.ok(u);
  assert.strictEqual(u.id, '279058397');
  assert.strictEqual(u.first_name, '张');
  assert.strictEqual(u.last_name, '三');
  assert.strictEqual(u.username, 'zhang3');
  assert.strictEqual(displayName(u), '张 三');
});

test('tgid: 仅 first_name', () => {
  const u = parseTgWebAppData(makeHash(JSON.stringify({ id: 1, first_name: 'Mira' })));
  assert.ok(u);
  assert.strictEqual(u.id, '1');
  assert.strictEqual(u.last_name, '');
  assert.strictEqual(displayName(u), 'Mira');
});

test('tgid: 仅 username(无 first/last)', () => {
  const u = parseTgWebAppData(makeHash(JSON.stringify({ id: 42, username: 'leo_x' })));
  assert.ok(u);
  assert.strictEqual(displayName(u), 'leo_x');
});

test('tgid: 无 user 字段 → null', () => {
  assert.strictEqual(parseTgWebAppData(makeHash(null)), null);
});

test('tgid: user 非法 JSON → null', () => {
  assert.strictEqual(parseTgWebAppData(makeHash('{broken json')), null);
});

test('tgid: language_code 提取', () => {
  const u = parseTgWebAppData(makeHash(JSON.stringify({ id: 7, first_name: 'A', language_code: 'zh-CN' })));
  assert.ok(u);
  assert.strictEqual(u.language_code, 'zh-CN');
});

test('tgid: 空/无关 hash/非字符串 → null', () => {
  assert.strictEqual(parseTgWebAppData(''), null);
  assert.strictEqual(parseTgWebAppData(null), null);
  assert.strictEqual(parseTgWebAppData('#lb'), null);
  assert.strictEqual(parseTgWebAppData('#autostart=medium'), null);
  assert.strictEqual(parseTgWebAppData(123), null);
});

test('tgid: tgWebAppData 不在首位也能取到', () => {
  const h = makeHash(JSON.stringify({ id: 9, first_name: 'B' }));
  const moved = '#tgWebAppThemeParams=%7B%7D&' + h.slice(1);
  const u = parseTgWebAppData(moved);
  assert.ok(u);
  assert.strictEqual(u.id, '9');
});

test('tgid: displayName(null) → 空串', () => {
  assert.strictEqual(displayName(null), '');
});
