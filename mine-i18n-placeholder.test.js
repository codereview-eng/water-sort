'use strict';
/* 占位符契约 gate（2026-08-27）：
   彩雷的文案权威落点是 games/mine/game.config.json 的 i18n.locales.*，
   页面用 t(key, vars) 消费；core/locale.js 的插值对「字典里有、vars 里没有」的占位符
   是【原样保留】——所以变量名一旦对不上，用户看到的就是字面量 `{level}`，
   而单元测试与多语言 parity gate 全都照绿（真实事故：PR #15 把 onWin 的
   { level: S.lv } 统一改成 { n: S.lv }，配置里仍是 {level}，通关弹窗显示「第 {level} 关通过」）。

   本 gate 的判据：凡在 mine.html / core/*.js 里以字面量 key 调用 t(key, {...}) 的地方，
   该 key 在任意语言字典中出现过的每一个占位符，都必须由这次调用传入。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'games/mine/game.config.json'), 'utf8'));

/** key -> Set(占位符名)，跨全部语言取并集（任一语言用到就必须传） */
function placeholderMap(locales) {
  const map = new Map();
  for (const lang of Object.keys(locales)) {
    for (const [key, val] of Object.entries(locales[lang])) {
      if (typeof val !== 'string') continue;
      for (const m of val.matchAll(/\{(\w+)\}/g)) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(m[1]);
      }
    }
  }
  return map;
}

/** 扫源码里的 t('key', { a: ..., b: ... }) 调用；只认字面量 key + 单层对象字面量 */
function callSites(src, file) {
  const out = [];
  const re = /\bt\(\s*['"]([A-Za-z0-9_]+)['"]\s*(?:,\s*\{([^{}]*)\})?\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    const vars = m[2] ? [...m[2].matchAll(/([A-Za-z0-9_]+)\s*:/g)].map((x) => x[1]) : [];
    out.push({ key: m[1], vars, file, line });
  }
  return out;
}

function sources() {
  const files = [path.join(ROOT, 'mine.html')];
  for (const f of fs.readdirSync(path.join(ROOT, 'core'))) {
    if (f.endsWith('.js') && !f.endsWith('.test.js')) files.push(path.join(ROOT, 'core', f));
  }
  return files.map((f) => ({ file: path.relative(ROOT, f), src: fs.readFileSync(f, 'utf8') }));
}

test('彩雷：每个 t() 调用都补齐了字典里的占位符（禁止 {level} 这类字面量漏到界面）', () => {
  const need = placeholderMap(cfg.i18n.locales);
  const bad = [];
  for (const { file, src } of sources()) {
    for (const site of callSites(src, file)) {
      const want = need.get(site.key);
      if (!want) continue;
      const missing = [...want].filter((v) => !site.vars.includes(v));
      if (missing.length) {
        bad.push(`${site.file}:${site.line} t('${site.key}') 缺参数 {${missing.join('} {')}}`
          + `（字典要求 ${[...want].join(',')}；调用传了 ${site.vars.join(',') || '无'}）`);
      }
    }
  }
  assert.deepStrictEqual(bad, [], '占位符未填充：\n' + bad.join('\n'));
});

test('彩雷：mine.html 内嵌配置副本与权威配置的占位符集合一致', () => {
  const html = fs.readFileSync(path.join(ROOT, 'mine.html'), 'utf8');
  const m = html.match(/<script id="gameConfig" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'mine.html 里找不到内嵌 gameConfig');
  const inline = placeholderMap(JSON.parse(m[1]).i18n.locales);
  const authority = placeholderMap(cfg.i18n.locales);
  const dump = (mm) => [...mm.entries()].map(([k, v]) => k + ':' + [...v].sort().join(',')).sort();
  assert.deepStrictEqual(dump(inline), dump(authority));
});

test('locale 插值：vars 缺项时原样保留占位符（本 gate 存在的理由）', () => {
  const LocaleCore = require('./core/locale.js');
  const I18n = LocaleCore.createI18n(cfg.i18n);
  const raw = I18n.t('zh', 'winTitle');
  assert.match(raw, /\{level\}/, '字典文案应带 {level} 占位符');
  const interp = raw.replace(/\{(\w+)\}/g, (mm, name) => ({ n: 7 }[name] !== undefined ? '7' : mm));
  assert.match(interp, /\{level\}/, '传错变量名时占位符会原样显示——所以必须靠上面的 gate 拦住');
});
