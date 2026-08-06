/* 皮肤系统 core 单元测试：谓词/级联/断点/购买 + fail-fast
   （issue #1 · S25–S28 的机制面；场景级断言见 fixtures/S25–S28） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./cosmetics.js');
const P = require('./powerups.js');

const THEMES = { default: { bg: '#fff', piece: 'a.png', sfx: 'pop.mp3' }, neon: { bg: '#0ff', sfx: 'zap.mp3' } };

test('默认配置 = 无此系统', () => {
  const c = C.create(null);
  assert.equal(c.enabled, false);
  assert.throws(() => c.isUnlocked('x', {}), /未配置/);
});

test('S25 机制：统一谓词集——level/ad/currency 复用 S6 框架，streak 同一注册表', () => {
  const c = C.create({
    catalog: [
      { id: 'a', unlock: [{ type: 'level', n: 5 }, { type: 'ad' }] },
      { id: 'b', unlock: [{ type: 'streak', n: 3 }] }
    ]
  }, { streakEnabled: true });
  assert.equal(c.isUnlocked('a', { level: 5, adWatched: true }), true);
  assert.equal(c.isUnlocked('a', { level: 5 }), false, 'AND 语义');
  assert.equal(c.isUnlocked('b', { streak: 2 }), false);
  assert.equal(c.isUnlocked('b', { streak: 3 }), true);
  assert.throws(() => c.isUnlocked('ghost', {}), /未声明 id/);
});

test('S26 机制：token 三层级联——皮肤覆盖 > 主题 > 默认；基准外 token 拒绝', () => {
  const c = C.create({ catalog: [], themes: THEMES });
  assert.deepEqual(c.resolveTokens('neon'), { bg: '#0ff', piece: 'a.png', sfx: 'zap.mp3' });
  assert.deepEqual(c.resolveTokens('neon', { piece: 'b.png' }).piece, 'b.png', '皮肤覆盖优先');
  assert.throws(() => c.resolveTokens('ghost'), /未知主题/);
  assert.throws(() => c.resolveTokens('neon', { shadow: 'x' }), /基准外 token/);
});

test('S27 机制：进度断点查档，纯函数', () => {
  const c = C.create({ catalog: [], themes: THEMES, progressBackgrounds: [{ fromLevel: 10, themeId: 'neon' }] });
  assert.equal(c.themeByProgress(9), 'default');
  assert.equal(c.themeByProgress(10), 'neon');
  assert.throws(() => c.themeByProgress(-1), /必须是 >=0 整数/);
});

test('S28 机制：购买 = wallet.spend + inventory.grant，重复/穷/非卖品全被挡', () => {
  const c = C.create({ catalog: [{ id: 'gold', price: { coins: 10 } }, { id: 'free', unlock: [{ type: 'ad' }] }] });
  const inv = P.create([{ id: 'gold', grantOn: [{ trigger: 'purchase', qty: 1 }] }]);
  const wallet = { coins: 15 };
  assert.deepEqual(c.buy('gold', wallet, inv), { ok: true });
  assert.equal(wallet.coins, 5);
  assert.equal(inv.count('gold'), 1, '入账走 powerups 既有账链');
  assert.deepEqual(c.buy('gold', wallet, inv), { ok: false, reason: 'owned' });
  assert.deepEqual(c.buy('free', wallet, inv), { ok: false, reason: 'not-for-sale' });
  wallet.coins = 3;
  assert.deepEqual(c.buy('gold', { coins: 3 }, P.create([{ id: 'gold' }])), { ok: false, reason: 'poor' });
});

test('fail-fast：未知键/重复 id/双缺/未知谓词/未启用 streak/缺 default/基准外 token/断点非递增/幽灵 themeId/非法 price', () => {
  assert.throws(() => C.create({ skins: [] }), /未知键/);
  assert.throws(() => C.create({ catalog: [{ id: 'a', price: { coins: 1 } }, { id: 'a', price: { coins: 1 } }] }), /重复/);
  assert.throws(() => C.create({ catalog: [{ id: 'a' }] }), /双缺/);
  assert.throws(() => C.create({ catalog: [{ id: 'a', unlock: [{ type: 'vip' }] }] }), /未知 unlock\.type/);
  assert.throws(() => C.create({ catalog: [{ id: 'a', unlock: [{ type: 'streak', n: 3 }] }] }), /未启用 streak/);
  assert.throws(() => C.create({ catalog: [], themes: { neon: { bg: 'x' } } }), /缺 default 主题/);
  assert.throws(() => C.create({ catalog: [], themes: { default: { bg: 'x' }, neon: { shadow: 'y' } } }), /基准外 token/);
  assert.throws(() => C.create({ catalog: [], themes: THEMES, progressBackgrounds: [{ fromLevel: 5, themeId: 'neon' }, { fromLevel: 5, themeId: 'neon' }] }), /严格递增/);
  assert.throws(() => C.create({ catalog: [], themes: THEMES, progressBackgrounds: [{ fromLevel: 5, themeId: 'ghost' }] }), /不存在 themeId/);
  assert.throws(() => C.create({ catalog: [{ id: 'a', price: { gems: 5 } }] }), /引用不存在货币/);
  assert.throws(() => C.create({ catalog: [{ id: 'a', price: { coins: 0 } }] }), /必须是 >0 整数/);
});
