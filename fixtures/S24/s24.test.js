/* S24 连胜奖励内容差异（issue #1 场景清单 · J 连胜系统）
   验收：发金币／发道具／发皮肤——streak core 只发「奖励描述符」（type +
   id/amount，按 id 引用目录），不认识奖励内容；发放走统一 grant 管线
   （道具=powerups.grant，皮肤=cosmetics 目录，K 组联动）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../../core/streak.js');
const P = require('../../core/powerups.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

const winN = (s, n) => {
  let st = s.init(); let rewards = [];
  for (let i = 0; i < n; i++) { const r = s.win(st); st = r.state; rewards = rewards.concat(r.rewards); }
  return rewards;
};

test('S24: 三份 config 三种奖励内容，core 只透传描述符', () => {
  assert.deepEqual(winN(K.create(FIX.water), 3)[0].reward, { type: 'coins', amount: 30 });
  assert.deepEqual(winN(K.create(FIX.sudoku), 3)[0].reward, { type: 'item', id: 'hint', amount: 2 });
  const c = winN(K.create(FIX.mockc), 6);
  assert.deepEqual(c.map((r) => r.reward.type), ['coins', 'cosmetic'], 'mock C 两档两种内容');
});

test('S24: 道具奖励接统一 grant 管线——描述符 id 直接入 powerups 账链', () => {
  const pu = P.create(gameCfg('sudoku').powerups);
  const [hit] = winN(K.create(FIX.sudoku), 3);
  pu.grant(hit.reward.id, hit.reward.amount, 'manual');
  assert.equal(pu.count('hint'), 2, 'streak 发放走既有入账代码，零新渠道逻辑');
});

test('S24: 描述符按 id 引用目录——未声明道具 id 在 grant 时被硬闸拦下', () => {
  const pu = P.create(gameCfg('water').powerups);
  const bad = { type: 'item', id: 'ghost-item', amount: 1 };
  assert.throws(() => pu.grant(bad.id, bad.amount, 'manual'), /未声明/, '引用不存在 id 无法入账（对照 S31 纪律）');
});

test('S24: mock 游戏 C 只配金币也能发奖——不引入皮肤/道具代码', () => {
  const rewards = winN(K.create({ enabled: true, claimMode: 'direct', tiers: [{ streak: 3, reward: { type: 'coins', amount: 5 } }] }), 3);
  assert.deepEqual(rewards[0].reward, { type: 'coins', amount: 5 });
});

test('S24: 真实游戏 config 奖励内容差异化落地', () => {
  assert.equal(gameCfg('water').streak.tiers[0].reward.type, 'coins');
  assert.equal(gameCfg('sudoku').streak.tiers[0].reward.type, 'item');
});
