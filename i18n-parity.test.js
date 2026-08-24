'use strict';
/* 多语言 gate（2026-08-21 定案）：语言字典必须成对完整，英文里不许漏中文。
   背景：用户实报「英文的时候顶部还显示中文」。点位修完还不够——真正的门禁要能拦住
   「以后新增一条 zh 文案忘了补 en」「en 值里粘了中文」「占位符 {n} 两边不一致」
   「彩雷改了 game.config.json 却忘同步 mine.html 内嵌副本」这四类复发。
   本文件是纯静态 gate（node --test 就能跑，进 CI）；运行时逐屏扫描见 scripts/i18n-cjk-scan.mjs。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const ROOT = __dirname;
const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

/* 从 water.html 抽出 const I18N = {...} 并在 vm 里求值（读真实字典，不另抄一份） */
function waterDict() {
  const html = readFileSync(join(ROOT, 'water.html'), 'utf8');
  const i = html.indexOf('const I18N = {');
  assert.ok(i > 0, 'water.html 里找不到 const I18N');
  let depth = 0, end = -1;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  assert.ok(end > 0, 'I18N 大括号不配平');
  const ctx = { out: null };
  vm.createContext(ctx);
  vm.runInContext('out = ' + html.slice(html.indexOf('{', i), end), ctx);
  // 跨 realm：先归一化成本 realm 的普通对象，再做断言
  return JSON.parse(JSON.stringify(ctx.out));
}
function mineDicts() {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'games/mine/game.config.json'), 'utf8'));
  const html = readFileSync(join(ROOT, 'mine.html'), 'utf8');
  const m = /<script id="gameConfig" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'mine.html 里找不到内嵌 gameConfig');
  return { cfg: cfg.i18n.locales, inline: JSON.parse(m[1]).i18n.locales };
}

/* 字典里存在嵌套结构（例如 water 的 shareTpl 是个对象），所以一律先扁平成
   「点路径 → 字符串」再比对：嵌套里漏一条翻译同样要被拦住。 */
