/*
 * 产物自检器的测试。
 *
 * 这个门禁存在的唯一理由是「能抓住 #57 那次白屏」，所以测试的重点不是
 * 「好产物能过」，而是**坏产物必须红**——而且是用那次线上真实出现的坏法来验，
 * 不是自己编一个好抓的。四种形态全部抄自当时线上的产物原文。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = __dirname;

// ESM 模块，用动态 import 载入
let mod;
async function load() {
  if (!mod) mod = await import('./scripts/verify-artifact.mjs');
  return mod;
}

function page(...blocks) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>${blocks.join('')}</body></html>`;
}
const okJson = '<script id="gameConfig" type="application/json">{"a":"中文没问题","b":1}</script>';
const okJs = '<script>var a = 1; function f(){ return "ok"; }</script>';

test('好产物：全部块可解析', async () => {
  const { verifyArtifact } = await load();
  const r = verifyArtifact(page(okJson, okJs));
  assert.strictEqual(r.total, 2);
  assert.deepStrictEqual(r.bad, []);
});

test('#57 形态一：JSON 值里出现未转义的英文双引号 —— 必须红', async () => {
  const { verifyArtifact } = await load();
  // 线上原文：{"homeHint1":"Tap = mark "not a mine" ·  Hold & drag = batch mark · Double-tap = dig"}
  const broken = '<script id="gameConfig" type="application/json">'
    + '{"homeHint1":"Tap = mark "not a mine" ·  Hold & drag = batch mark"}</script>';
  const r = verifyArtifact(page(broken, okJs));
  assert.strictEqual(r.bad.length, 1, '坏了的 JSON 必须被抓到');
  assert.strictEqual(r.bad[0].kind, 'JSON');
  assert.strictEqual(r.bad[0].id, 'gameConfig', '要能指出是哪一块');
});

test("#57 形态二：单引号 JS 字符串里出现英文缩写撇号（can't）—— 必须红", async () => {
  const { verifyArtifact } = await load();
  // 线上原文（core/home.js L439）
  const broken = "<script>function f(){ fail('dock.props.items  at most five (more and fingers can't hit them)'); }</script>";
  const r = verifyArtifact(page(okJson, broken));
  assert.strictEqual(r.bad.length, 1);
  assert.strictEqual(r.bad[0].kind, 'JS');
});

test("#57 形态三：错误消息里的 language's —— 必须红", async () => {
  const { verifyArtifact } = await load();
  // 线上原文（core/locale.js L52）
  const broken = '<script>' + "throw new Error('locale: unknown  key \"' + key + '\" (outside the default language's full set)');" + '</script>';
  const r = verifyArtifact(page(broken));
  assert.strictEqual(r.bad.length, 1);
});

test("#57 形态四：wasn't —— 必须红", async () => {
  const { verifyArtifact } = await load();
  // 线上原文（mine.html 主逻辑 L1434）
  const broken = "<script>stPut(out, 'result', 'no backup (unlock wasn't tapped this session)');</script>";
  const r = verifyArtifact(page(broken));
  assert.strictEqual(r.bad.length, 1);
});

test('多块同时坏：一次全部报出来，不是只报第一块', async () => {
  const { verifyArtifact } = await load();
  const b1 = '<script id="gameConfig" type="application/json">{"k":"a "b" c"}</script>';
  const b2 = "<script>f('can't');</script>";
  const b3 = "<script>g('wasn't');</script>";
  const r = verifyArtifact(page(b1, okJs, b2, b3));
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.bad.length, 3, '三块坏的都要报，漏报等于门禁没用');
  assert.deepStrictEqual(r.bad.map((b) => b.index), [0, 2, 3], '要能指出坏在第几块');
});

test('坏点附近的原文要带出来（不然修的人不知道是哪句文案被改写了）', async () => {
  const { verifyArtifact } = await load();
  const broken = "<script>fail('at most five (more and fingers can't hit them)');</script>";
  const r = verifyArtifact(page(broken));
  assert.ok(r.bad[0].excerpt.length > 0, '必须给出坏点附近原文');
});

test('report(): 全过返回 true，有坏返回 false', async () => {
  const { verifyArtifact, report } = await load();
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    assert.strictEqual(report(verifyArtifact(page(okJson, okJs))), true);
    assert.strictEqual(report(verifyArtifact(page('<script>f(\'can\'t\');</script>'))), false);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
});

test('回归锚点：仓里的 mine.html 本身必须全块可解析', async () => {
  const { verifyArtifact } = await load();
  const r = verifyArtifact(readFileSync(join(ROOT, 'mine.html'), 'utf8'));
  assert.deepStrictEqual(r.bad, [], 'mine.html 里有块解析不了——内联配置或内联脚本被改坏了');
  assert.ok(r.total >= 2, '至少应有内联 gameConfig 与主逻辑两块');
});
