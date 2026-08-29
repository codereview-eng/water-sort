'use strict';
/* 语言持久化门禁（2026-08-29）：
   症状——在 coder 内嵌 webview 里改了语言，刷新又回默认语言。
   根因类别——语言只写 localStorage；内嵌 webview 可能抛异常、静默吞写入，
   或者「写得进、读得回、一刷新就是一份全新空存储」。最后这种连写后读回都测不出来，
   所以手动选的语言必须同时镜像进 URL hash（刷新一定带着 hash）。
   这里锁三层：① core 的 hash 解析/写入/落盘报告；② 决策链里 hash 的优先级；
   ③ 两个游戏页面的接线（core 纯函数全绿挡不住页面没接，见 repo memory「页面接线要单独测」）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const L = require('./core/locale.js');

const AVAIL = ['zh', 'en'];

/* 最小假 window：可切换 localStorage 的三种坏形态 */
function fakeWin(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.seed);
  const win = {
    location: { hash: opts.hash || '', search: opts.search || '' },
    history: opts.noHistory ? null : {
      replaceState(_s, _t, url) { win.location.hash = String(url).slice(String(url).indexOf('#')); }
    },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        if (opts.throwOnSet) throw Object.assign(new Error('storage disabled'), { name: 'SecurityError' });
        if (opts.swallowWrites) return;          // 不抛，但写不进去（沙箱 iframe 的典型形态）
        store[k] = String(v);
      }
    },
    console: { warn: (...a) => win.warned.push(a) },
    warned: []
  };
  return win;
}

test('hashLang / withHashLang：只动 lang，其它 hash 参数原样保留', () => {
  assert.equal(L.hashLang('#lang=en'), 'en');
  assert.equal(L.hashLang('#autostart=3&lang=zh'), 'zh');
  assert.equal(L.hashLang('#autostart=3'), null);
  assert.equal(L.hashLang(''), null);
  assert.equal(L.hashLang(null), null);
  // 幂等：重复切换不会堆出两个 lang=
  assert.equal(L.withHashLang('#lang=zh', 'en'), '#lang=en');
  assert.equal(L.withHashLang('#autostart=3&demoads', 'en'), '#autostart=3&demoads&lang=en');
  assert.equal(L.withHashLang(L.withHashLang('#a=1', 'zh'), 'en'), '#a=1&lang=en');
  // Telegram 从 hash 传 initData，绝不能被吃掉
  const tg = '#tgWebAppData=abc&tgWebAppVersion=7.0';
  assert.ok(L.withHashLang(tg, 'en').includes('tgWebAppData=abc'));
});

test('resolveLang 优先级：?lang= > hash > 已保存 > Telegram > 浏览器 > 默认', () => {
  assert.equal(L.resolveLang({ search: '?lang=zh', hash: '#lang=en', saved: 'en' }, AVAIL, 'en'), 'zh');
  // 关键项：存储被 webview 清空（saved 为空）时，hash 仍能把手动选择带过刷新
  assert.equal(L.resolveLang({ hash: '#lang=en', saved: null, navigatorLanguage: 'zh-CN' }, AVAIL, 'zh'), 'en');
  // hash 是每次手动切换都会刷新的一份，压过可能过期的存储镜像
  assert.equal(L.resolveLang({ hash: '#autostart=3&lang=en', saved: 'zh' }, AVAIL, 'zh'), 'en');
  // hash 里没有 lang → 决策链与改动前完全一致
  assert.equal(L.resolveLang({ hash: '#autostart=3', saved: 'zh', navigatorLanguage: 'en-US' }, AVAIL, 'en'), 'zh');
  assert.equal(L.resolveLang({ hash: '#lang=fr', saved: 'zh' }, AVAIL, 'en'), 'zh', '无字典的 hash 语言要跳过');
});

test('persistLang：正常环境两条通道都写成功，且不新增历史项', () => {
  const win = fakeWin({ hash: '#autostart=3' });
  const r = L.persistLang(win, 'mine_lang', 'en');
  assert.deepEqual({ local: r.local, hash: r.hash, err_name: r.err_name }, { local: true, hash: true, err_name: '' });
  assert.equal(win.localStorage.getItem('mine_lang'), 'en');
  assert.equal(win.location.hash, '#autostart=3&lang=en');
  assert.equal(win.warned.length, 0, '两条都成功时不该报降级');
});

