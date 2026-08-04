// 国家判定决策链测试(issue #27):fetch 全部用注入 stub,不打真网
const { test } = require('node:test');
const assert = require('node:assert');
const Geo = require('./geo.js');

test('normCountry: 合法两位码归一大写,非法为 null', () => {
  assert.strictEqual(Geo.normCountry('cn'), 'CN');
  assert.strictEqual(Geo.normCountry(' US '), 'US');
  assert.strictEqual(Geo.normCountry('XYZ'), null);
  assert.strictEqual(Geo.normCountry(''), null);
  assert.strictEqual(Geo.normCountry(null), null);
});

test('normSaved: 已存合法码/other 视为已确认;UN 合并 other;垃圾为未确认', () => {
  assert.strictEqual(Geo.normSaved('CN'), 'CN');
  assert.strictEqual(Geo.normSaved('jp'), 'JP');
  assert.strictEqual(Geo.normSaved('other'), 'other');
  assert.strictEqual(Geo.normSaved('UN'), 'other');   // issue #27:UN 桶合并为 other
  assert.strictEqual(Geo.normSaved('garbage'), null);
  assert.strictEqual(Geo.normSaved(null), null);
});

test('parseCountryResponse: 两家提供方合法响应', () => {
  assert.strictEqual(Geo.parseCountryResponse('country.is', { ip: '1.2.3.4', country: 'CN' }), 'CN');
  assert.strictEqual(Geo.parseCountryResponse('ipwho.is', { country_code: 'us', success: true }), 'US');
});

test('parseCountryResponse: 非法 JSON/失败标记/未知提供方 → null', () => {
  assert.strictEqual(Geo.parseCountryResponse('country.is', null), null);
  assert.strictEqual(Geo.parseCountryResponse('country.is', { country: 'XYZ' }), null);
  assert.strictEqual(Geo.parseCountryResponse('ipwho.is', { success: false, country_code: 'CN' }), null);
  assert.strictEqual(Geo.parseCountryResponse('nobody', { country: 'CN' }), null);
});

test('resolveCountry: 已存值短路,零请求(含 other/UN)', async () => {
  let called = 0;
  const spy = () => { called += 1; return Promise.resolve('US'); };
  for (const [saved, want] of [['CN', 'CN'], ['other', 'other'], ['UN', 'other']]) {
    const r = await Geo.resolveCountry(saved, [spy]);
    assert.deepStrictEqual(r, { country: want, source: 'saved', requests: 0 });
  }
  assert.strictEqual(called, 0); // 代码路径短路:一个 IP 请求都不发
});

test('resolveCountry: 首家成功即定,不再请求后备', async () => {
  let second = 0;
  const r = await Geo.resolveCountry(null, [
    () => Promise.resolve('JP'),
    () => { second += 1; return Promise.resolve('US'); },
  ]);
  assert.deepStrictEqual(r, { country: 'JP', source: 'ip', requests: 1 });
  assert.strictEqual(second, 0);
});

test('resolveCountry: 首家超时/异常降级到次家', async () => {
  const r = await Geo.resolveCountry(null, [
    () => Promise.reject(new Error('AbortError: timeout')),
    () => Promise.resolve('de'),
  ]);
  assert.strictEqual(r.country, 'DE');
  assert.strictEqual(r.requests, 2);
});

test('resolveCountry: 返回非法码同样降级', async () => {
  const r = await Geo.resolveCountry(null, [
    () => Promise.resolve('XYZ'),
    () => Promise.resolve(null),
    () => Promise.resolve('fr'),
  ]);
  assert.strictEqual(r.country, 'FR');
  assert.strictEqual(r.requests, 3);
});

test('resolveCountry: 全部失败 → other(静默,不 reject)', async () => {
  const r = await Geo.resolveCountry(null, [
    () => Promise.reject(new Error('net down')),
    () => Promise.resolve({}),
  ]);
  assert.deepStrictEqual(r, { country: 'other', source: 'fallback', requests: 2 });
  const r2 = await Geo.resolveCountry(null, []);
  assert.deepStrictEqual(r2, { country: 'other', source: 'fallback', requests: 0 });
});
