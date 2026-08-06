/* S18 反例硬闸：新游戏接入 diff 只允许落 games/<id>/（issue #1 场景清单 · I）
   验收：CI diff 闸——机制为纯函数（可测），CLI 包装 git diff；触碰 core/、
   页面或其它游戏目录即违规。历史实证：mock 游戏 C 接入 diff = 1 个 json。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const gate = () => import('../../scripts/diff-gate.mjs');

test('S18: 纯 config 接入通过——mock C 的历史 diff 形态（只有 games/mockc/）', async () => {
  const { violations } = await gate();
  assert.deepEqual(violations(['games/mockc/game.config.json'], 'mockc'), []);
  assert.deepEqual(violations(['games/mockc/game.config.json', 'games/mockc/assets/icon.png'], 'mockc'), []);
});

test('S18: 越界即违规——碰 core/、页面、其它游戏目录全部点名', async () => {
  const { violations } = await gate();
  assert.deepEqual(
    violations(['games/mockc/game.config.json', 'core/reward.js', 'water.html', 'games/water/game.config.json'], 'mockc'),
    ['core/reward.js', 'water.html', 'games/water/game.config.json']
  );
});

test('S18: 相似前缀不放行（games/mockc2/ 不属于 mockc）', async () => {
  const { violations } = await gate();
  assert.deepEqual(violations(['games/mockc2/game.config.json'], 'mockc'), ['games/mockc2/game.config.json']);
});

test('S18: 非法输入 fail-fast——非数组/非法游戏 id', async () => {
  const { violations } = await gate();
  assert.throws(() => violations('x', 'mockc'), /必须是数组/);
  assert.throws(() => violations([], 'Mock C'), /非法游戏 id/);
});

test('S18: CLI 包装可执行——空 diff（HEAD...HEAD）通过 rc=0', () => {
  const out = execFileSync('node', [path.join(__dirname, '..', '..', 'scripts', 'diff-gate.mjs'), '--game', 'mockc', '--base', 'HEAD', '--head', 'HEAD'], { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') });
  assert.match(out, /diff 闸通过/);
});
