/* S23 连胜排行榜（issue #1 场景清单 · J 连胜系统）
   验收：A 按当前连胜；B 按历史最高；C 周期重置周榜——lb core 复用
   （S11 的 createRank），连胜只是榜的一个新维度（新 config 条目），
   无新榜代码；streak core 只产出 current/best 数字。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../../core/streak.js');
const Stats = require('../../core/stats.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));
const WEEK = 7 * 86400000;

const mk = (c) => Stats.createRank(c.leaderboards, c.lifetimeStats.map((s) => s.key));

// streak core 产数字 → 事件 → 榜提交（三段全是既有机制拼接）
const streakOf = (wins) => {
  const s = K.create({ enabled: true, claimMode: 'direct', tiers: [] });
  let st = s.init();
  for (let i = 0; i < wins; i++) st = s.win(st).state;
  return st;
};

test('S23: A 当前连胜榜——current 数字直接进 rank，无新榜代码', () => {
  const rk = mk(FIX.water);
  rk.submit('streak_now', 'p1', streakOf(4).current);
  rk.submit('streak_now', 'p2', streakOf(7).current);
  assert.deepEqual(rk.standings('streak_now')[0], { player: 'p2', value: 7 });
});

test('S23: B 历史最高榜——best 维度纯 config 切换', () => {
  const rk = mk(FIX.sudoku);
  const s = K.create({ enabled: true, claimMode: 'direct', tiers: [] });
  let st = s.init();
  for (let i = 0; i < 5; i++) st = s.win(st).state;
  st = s.lose(st, 0).state; // 清零但 best 保留
  rk.submit('streak_best', 'p1', st.best);
  assert.deepEqual(rk.standings('streak_best'), [{ player: 'p1', value: 5 }], '清零后 best 仍上榜');
});

test('S23: mock 游戏 C 周榜——复用 S7 的周期语义，翻周清零', () => {
  const rk = mk(FIX.mockc);
  rk.submit('streak_weekly', 'p1', 6, 0);
  assert.deepEqual(rk.standings('streak_weekly', 0), [{ player: 'p1', value: 6 }]);
  assert.deepEqual(rk.standings('streak_weekly', WEEK + 1), [], '新周新榜');
});

test('S23: 档案声明式承接 streak 事件——同一 archive core，零新代码', () => {
  const ar = Stats.createArchive(FIX.sudoku.lifetimeStats);
  ar.onEvent('streak_changed', { best: 3 });
  ar.onEvent('streak_changed', { best: 9 });
  ar.onEvent('streak_changed', { best: 5 });
  assert.equal(ar.get('best_streak'), 9);
});

test('S23: 真实游戏 config 三种连胜榜维度落地且可加载', () => {
  assert.equal(gameCfg('water').leaderboards.find((b) => b.id === 'streak_now').metric, 'current_streak');
  assert.equal(gameCfg('sudoku').leaderboards.find((b) => b.id === 'streak_best').metric, 'best_streak');
  assert.equal(gameCfg('mockc').leaderboards.find((b) => b.id === 'streak_weekly').period, 'weekly');
  for (const id of ['water', 'sudoku', 'mockc']) {
    const cfg = gameCfg(id);
    Stats.createRank(cfg.leaderboards, cfg.lifetimeStats.map((s) => s.key));
  }
});
