/* S11 排行维度声明式（issue #1 场景清单 · E 排行与档案）
   验收：A 按最短用时（升序）；B 按分数（降序）；C 按周积分——排序方向、
   字段、榜单周期全配置，比较器由 order 生成、core 不认识具体 metric。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../core/stats.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));
const mk = (c) => S.createRank(c.leaderboards, c.lifetimeStats.map((s) => s.key));

test('S11: A 用时升序——best 保最短，榜首是最快的人', () => {
  const rk = mk(FIX.water);
  rk.submit('fastest', 'a', 120000); rk.submit('fastest', 'a', 90000);
  rk.submit('fastest', 'b', 100000);
  assert.deepEqual(rk.standings('fastest').map((e) => e.player), ['a', 'b']);
});

test('S11: B 分数降序——同一 core，方向翻转纯配置', () => {
  const rk = mk(FIX.sudoku);
  rk.submit('top_score', 'a', 800); rk.submit('top_score', 'b', 950); rk.submit('top_score', 'b', 700);
  assert.deepEqual(rk.standings('top_score'), [{ player: 'b', value: 950 }, { player: 'a', value: 800 }]);
});

test('S11: mock 游戏 C 周积分榜——increment 累计 + 周期翻转清零', () => {
  const WEEK = 7 * 86400000;
  const rk = mk(FIX.mockc);
  rk.submit('weekly', 'p1', 5, 0); rk.submit('weekly', 'p1', 4, 1000); rk.submit('weekly', 'p2', 7, 2000);
  assert.deepEqual(rk.standings('weekly', 3000)[0], { player: 'p1', value: 9 });
  assert.deepEqual(rk.standings('weekly', WEEK + 1), [], '新周期新榜');
});

test('S11: metric 不在已声明统计项集合内 → 加载期拒绝', () => {
  assert.throws(() => S.createRank(FIX.water.leaderboards, ['other_stat']), /不在已声明统计项集合内/);
});

test('S11: 真实游戏 config 三种排行维度落地且可加载', () => {
  for (const id of ['water', 'sudoku', 'mockc']) {
    const cfg = gameCfg(id);
    const rk = S.createRank(cfg.leaderboards, cfg.lifetimeStats.map((s) => s.key));
    assert.ok(rk.ids().length >= 1, id + ' 至少声明一个榜');
  }
  assert.equal(gameCfg('water').leaderboards[0].order, 'asc');
  assert.equal(gameCfg('sudoku').leaderboards[0].order, 'desc');
  assert.equal(gameCfg('mockc').leaderboards[0].period, 'weekly');
});
