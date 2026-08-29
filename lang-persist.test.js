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

/* 第三条通道：云存档（跟账号走，不依赖本机存储/URL）。
   前两条都活在这台设备的这个页面里——内嵌 webview 换存储分区、宿主按原始 URL 重载，
   两条可能一条都不剩；云端那份是唯一不受本机环境摆布的。与音效开关 sfx 同一条通道。 */
test('mine：语言进云存档——schema 有列、config 有字段映射、合并策略是 newest', () => {
  const schema = JSON.parse(readFileSync(join(ROOT, 'games/mine/schema.json'), 'utf8'));
  assert.equal(schema.entities.Save.fields.lang, 'string', 'schema 缺 lang 列，云端存不下');
  const cfg = JSON.parse(readFileSync(join(ROOT, 'games/mine/game.config.json'), 'utf8'));
  assert.deepEqual(cfg.platform.fields.lang, { col: 'lang', merge: 'newest' },
    '语言是「最后一次选的算数」，只能 newest；用 max 会把语言当数值比大小');
  // 内嵌副本必须同步，否则线上跑的是旧配置（改 config 忘同步是本仓惯犯）
  const embedded = JSON.parse(windowAfter(mine, '<script id="gameConfig" type="application/json">', 200000,
    'mine 内嵌配置').replace(/^[^{]*/, '').replace(/<\/script>[\s\S]*$/, ''));
  assert.deepEqual(embedded.platform.fields.lang, { col: 'lang', merge: 'newest' }, '内嵌 gameConfig 副本未同步');
});

test('mine：切语言写云档字段，云档回来按它切语言', () => {
  const set = windowAfter(mine, 'function setLang(lang) {', 900, 'mine setLang');
  assert.ok(set.includes('save.lang = LANG'), '切语言必须写进云档字段');
  assert.ok(set.includes('persist()'), '写完必须 persist（persist 内含 platformSync）');
  const cloud = windowAfter(mine, 'ensureTempName(); persist(); renderHome();', 400, 'mine 云档合并出口');
  assert.ok(cloud.includes('setLang(save.lang)'), '云档合并后必须按云端语言切过去');
  assert.ok(cloud.includes('lang=/.test(location.search)'), '?lang= 调试参数在场时云端不夺权');
});

test('mine：设置页显示构建标记（分辨设备拿到的是哪一版）', () => {
  const s = windowAfter(mine, 'function openSettings() {', 2600, 'mine openSettings');
  assert.ok(s.includes("getAttribute('data-build')"), '设置页要读 <html data-build>');
  assert.ok(s.includes("'buildLine'"), '构建标记行缺 id，验收脚本抓不到');
  assert.ok(s.includes('langDiagText()'), '点构建号要能展开通道诊断');
});

test('mine：切语言立即冲刷云同步（不等 1.5s 防抖）', () => {
  const set = windowAfter(mine, 'function setLang(lang) {', 1200, 'mine setLang');
  assert.ok(/Plat\.flush\(/.test(set),
    '显式偏好必须立即落云端：切完就退出时防抖窗口内的写入会整个丢掉');
  assert.ok(set.indexOf('persist()') < set.indexOf('Plat.flush('), 'flush 必须在 persist 之后');
});

test('mine：三条通道与平台状态都进诊断（排障不靠猜）', () => {
  const diag = windowAfter(mine, 'function langDiagText() {', 500, 'mine langDiagText');
  for (const k of ['local=', 'hash=', 'cloud=', 'sfx=', 'merged=', 'plat=', 'err=']) {
    assert.ok(diag.includes(k), `诊断行缺 ${k}`);
  }
  // 云端两类失败都要留下异常本体（禁静默）
  assert.ok(mine.includes("LANG_DIAG.err = 'loadCloud:'"), '云档载入失败未记诊断');
  assert.ok(mine.includes("LANG_DIAG.err = 'saveCloud#'"), '云档回写失败未记诊断');
  // 对照字段：sfx 是老列，若 cloud=none 而 sfx 有值，就是新列没建，而不是没写
  assert.ok(mine.includes('LANG_DIAG.cloudSfx'), '缺 sfx 对照，分不清「列没建」和「没写上」');
});

test('mine：切语言走 persistLang，首屏决策链吃 location.hash', () => {
  assert.ok(windowAfter(mine, 'function setLang(lang) {', 500, 'mine setLang')
    .includes('LocaleCore.persistLang(window, LANG_KEY'), '切语言必须落 hash 通道');
  const resolve = windowAfter(mine, 'var LANG = LocaleCore.resolveLang({', 260, 'mine resolveLang');
  assert.ok(resolve.includes('hash: location.hash'), '首屏解析必须把 hash 传进决策链');
});
