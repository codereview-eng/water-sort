/* S7 活动积分口径（issue #1 场景清单 · C 每周活动）
   验收：按通关数/按星数/双周期/不开活动——UTC 周期函数与积分累计复用，
   口径纯 config 切换；不开活动时入口整体消失。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../../core/event.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));
const T14 = 14 * 86400000;

test('S7: 同一 event core，四份 fixture 四种口径', () => {
  const water = E.create(FIX.water);
  const sudoku = E.create(FIX.sudoku);
  const mockc = E.create(FIX.mockc);
  const ev = { cleared: true, stars: 3 };
  assert.equal(water.score(ev), 1, 'A 按通关数计分');
  assert.equal(sudoku.score(ev), 3, 'B 按星数计分');
  assert.equal(water.periodIndex(T14), 2, '单周期');
  assert.equal(mockc.periodIndex(T14), 1, 'C 双周期');
});

test('S7: 不开活动——入口整体消失、活动 API 调用即拒', () => {
  const off = E.create(FIX.off);
  assert.equal(off.active, false);
  assert.equal(off.visible(), false, '活动入口不渲染');
  assert.throws(() => off.score({ cleared: true }), /未开活动/);
});

test('S7: 真实游戏 config 三种口径落地且可加载', () => {
  assert.equal(gameCfg('water').weeklyEvent.metric, 'clears');
  assert.equal(gameCfg('sudoku').weeklyEvent.metric, 'stars');
  assert.equal(gameCfg('mockc').weeklyEvent.period, 'biweekly');
  for (const id of ['water', 'sudoku', 'mockc']) {
    const e = E.create(gameCfg(id).weeklyEvent);
    assert.equal(e.active, true);
  }
});