function flatten(obj, prefix, out) {
  out = out || {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const GAMES = [
  { name: 'water', dict: waterDict() },
  { name: 'mine', dict: mineDicts().cfg },
].map((g) => Object.assign(g, { flat: { zh: flatten(g.dict.zh), en: flatten(g.dict.en) } }));

for (const g of GAMES) {
  test(`${g.name}：zh / en 键集合完全一致（新增文案不许只补一边）`, () => {
    const zh = Object.keys(g.flat.zh).sort();
    const en = Object.keys(g.flat.en).sort();
    const missingEn = zh.filter((k) => !(k in g.flat.en));
    const missingZh = en.filter((k) => !(k in g.flat.zh));
    assert.deepStrictEqual(missingEn, [], `en 缺这些键：${missingEn.join(', ')}`);
    assert.deepStrictEqual(missingZh, [], `zh 缺这些键：${missingZh.join(', ')}`);
    assert.strictEqual(zh.length, en.length);
    assert.ok(zh.length > 30, `字典太小(${zh.length})，抽取大概出错了`);
  });

  test(`${g.name}：不许一边有文案另一边空（两边都刻意留空是允许的）`, () => {
    // 例：statNoPar 两边都是 ''（没有最优解信息时这一行不显示），这是刻意的，不算漏译；
    // 真正要拦的是「zh 有字、en 空着」这种半成品。
    /* 合法的语言不对称必须逐条写清理由（白名单只放这类，不放漏译）：
       lvlPost = 中文「第 {n} 关」的量词后缀，英文 "Level {n}" 天然没有后缀。 */
    const ASYMMETRIC_OK = { water: ['lvlPost'], mine: [] };
    const bad = [];
    for (const k of Object.keys(g.flat.zh)) {
      if ((ASYMMETRIC_OK[g.name] || []).includes(k)) continue;
      const a = String(g.flat.zh[k] ?? '').trim(), b = String(g.flat.en[k] ?? '').trim();
      if ((a.length > 0) !== (b.length > 0)) bad.push(`${k}: zh="${a.slice(0, 20)}" en="${b.slice(0, 20)}"`);
    }
    assert.deepStrictEqual(bad, [], `一边有一边空：\n  ${bad.join('\n  ')}`);
    for (const lang of ['zh', 'en']) {
      for (const [k, v] of Object.entries(g.flat[lang])) {
        assert.strictEqual(typeof v, 'string', `${lang}.${k} 扁平化后应该是字符串（意外的类型：${typeof v}）`);
      }
    }
  });

  test(`${g.name}：en 文案里不许出现中日韩字符`, () => {
    const leaks = Object.entries(g.flat.en)
      .filter(([, v]) => CJK.test(v))
      .map(([k, v]) => `${k}="${v.slice(0, 40)}"`);
    assert.deepStrictEqual(leaks, [], `en 字典里漏了中文：\n  ${leaks.join('\n  ')}`);
  });

  test(`${g.name}：同一个键的占位符两边一致（{n}/{s} 不许一边多一边少）`, () => {
    const bad = [];
    for (const k of Object.keys(g.flat.zh)) {
      if (!(k in g.flat.en)) continue;
      const set = (s) => (String(s).match(PLACEHOLDER) || []).slice().sort().join(',');
      const a = set(g.flat.zh[k]), b = set(g.flat.en[k]);
      if (a !== b) bad.push(`${k}: zh[${a}] vs en[${b}]`);
    }
    assert.deepStrictEqual(bad, [], `占位符不一致：\n  ${bad.join('\n  ')}`);
  });
}

test('mine：game.config.json 与 mine.html 内嵌副本的字典逐键一致', () => {
  const { cfg, inline } = mineDicts();
  for (const lang of ['zh', 'en']) {
    assert.deepStrictEqual(
      Object.keys(inline[lang]).sort(), Object.keys(cfg[lang]).sort(),
      `${lang} 键集合不一致：改 config 后必须同步 mine.html 内嵌 gameConfig`
    );
    for (const k of Object.keys(cfg[lang])) {
      assert.strictEqual(inline[lang][k], cfg[lang][k], `${lang}.${k} 内容不一致（内嵌副本没同步）`);
    }
  }
});

test('静态 HTML 里不许新增写死中文的 aria-label / title / placeholder', () => {
  // 已知例外：mine.html 静态骨架里留了中文默认值，但 applyStaticI18n() 会按语言覆盖它们
  const COVERED = {
    'mine.html': ['aria-label="扫雷棋盘"', 'aria-label="关闭"', 'title="关闭"', 'aria-label="语言"'],
    'water.html': ['aria-label="瓶架"'],
  };
  for (const file of ['water.html', 'mine.html']) {
    const html = readFileSync(join(ROOT, file), 'utf8');
    const hits = (html.match(/(?:aria-label|title|placeholder)="[^"]*"/g) || [])
      .filter((s) => CJK.test(s))
      .filter((s) => !(COVERED[file] || []).includes(s));
    assert.deepStrictEqual(hits, [], `${file} 里这些属性写死了中文（要走 t() 或加进静态回填）：\n  ${hits.join('\n  ')}`);
  }
});

test('静态骨架里的中文默认值都有对应的按语言回填代码', () => {
  const mine = readFileSync(join(ROOT, 'mine.html'), 'utf8');
  for (const [sel, key] of [['board', 'boardLabel'], ['langSel', 'langLabel'], ['dlgX', 'close']]) {
    assert.ok(new RegExp(`setAttr\\('${sel}', 'aria-label', t\\('${key}'\\)\\)`).test(mine),
      `mine #${sel} 的 aria-label 必须在 applyStaticI18n() 里按 t('${key}') 回填`);
  }
  const water = readFileSync(join(ROOT, 'water.html'), 'utf8');
  assert.ok(/q\('#tubes'\)[\s\S]{0,120}setAttribute\('aria-label', t\('boardLabel'\)\)/.test(water),
    'water 的 #tubes（瓶架）aria-label 必须按 t(\'boardLabel\') 回填');
  assert.ok(/#btnWkBack'\); if \(wkBack\) wkBack\.textContent = t\('back'\)/.test(water),
    'water 活动页返回按钮必须按 t(\'back\') 回填');
});
