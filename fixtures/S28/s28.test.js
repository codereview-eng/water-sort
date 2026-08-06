/* S28 皮肤库存与购买复用（issue #1 场景清单 · K 皮肤系统）
   验收：皮肤购买走既有货币/库存链路（同 S5/S6，道具同源）——无新支付/
   库存代码；皮肤只是库存里的一种新 item 类型。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../core/cosmetics.js');
const P = require('../../core/powerups.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

const invFor = (skinId) => P.create([{ id: skinId, grantOn: [{ trigger: 'purchase', qty: 1 }] }]);

test('S28: mock 游戏 C 金币皮肤 SKU——购买成功/重复被挡/余额不足被挡，全走平台链路', () => {
  const c = C.create(FIX.mockc);
  const inv = invFor('rainbow-dot');
  const wallet = { coins: 12 };
  assert.deepEqual(c.buy('rainbow-dot', wallet, inv), { ok: true });
  assert.equal(wallet.coins, 2, '扣款一次到位');
  assert.equal(inv.count('rainbow-dot'), 1, '皮肤 = 库存新 item 类型（powerups 同一账链）');
  assert.deepEqual(c.buy('rainbow-dot', wallet, inv), { ok: false, reason: 'owned' }, '重复购买被挡');
  assert.deepEqual(c.buy('rainbow-dot', { coins: 1 }, invFor('rainbow-dot')), { ok: false, reason: 'poor' }, '余额不足被挡');
});

test('S28: 账实一致——购买入账进 ledger，可审计（复用 S5 账链断言口径）', () => {
  const c = C.create(FIX.water);
  const inv = invFor('gold-bottle');
  c.buy('gold-bottle', { coins: 99 }, inv);
  const ledger = inv.ledger();
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].source, 'purchase', '皮肤购买与道具购买同一渠道语义');
});

test('S28: water/sudoku 轮换——两款真实游戏皮肤 SKU 同一 buy 入口', () => {
  for (const [id, skin] of [['water', 'gold-bottle'], ['sudoku', 'wood-board']]) {
    const c = C.create(FIX[id]);
    const inv = invFor(skin);
    assert.deepEqual(c.buy(skin, { coins: 100 }, inv), { ok: true }, id);
  }
});

test('S28: 真实游戏 config 皮肤 SKU 落地——price 与 unlock 至少一种获取途径', () => {
  for (const id of ['water', 'sudoku', 'mockc']) {
    const cfg = gameCfg(id).cosmetics;
    for (const item of cfg.catalog) {
      assert.ok(item.price || item.unlock, id + '/' + item.id + ' 有获取途径');
    }
  }
});
