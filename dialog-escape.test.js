'use strict';
/* 硬规则门禁：任何弹窗都必须留有退出路径（右上角 ✕ / 点窗口外 / Esc）。
   触发（2026-08-20）：彩雷误点身份行弹出「去改名 / 退出登录」两个按钮的窗口，没有任何关闭入口，
   用户被困在窗口里出不来。此门禁把「禁止出现用户无法返回的窗口」变成可回归检查的机械断言。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = __dirname;
const GAMES = ['mine.html', 'water.html'];

for (const file of GAMES) {
  const html = readFileSync(join(ROOT, file), 'utf8');

  test(`${file}：弹窗有关闭按钮（✕）`, () => {
    assert.ok(/id="dlgX"/.test(html), '必须有 id="dlgX" 的关闭按钮（mine 写在 overlay 骨架里，water 由 dialog() 注入）');
    assert.ok(/\.dlgx\{/.test(html), '必须有 .dlgx 样式，否则按钮没有可点区域/定位');
    // 无障碍标签必须有；文案本身已 i18n 化（2026-08-21），所以不再钉死中文字面量
    assert.ok(
      /aria-label="关闭"/.test(html) || /aria-label="' \+ t\('close'\)/.test(html)
        || /setAttr\('dlgX', 'aria-label', t\('close'\)\)/.test(html),
      '关闭按钮要有无障碍标签（写死文案或 t(\'close\') 皆可）'
    );
  });

  test(`${file}：点窗口外的遮罩可以关闭`, () => {
    assert.ok(
      /e\.target === ov\b/.test(html) || /e\.target === overlay\b/.test(html),
      '必须判断点击落在遮罩本身才关闭（点窗口内容不应关闭）'
    );
  });

  test(`${file}：Esc 可以关闭`, () => {
    assert.ok(/'Escape'/.test(html) && /keydown/.test(html), '必须监听 keydown 的 Escape');
  });

  test(`${file}：关闭动作统一走 dismissDialog（保证 onDismiss 现场恢复被执行）`, () => {
    const hits = (html.match(/dismissDialog/g) || []).length;
    assert.ok(hits >= 4, `dismissDialog 应被定义并至少接到 ✕/遮罩/Esc 三处，实际出现 ${hits} 次`);
  });
}

test('mine.html：没有绕过 dialog() 直接显示 overlay 的地方', () => {
  const html = readFileSync(join(ROOT, 'mine.html'), 'utf8');
  const adds = (html.match(/\bov\.classList\.add\('show'\)|overlay'\)\.classList\.add\('show'\)/g) || []).length;
  assert.strictEqual(adds, 1, '只允许 dialog() 内唯一一处打开弹窗，否则新弹窗会绕过关闭入口');
});

test('water.html：只有 dialog()/closeDialog() 能改 overlay 内容', () => {
  const html = readFileSync(join(ROOT, 'water.html'), 'utf8');
  const writes = (html.match(/overlay\.innerHTML\s*=/g) || []).length;
  assert.strictEqual(writes, 2, 'overlay.innerHTML 只应在 dialog()（写入）与 closeDialog()（清空）各出现一次');
});

test('局面已结束的弹窗必须带 onDismiss（关掉后不能把人留在死局）', () => {
  const html = readFileSync(join(ROOT, 'mine.html'), 'utf8');
  for (const fn of ['function onWin', 'function onDead', 'function onTimeUp']) {
    // 窗口放宽到 760：onWin 里新增了周活动碎片一行（2026-08-21），620 已截不到 onDismiss
    const body = html.slice(html.indexOf(fn), html.indexOf(fn) + 760);
    // 2026-08-24 双连胜：onDead/onTimeUp 的关窗回首页前先记一次断链（wsOnLose），
    // onDismiss 形态从裸 showHome 变成 function(){ wsOnLose(); showHome(); }。
    // 门禁意图不变：onDismiss 的终点必须是 showHome（关掉后不能把人留在死局）。
    assert.ok(/showHome(\(\); \})?\);/.test(body), `${fn} 的 dialog 调用必须以 showHome 收尾作为 onDismiss`);
  }
});
