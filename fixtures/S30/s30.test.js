/* S30 广告频控复用（issue #1 场景清单 · L 广告位泛化）
   验收：各 placement 独立频控（次数/间隔），复用 S9 的频控语义——频控是
   placement 的属性，不是代码分支。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PL = require('../../core/placements.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));
const DAY = 86400000;

test('S30: 同一游戏内各 placement 频控互相独立', () => {
  const pl = PL.create(FIX.water, () => true);
  let a = {}; let b = {};
  const r1 = pl.show('streak-claim', a, 0); a = r1.state;
  const r2 = pl.show('streak-claim', a, 1); a = r2.state;
  const r3 = pl.show('streak-claim', a, 2); a = r3.state;
  assert.equal(pl.canShow('streak-claim', a, 3), false, '领奖位每日 3 次到顶');
  assert.equal(pl.canShow('pre-level-interstitial', b, 3), true, '插屏位计数不受影响（独立 state key）');
});

test('S30: 间隔与天数上限叠加——复用 S9 的 AND 语义', () => {
  const pl = PL.create(FIX.water, () => true);
  const r1 = pl.show('pre-level-interstitial', {}, 0);
  assert.equal(pl.canShow('pre-level-interstitial', r1.state, 30000), false, '60s 间隔未到');
  assert.equal(pl.canShow('pre-level-interstitial', r1.state, 61000), true);
});

test('S30: mock 游戏 C maxPerSession:1——第二次被拒且入口隐藏；跨日 daily 计数恢复', () => {
  const pl = PL.create(FIX.mockc, () => true);
  const r1 = pl.show('tap-bonus', {}, 0);
  assert.equal(r1.shown, true);
  assert.equal(pl.canShow('tap-bonus', r1.state, 1000), false, '会话内第二次直接隐藏入口');
  assert.deepEqual(pl.show('tap-bonus', r1.state, 1000), { shown: false, granted: false, state: r1.state }, '强行调用也不播');
  const newSession = { ...r1.state, sessionN: 0 };
  assert.equal(pl.canShow('tap-bonus', newSession, DAY + 1), true, '新会话恢复');
});

test('S30: startAfterLevel 门槛——新手保护期不出广告', () => {
  const pl = PL.create(FIX.sudoku, () => true);
  assert.equal(pl.canShow('cosmetic-unlock', { level: 4 }, 0), false);
  assert.equal(pl.canShow('cosmetic-unlock', { level: 5 }, 0), true);
});

test('S30: 真实游戏 config 频控参数落地且三游戏节奏各异', () => {
  const w = gameCfg('water').ads.placements;
  const m = gameCfg('mockc').ads.placements;
  assert.ok(Object.values(w).some((p) => p.capping && p.capping.minIntervalSec), 'water 有间隔频控');
  assert.ok(Object.values(m).every((p) => !p.capping || !p.capping.minIntervalSec), 'mockc 无间隔频控');
  for (const id of ['water', 'sudoku', 'mockc']) PL.create(gameCfg(id).ads.placements, () => true);
});
