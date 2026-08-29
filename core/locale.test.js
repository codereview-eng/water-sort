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

/* ---- 语言选择决策链（两个游戏共用，抽自 water.html 既有实现）---- */
const AVAIL = ['zh', 'en'];

test('resolveLang 优先级：已保存 > ?lang= > Telegram > 浏览器 > 默认', () => {
  /* 2026-08-29 改序：玩家手动选的语言压过 URL 参数。
     宿主（内嵌 webview / 壳页面）每次按固定地址装载游戏时会带上 ?lang=，
     排在最前就会把玩家的选择每次顶掉——表现为「改完重进又变回去」。 */
  assert.equal(L.resolveLang({ search: '?lang=en', saved: 'zh', tgLanguageCode: 'en', navigatorLanguage: 'en-US' }, AVAIL, 'en'), 'zh',
    '手动选择必须压过 URL 参数');
  // 没手动选过时，?lang= 照旧生效（调试/截图脚本跑在干净环境里，本来就没有已保存的选择）
  assert.equal(L.resolveLang({ search: '?lang=en', tgLanguageCode: 'zh', navigatorLanguage: 'zh-CN' }, AVAIL, 'zh'), 'en');
  // 没有 ?lang= 时，用户手动选择（持久化）优先于自动检测
  assert.equal(L.resolveLang({ saved: 'en', tgLanguageCode: 'zh', navigatorLanguage: 'zh-CN' }, AVAIL, 'zh'), 'en');
  // 没保存过 → Telegram 客户端语言
  assert.equal(L.resolveLang({ tgLanguageCode: 'zh-hans', navigatorLanguage: 'en-US' }, AVAIL, 'en'), 'zh');
  // 再退浏览器语言
  assert.equal(L.resolveLang({ navigatorLanguage: 'zh-TW' }, AVAIL, 'en'), 'zh');
  // 全都没有/都不认识 → 默认语言
  assert.equal(L.resolveLang({ navigatorLanguage: 'fr-FR' }, AVAIL, 'en'), 'en');
  assert.equal(L.resolveLang({}, AVAIL, 'zh'), 'zh');
});

test('resolveLang 忽略不可用语言，继续往下退（不会返回没有字典的语言）', () => {
  // ?lang=fr 无字典 → 跳过，落到已保存的 zh
  assert.equal(L.resolveLang({ search: '?lang=fr', saved: 'zh' }, AVAIL, 'en'), 'zh');
  // 保存过一个后来被删掉的语言 → 跳过，落到浏览器语言
  assert.equal(L.resolveLang({ saved: 'de', navigatorLanguage: 'en-GB' }, AVAIL, 'zh'), 'en');
});

test('matchLang 按 RFC 4647 lookup：精确 → 基础语言（截断区域）', () => {
  assert.equal(L.matchLang('zh', AVAIL), 'zh');
  assert.equal(L.matchLang('zh-CN', AVAIL), 'zh', '区域变体落到基础语言');
  assert.equal(L.matchLang('EN-us', AVAIL), 'en', '大小写不敏感');
  assert.equal(L.matchLang('fr', AVAIL), null, '没有就是没有，不瞎猜');
  assert.equal(L.matchLang('', AVAIL), null);
  assert.equal(L.matchLang('zh-Hant', ['zh-Hant', 'zh', 'en']), 'zh-Hant', '精确优先于基础语言');
});

test('resolveLang fail-fast：available 为空或默认语言不在其中，加载期就抛', () => {
  assert.throws(() => L.resolveLang({}, [], 'en'), /available 必须是非空数组/);
  assert.throws(() => L.resolveLang({}, AVAIL, 'fr'), /默认语言 "fr" 不在 available/);
});

test('htmlLang：zh → zh-CN（给 <html lang> 用，影响字体与朗读）', () => {
  assert.equal(L.htmlLang('zh'), 'zh-CN');
  assert.equal(L.htmlLang('en'), 'en');
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
