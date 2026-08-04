// i18n 语言判定测试:node --test i18n.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { detectLang, resolveLang } = require('./i18n.js');

test('detectLang: ?lang= 调试参数最高优先', () => {
  assert.strictEqual(detectLang('?lang=en', 'zh-hans', 'zh-CN'), 'en');
  assert.strictEqual(detectLang('?foo=1&lang=zh', 'en', 'en-US'), 'zh');
});

test('detectLang: Telegram language_code 次之', () => {
  assert.strictEqual(detectLang('', 'zh-hans', 'en-US'), 'zh');
  assert.strictEqual(detectLang('', 'ru', 'zh-CN'), 'en');
});

test('detectLang: navigator.language 兜底, zh* 归 zh 其余 en', () => {
  assert.strictEqual(detectLang('', null, 'zh-TW'), 'zh');
  assert.strictEqual(detectLang('', null, 'ja-JP'), 'en');
  assert.strictEqual(detectLang('', null, null), 'en');
});

test('resolveLang: ?lang= 仍最高优先,盖过 saved 与检测', () => {
  assert.strictEqual(resolveLang('?lang=en', 'zh', 'zh-hans', 'zh-CN'), 'en');
  assert.strictEqual(resolveLang('?lang=zh-TW', 'en', 'en', 'en-US'), 'zh');
});

test('resolveLang: saved 手动选择优先于自动检测', () => {
  assert.strictEqual(resolveLang('', 'en', 'zh-hans', 'zh-CN'), 'en');
  assert.strictEqual(resolveLang('', 'zh', 'en', 'en-US'), 'zh');
});

test('resolveLang: 无 saved 或 saved 非法时走自动检测链', () => {
  assert.strictEqual(resolveLang('', null, 'zh-hans', 'en-US'), 'zh');
  assert.strictEqual(resolveLang('', 'fr', 'ru', 'zh-CN'), 'en'); // 非法 saved 忽略,tgCode=ru → en
  assert.strictEqual(resolveLang('', '', null, null), 'en');
});
