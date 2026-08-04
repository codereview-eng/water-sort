// i18n 语言判定纯函数(与 sudoku.html 内联同源):
// 优先级 ?lang= 调试参数 → Telegram language_code → navigator.language → 默认 en;zh* 归 zh,其余 en。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SudokuI18n = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function detectLang(search, tgCode, navLang) {
    const m = /[?&]lang=([A-Za-z-]+)/.exec(search || '');
    const cand = (m && m[1]) || tgCode || navLang || 'en';
    return /^zh/i.test(cand) ? 'zh' : 'en';
  }
  // issue #18:已保存语言优先层。优先级 ?lang=(调试,最高) → saved(手动选择的持久化值) → 自动检测链。
  // saved 仅接受字典已有语言码(zh/en),非法值忽略回落检测。
  function resolveLang(search, saved, tgCode, navLang) {
    const m = /[?&]lang=([A-Za-z-]+)/.exec(search || '');
    if (m) return /^zh/i.test(m[1]) ? 'zh' : 'en';
    if (saved === 'zh' || saved === 'en') return saved;
    return detectLang('', tgCode, navLang);
  }
  return { detectLang, resolveLang };
}));
