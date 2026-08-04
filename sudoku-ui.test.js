const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require.resolve('./sudoku.html'), 'utf8');

function inputHarness() {
  const match = html.match(/function inputDigit\(n\) \{[\s\S]*?\n\}\n\n\/\/ 提示:/);
  assert.ok(match, '应能从页面中定位 inputDigit');

  const events = [];
  const context = {
    S: {
      finished: false,
      sel: 0,
      given: new Array(81).fill(false),
      puzzle: new Array(81).fill(0),
      solution: new Array(81).fill(1),
      bad: new Array(81).fill(false),
      errors: 0,
    },
    MAX_ERR: 3,
    haptic: kind => events.push(['haptic', kind]),
    render: () => events.push(['render']),
    gameOver: () => events.push(['gameOver']),
    win: () => events.push(['win']),
  };
  context.S.solution[0] = 5;

  vm.createContext(context);
  vm.runInContext(match[0].replace(/\n\n\/\/ 提示:$/, '') + '\nthis.inputDigit = inputDigit;', context);
  return { context, events };
}

test('错误数字保留在当前格并标记为红色状态', () => {
  const { context, events } = inputHarness();

  context.inputDigit(3);

  assert.strictEqual(context.S.puzzle[0], 3);
  assert.strictEqual(context.S.bad[0], true);
  assert.strictEqual(context.S.errors, 1);
  assert.deepStrictEqual(events, [['haptic', 'error'], ['render']]);
});

test('再次输入会替换错误值；正确后清除错误状态并锁定', () => {
  const { context } = inputHarness();

  context.inputDigit(3);
  context.inputDigit(4);
  assert.strictEqual(context.S.puzzle[0], 4);
  assert.strictEqual(context.S.bad[0], true);
  assert.strictEqual(context.S.errors, 2);

  context.inputDigit(5);
  assert.strictEqual(context.S.puzzle[0], 5);
  assert.strictEqual(context.S.bad[0], false);
  assert.strictEqual(context.S.errors, 2);

  context.inputDigit(2);
  assert.strictEqual(context.S.puzzle[0], 5);
  assert.strictEqual(context.S.bad[0], false);
  assert.strictEqual(context.S.errors, 2);
});

test('页面把错误状态渲染为 bad 类，bad 类使用错误色', () => {
  assert.match(html, /if \(S\.bad\[i\]\) d\.classList\.add\('bad'\)/);
  assert.match(html, /\.c\.bad\{color:var\(--bad\)/);
});

test('通关用时累计所有广告加时，不再固定按 10 分钟计算', () => {
  const match = html.match(/function grantTimeBonus\(seconds\) \{[\s\S]*?function elapsedTime\(\) \{[^\n]+\}/);
  assert.ok(match, '应能定位广告加时与通关用时函数');

  const context = { S: { remain: 600, timeBudget: 600 } };
  vm.createContext(context);
  vm.runInContext(match[0] + '\nthis.grantTimeBonus = grantTimeBonus; this.elapsedTime = elapsedTime;', context);

  context.S.remain = 0;
  context.grantTimeBonus(60);
  context.S.remain = 0;
  context.grantTimeBonus(60);
  context.S.remain = 25;

  assert.strictEqual(context.S.timeBudget, 720);
  assert.strictEqual(context.elapsedTime(), 695);
  assert.match(html, /const used = elapsedTime\(\)/);
  assert.match(html, /S\.errors = 0; S\.remain = TIME_LIMIT; S\.timeBudget = TIME_LIMIT;/);
});

test('普通网页提供可持久化的玩家名称入口，Telegram 环境继续使用账号名称', () => {
  assert.match(html, /id="btnProfile"/);
  assert.match(html, /document\.getElementById\('profileSource'\)\.textContent = u \? t\('profileTelegram'\) : t\('profileWeb'\)/);
  assert.match(html, /if \(tgUser\(\)\) \{ toast\(t\('profileFromTelegram'\)\); return; \}/);
  assert.match(html, /Profile\.mutate\(\(s\) => \{ s\.alias = alias; \}\)/);
});

test('普通网页使用每浏览器持久化 ID，避免共享榜单固定 local 身份互相覆盖', () => {
  assert.match(html, /localId: ''/);
  assert.match(html, /if \(!st\.localId\) st\.localId = Date\.now\(\)\.toString\(36\)/);
  assert.match(html, /\('local:' \+ \(\(Profile\.state && Profile\.state\.localId\) \|\| 'pending'\)\)/);
  assert.doesNotMatch(html, /\|\| 'local';/);
});

test('网页玩家名称会去掉控制字符、折叠空白并限制为 32 个字符', () => {
  const match = html.match(/function normalizeAlias\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, '应能定位 normalizeAlias');

  const context = {};
  vm.createContext(context);
  vm.runInContext(match[0] + '\nthis.normalizeAlias = normalizeAlias;', context);

  assert.strictEqual(context.normalizeAlias('  Alice\n\tBob  '), 'Alice Bob');
  assert.strictEqual(context.normalizeAlias('x'.repeat(40)), 'x'.repeat(32));
  assert.strictEqual(context.normalizeAlias(null), '');
});
