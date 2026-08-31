'use strict';
/* 门禁：自检面板的【充值】部分不许进发布产物；面板与【CG 自检】则必须留在产物里。

   两次拍板，别混成一条（混了就会把该留的也剔掉，或把该剔的放回去）：
   ① 2026-08-31 · 线上不能带充值通道 —— 知道 #selftest 就能给自己加 10000 金币，
      而 coinsEarned 云端是 merge:"max"（只增），加上去还降不回来；
   ② 2026-08-31 · 线上要保留 CG 自检 —— 检查剧情 CG 必须在真机真环境做
      （CG 素材不进 git，本地开 mine.html 根本播不出画面）。
      代价是知情玩家能提前看全部剧情，owner 明确接受。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const HTML = readFileSync(join(__dirname, 'mine.html'), 'utf8');

/** 与发布构建同一份实现（ESM，测试里动态 import）——剔除规则只有一个权威落点。 */
async function strip() {
  return import('./scripts/strip-selftest.mjs');
}

test('selftest 标记成对，且面板三部分源码都还在', async () => {
  const begins = (HTML.match(/selftest:begin/g) || []).length;
  const ends = (HTML.match(/selftest:end/g) || []).length;
  assert.strictEqual(begins, ends, 'begin/end 数量必须相等，否则构建剔除会吃掉别的代码');
  const { SELFTEST_BLOCKS } = await strip();
  assert.strictEqual(begins, SELFTEST_BLOCKS,
    `标记块必须是 ${SELFTEST_BLOCKS} 段（grantCoins 整段 + 充值按钮行 + 它的绑定行）`);
  assert.ok(/function grantCoins\(/.test(HTML), '源码应保留 grantCoins（本地调试用）');
  assert.ok(/id="selftest"/.test(HTML), '源码应保留自检面板 DOM');
  assert.ok(/function stCgUnlockAll\(/.test(HTML), '源码应保留 CG 全解锁');
  assert.ok(/function stCgRestore\(/.test(HTML), 'CG 解锁必须能还原，否则不叫「临时」');
});

test('CG 自检只写 seen 列表，绝不改存档进度', () => {
  const body = HTML.slice(HTML.indexOf('function stCgUnlockAll('), HTML.indexOf('function syncSelfTestEntry('));
  assert.ok(body.includes('St.seenKey'), '解锁必须走 core 暴露的 seenKey，不许自己拼 key');
  assert.ok(!/save\.level\s*=/.test(body), '不许改 save.level（那不是「临时」，是污染存档）');
  assert.ok(!/save\.clears\s*=/.test(body), '不许改 save.clears');
  assert.ok(!/persist\(\)/.test(body), '不许写存档');
  assert.ok(body.includes('ST_SEEN_BAK'), '必须先备份原 seen 列表才能还原');
  // 只备份一次：连点两下不能把「已全解锁」的假状态当成原始状态存进去
  assert.ok(/getItem\(ST_SEEN_BAK\) === null/.test(body), '备份必须判空，只备份一次');
});

test('剔除后：充值三件套一个不剩', async () => {
  const { stripSelfTest, assertNoSelfTest, SELFTEST_BLOCKS, SELFTEST_RESIDUE } = await strip();
  const { html: out, removed } = stripSelfTest(HTML);
  assert.strictEqual(removed, SELFTEST_BLOCKS, '应剔除全部标记块');
  assert.doesNotMatch(out, SELFTEST_RESIDUE, '剔除后仍能搜到充值记号');
  assert.doesNotThrow(() => assertNoSelfTest(out, 'test'));
  assert.ok(!/grantCoins/.test(out), '剔除后不许还有 grantCoins');
  assert.ok(!/GRANT_AMOUNT/.test(out), '剔除后不许还有充值额度常量');
  assert.ok(!/stGrant/.test(out), '剔除后不许还有充值按钮或它的事件绑定');
});

test('剔除后：面板与 CG 自检必须还在（这是故意上线的，别顺手剔了）', async () => {
  const { stripSelfTest } = await strip();
  const out = stripSelfTest(HTML).html;
  assert.ok(/id="selftest"/.test(out), '面板容器必须保留：线上要靠它检查 CG');
  assert.ok(/id="stCgAll"/.test(out), '「临时解锁全部 CG」按钮必须保留');
  assert.ok(/id="stCgBack"/.test(out), '「还原」按钮必须保留 —— 只给解锁不给还原是陷阱');
  assert.ok(/id="stCgOpen"/.test(out), '「打开剧情图鉴」按钮必须保留');
  assert.ok(/id="stOut"/.test(out), '输出区必须保留，否则按钮点了没有任何反馈');
  assert.ok(/function stCgUnlockAll\(/.test(out) && /function stCgRestore\(/.test(out),
    'CG 自检逻辑必须保留');
  assert.ok(/function syncSelfTestEntry\(/.test(out), '#selftest 入口必须保留，否则面板永远打不开');
  // 面板入口保留 ⇒ 剔除后 DOM 里不能出现引用已删元素的绑定（那会在真页面上抛错）
  const sync = out.slice(out.indexOf('function syncSelfTestEntry('), out.indexOf('syncSelfTestEntry();'));
  assert.ok(!/stGrant/.test(sync), '入口里不许还绑着已被剔除的充值按钮（会 TypeError 整段中断）');
});

test('只删标记块，正常游戏代码毫发无损', async () => {
  const { stripSelfTest } = await strip();
  const out = stripSelfTest(HTML).html;
  assert.ok(/function startGame\(/.test(out), '误删了正常游戏代码');
  assert.ok(/function openStory\(/.test(out), '误删了剧情图鉴');
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

test('core/story.js 的 selftest 判断不受影响（那是跳过剧情 CG，不是充值通道）', () => {
  const story = readFileSync(join(__dirname, 'core/story.js'), 'utf8');
  assert.ok(/shot\|selftest/.test(story),
    'story 的截图 lane 判断被误删了：它与充值面板无关，剔除规则不该一刀切');
});
