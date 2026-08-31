/* 门禁：开发自检面板（#selftest + 充值 10000 金币）不许出现在发布产物里。
   2026-08-31 定案：线上任何人只要知道 #selftest 就能给自己账号加 10000 金币，
   而且 coinsEarned 云端是 merge:"max"（只增），加上去还降不回来。

   本文件锁三件事：
   1. mine.html 里标记成对，且面板代码还在（本地调试能力没被误删）；
   2. stripSelfTest 真能把三段整段删掉，剔完不残留任何记号；
   3. 只隐藏不删是不够的 —— 主脚本是顶层 classic script，grantCoins 会挂到 window，
      所以断言剔除后连函数声明都不存在。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const HTML = readFileSync(join(__dirname, 'mine.html'), 'utf8');

/** 与 scripts/strip-selftest.mjs 同一份实现（ESM，测试里动态 import）。 */
async function strip() {
  return import('./scripts/strip-selftest.mjs');
}

test('mine.html 的 selftest 标记成对，且三段面板代码都还在', async () => {
  const begins = (HTML.match(/selftest:begin/g) || []).length;
  const ends = (HTML.match(/selftest:end/g) || []).length;
  assert.strictEqual(begins, ends, 'selftest:begin/end 数量必须相等，否则构建剔除会吃掉别的代码');
  const { SELFTEST_BLOCKS } = await strip();
  assert.strictEqual(begins, SELFTEST_BLOCKS,
    `标记块必须是 ${SELFTEST_BLOCKS} 段（CSS / DOM / JS 各一段）`);
  // 本地调试能力仍在：删标记 ≠ 删功能，这条防的是「为了过门禁把面板整个删了」
  assert.ok(/function grantCoins\(/.test(HTML), 'mine.html 里应保留 grantCoins（本地调试用）');
  assert.ok(/id="selftest"/.test(HTML), 'mine.html 里应保留自检面板 DOM（本地调试用）');
});

test('stripSelfTest 剔除后产物不残留任何自检面板记号', async () => {
  const { stripSelfTest, assertNoSelfTest, SELFTEST_BLOCKS, SELFTEST_RESIDUE } = await strip();
  const { html: out, removed } = stripSelfTest(HTML);
  assert.strictEqual(removed, SELFTEST_BLOCKS, '应剔除全部标记块');
  assert.doesNotMatch(out, SELFTEST_RESIDUE, '剔除后仍能搜到面板记号');
  assert.doesNotThrow(() => assertNoSelfTest(out, 'test'));

  // 顶层函数声明会挂 window：光隐藏面板挡不住控制台直接调用，所以必须连声明一起没了
  assert.ok(!/grantCoins/.test(out), '剔除后不许还存在 grantCoins 全局函数');
  assert.ok(!/id="selftest"/.test(out), '剔除后不许还存在面板 DOM');
  assert.ok(!/GRANT_AMOUNT/.test(out), '剔除后不许还存在充值额度常量');

  // 只删标记块，别把正常游戏代码顺手带走
  assert.ok(/function startGame\(/.test(out), '误删了正常游戏代码');
  assert.ok(/window\.__mine/.test(out), '误删了截图/自动化调试口');
  assert.ok(out.length > HTML.length * 0.9, `剔除量异常：${HTML.length} → ${out.length}`);
});

test('stripSelfTest 幂等，且标记不成对时 fail-close', async () => {
  const { stripSelfTest } = await strip();
  const once = stripSelfTest(HTML).html;
  const twice = stripSelfTest(once);
  assert.strictEqual(twice.removed, 0, '第二次剔除应无事可做');
  assert.strictEqual(twice.html, once, '剔除必须幂等');

  assert.throws(() => stripSelfTest('/* selftest:begin */\nfoo\n'), /不成对/,
    '缺 end 标记必须抛错，而不是静默删到文件末尾');
});

test('core/story.js 的 selftest 判断不受影响（那是跳过剧情 CG，不是充值通道）', async () => {
  const story = readFileSync(join(__dirname, 'core/story.js'), 'utf8');
  assert.ok(/shot\|selftest/.test(story),
    'story 的截图 lane 判断被误删了：它与充值面板无关，剔除规则不该一刀切');
});