test('persistLang：localStorage 抛异常时 hash 仍写成功，且日志带异常本体', () => {
  const win = fakeWin({ throwOnSet: true });
  const r = L.persistLang(win, 'mine_lang', 'zh');
  assert.equal(r.local, false);
  assert.equal(r.hash, true, '存储不可用时 hash 必须兜住');
  assert.equal(L.hashLang(win.location.hash), 'zh');
  assert.equal(r.err_name, 'SecurityError');
  assert.match(r.err_msg, /storage disabled/);
  assert.equal(win.warned.length, 1, '降级必须大声记一条（禁裸 catch 静默）');
});

test('persistLang：setItem 不抛但写不进去 → 靠读回验证识别出来', () => {
  const win = fakeWin({ swallowWrites: true });
  const r = L.persistLang(win, 'sudoku_lang', 'en');
  assert.equal(r.local, false, 'setItem 不抛 ≠ 写成功，必须读回比对');
  assert.equal(r.err_name, 'StorageReadBackMismatch');
  assert.equal(r.hash, true);
});

test('persistLang：没有 history.replaceState 时退回直接改 hash', () => {
  const win = fakeWin({ noHistory: true, hash: '#lang=zh' });
  const r = L.persistLang(win, 'sudoku_lang', 'en');
  assert.equal(r.hash, true);
  assert.equal(win.location.hash, '#lang=en');
});

test('readSavedLang：hash 优先于本地镜像，两者都读不到就是 null', () => {
  assert.deepEqual(L.readSavedLang(fakeWin({ hash: '#lang=en', seed: { k: 'zh' } }), 'k'),
    { hash: 'en', local: 'zh', value: 'en' });
  assert.deepEqual(L.readSavedLang(fakeWin({ seed: { k: 'zh' } }), 'k'), { hash: null, local: 'zh', value: 'zh' });
  assert.deepEqual(L.readSavedLang(fakeWin({}), 'k'), { hash: null, local: null, value: null });
});

/* ---- 页面接线：光有 core 全绿，页面没接照样刷新丢语言 ---- */
const ROOT = __dirname;
const water = readFileSync(join(ROOT, 'water.html'), 'utf8');
const mine = readFileSync(join(ROOT, 'mine.html'), 'utf8');

function windowAfter(html, anchor, span, label) {
  const i = html.indexOf(anchor);
  assert.ok(i !== -1, `${label}: 找不到锚点 "${anchor}"`);
  assert.equal(html.indexOf(anchor, i + 1), -1, `${label}: 锚点 "${anchor}" 不唯一`);
  return html.slice(i, i + span);
}

test('water：语言下拉改变时走 persistLang，首屏决策链吃 location.hash', () => {
  const onChange = windowAfter(water, "getElementById('langSel').addEventListener", 600, 'water langSel');
  assert.ok(onChange.includes('LocaleCore.persistLang(window, LANG_KEY'), '切语言必须落 hash 通道');
  const resolve = windowAfter(water, 'let LANG = resolveLang(', 200, 'water resolveLang 调用');
  assert.ok(resolve.includes('location.hash'), '首屏解析必须把 hash 传进决策链');
  assert.ok(windowAfter(water, 'function resolveLang(search, saved', 260, 'water resolveLang 定义').includes('hash: hash'));
  // 云端对账不能把 hash 里的手动选择顶掉
  assert.ok(windowAfter(water, 'Store.get(LANG_KEY, (v) => {', 300, 'water 对账').includes('savedLangRead.hash'));
});

test('mine：切语言走 persistLang，首屏决策链吃 location.hash', () => {
  assert.ok(windowAfter(mine, 'function setLang(lang) {', 500, 'mine setLang')
    .includes('LocaleCore.persistLang(window, LANG_KEY'), '切语言必须落 hash 通道');
  const resolve = windowAfter(mine, 'var LANG = LocaleCore.resolveLang({', 260, 'mine resolveLang');
  assert.ok(resolve.includes('hash: location.hash'), '首屏解析必须把 hash 传进决策链');
});
