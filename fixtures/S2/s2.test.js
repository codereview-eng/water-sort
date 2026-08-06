/* S2 看视频奖励翻倍（issue #1 场景清单 · A 奖励结算）
   验收：A 翻 2 倍；B 翻 3 倍且每日上限 5 次；C 不开——上限、倍率、开关全由
   config 生效，C 中入口不渲染（adVisible=false）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../core/settle.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));
const NOW = 86400000 * 200;

test('S2: A 翻 2 倍', () => {
  const a = S.create(FIX.water);
  assert.equal(a.adVisible(), true);
  assert.equal(a.adApply(10, {}, NOW).coins, 20);
});

test('S2: B 翻 3 倍 + 每日上限 5 次（UTC 次日归零）', () => {
  const b = S.create(FIX.sudoku);
  let st = {};
  for (let i = 0; i < 5; i++) {
    const r = b.adApply(10, st, NOW + i);
    assert.equal(r.coins, 30);
    st = r.state;
  }
  assert.equal(b.adAvailable(st, NOW + 99), false, '第 6 次被上限拦住');
  assert.equal(b.adAvailable(st, NOW + 86400000), true, 'UTC 次日额度恢复');
});

test('S2: C 关闭——入口不渲染、调用即拒', () => {
  const c = S.create(FIX.mockc);
  assert.equal(c.adVisible(), false, 'C 中入口不渲染');
  assert.equal(c.adAvailable({}, NOW), false);
  assert.throws(() => c.adApply(10, {}, NOW), /不可用/);
});

test('S2: 真实游戏 config 同口径（water ×2 / sudoku ×3+cap5 / mockc off）', () => {
  assert.equal(gameCfg('water').settle.adBonus.multiplier, 2);
  assert.deepEqual(
    [gameCfg('sudoku').settle.adBonus.multiplier, gameCfg('sudoku').settle.adBonus.dailyCap],
    [3, 5]
  );
  assert.equal(gameCfg('mockc').settle.adBonus.enabled, false);
  assert.equal(S.create(gameCfg('mockc').settle).adVisible(), false);
});
