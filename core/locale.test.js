/* 身份/地区/语言 core 单元测试：i18n 回退链 + geo 决策链/白名单 + fail-fast
   （issue #1 · S13/S14 的机制面；场景级断言见 fixtures/S13–S14） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('./locale.js');

test('默认配置 = 无此系统（i18n 未配置取词即抛；geo 未配置全放行）', () => {
  const i = L.createI18n(null);
  assert.equal(i.enabled, false);
  assert.throws(() => i.t('en', 'x'), /未配置/);
  assert.equal(L.createGeoAllow(null)('KP'), true);
});

test('i18n：回退链 具体 locale → 基础语言 → 默认语言，回退记 telemetry', () => {
  const i = L.createI18n({
    default: 'en',
    locales: {
      en: { hi: 'Hi', bye: 'Bye' },
      zh: { hi: '嗨', bye: '再见' },
      'zh-Hant': { hi: '嗨（繁）' }
    }
  });
  assert.equal(i.t('zh-Hant', 'hi'), '嗨（繁）', '具体 locale 命中');
  assert.equal(i.t('zh-Hant', 'bye'), '再见', '区域变体回退基础语言');
  assert.equal(i.t('fr', 'hi'), 'Hi', '缺语言回退默认');
  assert.deepEqual(i.misses().map((m) => m.usedFallback), ['zh', 'en'], '回退触发可观测');
});

test('i18n：默认语言必须全量（加载期）；未知 key 运行期抛错', () => {
  assert.throws(() => L.createI18n({ default: 'en', locales: { en: {}, zh: { hi: '嗨' } } }), /默认语言必须全量/);
  assert.throws(() => L.createI18n({ default: 'en', locales: { zh: { hi: '嗨' } } }), /字典缺失/);
  assert.throws(() => L.createI18n({ default: 'en', locales: { en: { hi: 1 } } }), /必须是字符串/);
  assert.throws(() => L.createI18n({ default: 'en', locales: { en: {} }, warn: true }), /未知键/);
  const i = L.createI18n({ default: 'en', locales: { en: { hi: 'Hi' } } });
  assert.throws(() => i.t('en', 'ghost'), /未知 key/);
});

test('geo：决策链一份代码——override → tg 语言区域 → navigator 区域 → ZZ', () => {
  assert.equal(L.resolveCountry({ override: 'de' }), 'DE');
  assert.equal(L.resolveCountry({ tgLanguageCode: 'zh-CN', navigatorLanguage: 'de-DE' }), 'CN');
  assert.equal(L.resolveCountry({ navigatorLanguage: 'pt_BR' }), 'BR');
  assert.equal(L.resolveCountry({ tgLanguageCode: 'fr' }), 'ZZ', '无区域信息 = 未知国');
  assert.equal(L.resolveCountry(null), 'ZZ');
});

test('geo：allowlist/denylist/all 三模式纯配置', () => {
  const allow = L.createGeoAllow({ mode: 'allowlist', countries: ['CN', 'US'] });
  assert.equal(allow('CN'), true);
  assert.equal(allow('DE'), false);
  const deny = L.createGeoAllow({ mode: 'denylist', countries: ['KP'] });
  assert.equal(deny('KP'), false);
  assert.equal(deny('ZZ'), true);
  assert.equal(L.createGeoAllow({ mode: 'all' })('ZZ'), true);
});

test('fail-fast：未知 mode/空名单/非国家码/未知键 一律加载期抛错', () => {
  assert.throws(() => L.createGeoAllow({ mode: 'whitelist', countries: ['CN'] }), /未知 geo mode/);
  assert.throws(() => L.createGeoAllow({ mode: 'allowlist', countries: [] }), /非空数组/);
  assert.throws(() => L.createGeoAllow({ mode: 'allowlist', countries: ['china'] }), /两位大写国家码/);
  assert.throws(() => L.createGeoAllow({ mode: 'all', countries: ['CN'] }), /不接受 countries/);
  assert.throws(() => L.createGeoAllow({ mode: 'all', banner: 'x' }), /未知键/);
});
