'use strict';
/* 门禁：英文模式下不许漏中文。
   用户实报（2026-08-21）：「英文的时候，顶部还显示中文」。逐屏机械扫描（chrome CDP，?lang=en）
   查出四类缺口，这里把每一类都钉成断言，防止再漏：
   ① 系统默认名把「生成时那门语言」的字面量写进了存档（首次中文打开 → 永远是「玩家2904」，
      头像取名字首字 → 「玩」），切英文不跟着变；
   ② 活动页返回按钮只写在静态 HTML 里，没进 applyStaticI18n()；
   ③ 弹窗 ✕ 的 aria-label/title 写死中文；
   ④ 彩雷的棋盘/语言下拉 aria-label 写死中文。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const ROOT = __dirname;
const water = readFileSync(join(ROOT, 'water.html'), 'utf8');
const mine = readFileSync(join(ROOT, 'mine.html'), 'utf8');

// core/identity.js 的 UMD 模块在 vm 里加载，直接测纯函数（跨 realm 返回值先归一化）
function loadIdentityCore() {
  const src = readFileSync(join(ROOT, 'core/identity.js'), 'utf8');
  const sandbox = { window: {}, module: undefined, globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.IdentityCore || sandbox.IdentityCore;
}

test('系统默认名按当前语言重拼（存档里的中文字面量不再锁死显示）', () => {
  const Id = loadIdentityCore();
  assert.ok(Id && typeof Id.localizeAlias === 'function', 'core/identity.js 必须导出 localizeAlias');
  assert.strictEqual(Id.localizeAlias('玩家2904', 'Player '), 'Player 2904', '中文默认名 → 英文');
  assert.strictEqual(Id.localizeAlias('Player 2904', '玩家'), '玩家2904', '英文默认名 → 中文');
  assert.strictEqual(Id.localizeAlias('朱克锋', 'Player '), '朱克锋', '用户/云端真名一律原样保留');
  assert.strictEqual(Id.localizeAlias('玩家小明', 'Player '), '玩家小明', '不是「前缀+纯数字」的名字不动');
  assert.strictEqual(Id.localizeAlias('', 'Player '), '', '空名不编造');
  assert.strictEqual(Id.aliasSeed('玩家2904'), '2904');
  assert.strictEqual(Id.aliasSeed('朱克锋'), null);
});

test('两个游戏的身份行都走 localizeAlias（不是各自再拼一遍）', () => {
  assert.ok(/IdentityCore\.localizeAlias\(/.test(water), 'water.html 的 tempName() 要走 localizeAlias');
  assert.ok(/IdentityCore\.localizeAlias\(/.test(mine), 'mine.html 的 identityView() 要走 localizeAlias');
});

test('弹窗 ✕ 的 aria-label/title 不许写死中文', () => {
  assert.ok(!/aria-label="关闭"/.test(water) && !/title="关闭"/.test(water),
    'water.html 的 ✕ 要用 t(\'close\')');
  assert.ok(/aria-label="' \+ t\('close'\)/.test(water),
    'water.html 的 ✕ 必须用 t(\'close\') 拼 aria-label');
  assert.ok(/setAttr\('dlgX', 'aria-label', t\('close'\)\)/.test(mine),
    'mine.html 的 ✕ 要在静态回填里刷 aria-label');
});

test('water 的活动页返回按钮进了静态文案回填', () => {
  const i = water.indexOf('function applyStaticI18n');
  const body = water.slice(i, water.indexOf('\nfunction ', i + 20));
  assert.ok(/#btnWkBack/.test(body), 'applyStaticI18n() 必须刷 #btnWkBack，否则英文下仍是「‹ 返回」');
});

test('两个游戏的 close 文案键 zh/en 都齐（彩雷含内嵌副本）', () => {
  assert.ok(/close: '关闭'/.test(water) && /close: 'Close'/.test(water), 'water.html 字典要有 close');
  const cfg = JSON.parse(readFileSync(join(ROOT, 'games/mine/game.config.json'), 'utf8'));
  for (const lang of ['zh', 'en']) {
    const loc = cfg.i18n.locales[lang];
    for (const k of ['close', 'boardLabel', 'langLabel', 'playerPrefix']) {
      assert.ok(loc[k], `games/mine/game.config.json locales.${lang}.${k} 缺失`);
    }
  }
  // 内嵌副本必须同步，否则线上产物读的是旧字典（改 config 忘同步内嵌是本仓踩过的坑）
  const m = /<script id="gameConfig" type="application\/json">([\s\S]*?)<\/script>/.exec(mine);
  const inline = JSON.parse(m[1]);
  for (const lang of ['zh', 'en']) {
    for (const k of ['close', 'boardLabel']) {
      assert.ok(inline.i18n.locales[lang][k], `mine.html 内嵌 gameConfig locales.${lang}.${k} 未同步`);
    }
  }
});

test('彩雷静态 HTML 里不再留写死中文的 aria-label', () => {
  assert.ok(!/aria-label="扫雷棋盘"/.test(mine) || /setAttr\('board', 'aria-label'/.test(mine),
    '静态默认值可留，但必须有按语言回填的代码');
  assert.ok(/setAttr\('board', 'aria-label', t\('boardLabel'\)\)/.test(mine));
  assert.ok(/setAttr\('langSel', 'aria-label', t\('langLabel'\)\)/.test(mine));
});
