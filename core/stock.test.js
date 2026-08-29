'use strict';
/* core/stock.js 单测：消耗品单调账本（granted/spent 只增） + 对照证明旧「库存数按时间戳取新」模型会复活已用道具 */
const test = require('node:test');
const assert = require('node:assert');
const Stock = require('./stock.js');
const Platform = require('./platform.js');

const CFG = {
  items: {
    toolMine: { granted: 'toolMineGranted', spent: 'toolMineSpent', legacy: 'toolMine', initial: 2 },
    toolSafe: { granted: 'toolSafeGranted', spent: 'toolSafeSpent', legacy: 'toolSafe', initial: 2 }
  }
};

function apply(save, patch) { return Object.assign({}, save, patch || {}); }

test('config fail-fast：空 items / 缺字段 / 字段重名 / 非法 initial', () => {
  assert.throws(() => Stock.create(null), /必须是对象/);
  assert.throws(() => Stock.create({ items: {} }), /非空对象/);
  assert.throws(() => Stock.create({ items: { a: { granted: 'g' } } }), /spent 必须是非空字符串/);
  assert.throws(() => Stock.create({ items: { a: { granted: 'x', spent: 'x' } } }), /重复占用|不能同名/);
  assert.throws(() => Stock.create({ items: { a: { granted: 'g', spent: 's' }, b: { granted: 'g', spent: 's2' } } }), /重复占用/);
  assert.throws(() => Stock.create({ items: { a: { granted: 'g', spent: 's', initial: -1 } } }), /initial/);
});

test('新玩家：migrate 给出初始赠送，库存 = initial', () => {
  const S = Stock.create(CFG);
  const save = apply({}, S.migrate({}));
  assert.strictEqual(S.stock(save, 'toolMine'), 2);
  assert.strictEqual(S.total(save), 4, '首页「道具」应是 2+2=4');
  assert.deepStrictEqual(S.all(save), { toolMine: 2, toolSafe: 2 });
  assert.strictEqual(save.toolMineGranted, 2);
  assert.strictEqual(save.toolMineSpent, 0);
});

test('migrate 幂等：跑两次不会重复发道具', () => {
  const S = Stock.create(CFG);
  let save = apply({}, S.migrate({}));
  save = apply(save, S.spend(save, 'toolMine'));
  save = apply(save, S.migrate(save));
  assert.strictEqual(S.stock(save, 'toolMine'), 1, '再次 migrate 不得把已用的道具补回来');
});

test('用一个就少一个：spend 减库存、spent 只增；库存 0 时 spend 返回 null', () => {
  const S = Stock.create(CFG);
  let save = apply({}, S.migrate({}));
  save = apply(save, S.spend(save, 'toolMine'));
  assert.strictEqual(S.stock(save, 'toolMine'), 1);
  assert.strictEqual(save.toolMineSpent, 1);
  save = apply(save, S.spend(save, 'toolMine'));
  assert.strictEqual(S.stock(save, 'toolMine'), 0);
  assert.strictEqual(S.spend(save, 'toolMine'), null, '没库存必须返回 null，交给「看广告补充」');
  assert.strictEqual(save.toolMineSpent, 2, 'spent 不会因为失败的消耗而变化');
});

test('看广告补充：grant 只增 granted，库存回升', () => {
  const S = Stock.create(CFG);
  let save = apply({}, S.migrate({}));
  save = apply(save, S.spend(save, 'toolMine', 2));
  assert.strictEqual(S.stock(save, 'toolMine'), 0);
  save = apply(save, S.grant(save, 'toolMine', 1));
  assert.strictEqual(S.stock(save, 'toolMine'), 1);
  assert.strictEqual(save.toolMineGranted, 3);
  assert.strictEqual(S.grant(save, 'toolMine', 0), null);
});

test('旧档迁移：老版本只有库存数，剩多少留多少（不清零也不补满）', () => {
  const S = Stock.create(CFG);
  const old = { toolMine: 1, toolSafe: 0, level: 7 };
  const save = apply(old, S.migrate(old));
  assert.strictEqual(S.stock(save, 'toolMine'), 1);
  assert.strictEqual(S.stock(save, 'toolSafe'), 0, '老档里已用光的道具不得被 initial 补回来');
});

test('legacyPatch：把派生库存同步回旧字段，供未升级的旧客户端读', () => {
  const S = Stock.create(CFG);
  let save = apply({}, S.migrate({}));
  save = apply(save, S.spend(save, 'toolSafe'));
  assert.deepStrictEqual(S.legacyPatch(save), { toolMine: 2, toolSafe: 1 });
});

/* ---------- 回归：本次线上 bug（用了道具，重新登录又变回默认 4 个） ---------- */

const NEWEST_CFG = {
  entity: 'Save',
  fields: {
    toolMine: { col: 'tool_mine', merge: 'newest' },
    toolSafe: { col: 'tool_safe', merge: 'newest' }
  }
};
const MONOTONIC_CFG = {
  entity: 'Save',
  fields: {
    toolMineGranted: { col: 'tool_mine_granted', merge: 'max' },
    toolMineSpent: { col: 'tool_mine_spent', merge: 'max' },
    toolSafeGranted: { col: 'tool_safe_granted', merge: 'max' },
    toolSafeSpent: { col: 'tool_safe_spent', merge: 'max' }
  }
};

test('对照（旧模型有病）：本地拿着默认库存做一次无关写入，就把云端已扣减的道具复活了', () => {
  const P = Platform.create(NEWEST_CFG);
  // 云端是正确的：玩家已经用掉 1 个（另一台设备/上一次会话写上去的）
  const cloud = { tool_mine: 1, tool_safe: 2, updated_ms: 1000 };
  // 本地这一份还是默认 2/2，但因为体力恢复/昵称/音效等无关写入，updatedMs 被刷成更新
  const local = { toolMine: 2, toolSafe: 2, updatedMs: 2000 };
  const merged = P.mergeSave(local, cloud, { localFresh: false }).save;
  assert.strictEqual(merged.toolMine, 2, '这就是 bug 现场：已消耗的道具被复活成默认值');
});

test('新模型：同样场景下，已消耗的道具不会被任何一端复活', () => {
  const P = Platform.create(MONOTONIC_CFG);
  const S = Stock.create(CFG);
  const cloud = { tool_mine_granted: 2, tool_mine_spent: 1, tool_safe_granted: 2, tool_safe_spent: 0, updated_ms: 1000 };
  const local = { toolMineGranted: 2, toolMineSpent: 0, toolSafeGranted: 2, toolSafeSpent: 0, updatedMs: 2000 };
  const merged = P.mergeSave(local, cloud, { localFresh: false }).save;
  assert.strictEqual(S.stock(merged, 'toolMine'), 1, '本地时间戳再新，也不能把 spent 退回去');
  assert.strictEqual(S.total(merged), 3);
});

test('新模型：localFresh（换设备刚开就登录）也不会抹掉本地离线获得的道具', () => {
  const P = Platform.create(MONOTONIC_CFG);
  const S = Stock.create(CFG);
  const cloud = { tool_mine_granted: 2, tool_mine_spent: 2, tool_safe_granted: 2, tool_safe_spent: 0, updated_ms: 5000 };
  // 本地离线看广告补了 1 个（granted 3），但还没同步上去
  const local = { toolMineGranted: 3, toolMineSpent: 2, toolSafeGranted: 2, toolSafeSpent: 0, updatedMs: 100 };
  const merged = P.mergeSave(local, cloud, { localFresh: true }).save;
  assert.strictEqual(S.stock(merged, 'toolMine'), 1, 'granted 取大：离线补的道具留住');
  assert.strictEqual(merged.toolMineSpent, 2, 'spent 取大：已消耗的照样算数');
});

test('新模型：双向同步 —— 两端各消耗一次，合并后总消耗取大而不是互相覆盖', () => {
  const P = Platform.create(MONOTONIC_CFG);
  const S = Stock.create(CFG);
  const cloud = { tool_mine_granted: 5, tool_mine_spent: 3, tool_safe_granted: 2, tool_safe_spent: 1, updated_ms: 10 };
  const local = { toolMineGranted: 5, toolMineSpent: 2, toolSafeGranted: 2, toolSafeSpent: 2, updatedMs: 20 };
  const merged = P.mergeSave(local, cloud, { localFresh: false }).save;
  assert.strictEqual(S.stock(merged, 'toolMine'), 2);
  assert.strictEqual(S.stock(merged, 'toolSafe'), 0);
  assert.strictEqual(P.mergeSave(local, cloud, { localFresh: false }).dirtyCloud, true, '本地更高的 spent 需要回写云端');
});

/* ---- 多标签页覆盖（2026-08-20 线上实测复现：买道具后刷新金币复活）----
   场景：同一浏览器两个标签页各持一个 save 对象。
   A 花掉 200 金币写盘；B 手里还是买之前的快照，它下一次写盘（首页体力每秒结算就会触发）
   会把整份旧存档覆盖回磁盘 —— 已消耗的金币凭空复活。
   修法：写盘前用 reconcile 与磁盘现值把「只增账本」取大（与云端 merge:"max" 同一语义）。 */
const COIN_CFG = {
  items: {
    coins: { granted: 'coinsEarned', spent: 'coinsSpent', initial: 0 },
    toolMine: { granted: 'toolMineGranted', spent: 'toolMineSpent', legacy: 'toolMine', initial: 2 }
  }
};

test('对照：不做 reconcile 时，旧标签页的快照会把已花掉的金币写回去（这就是那个 bug）', () => {
  const S = Stock.create(COIN_CFG);
  const seed = { coinsEarned: 500 };
  const base = apply(seed, S.migrate(seed));          // migrate 只补缺失字段，入参要自己带上
  // A 标签页：花 200 买一个道具（金币 spent+200、道具 granted+1）
  const afterBuy = apply(base, {
    coinsSpent: (base.coinsSpent || 0) + 200,
    toolMineGranted: (base.toolMineGranted || 0) + 1
  });
  assert.strictEqual(S.stock(afterBuy, 'coins'), 300, 'A 侧余额应为 300');
  // B 标签页：手里是 base（买之前），直接整份写盘 = 覆盖
  const naiveDiskWrite = Object.assign({}, base);
  assert.strictEqual(S.stock(naiveDiskWrite, 'coins'), 500, '旧写盘方式让 500 金币复活（bug 现场）');
});

test('reconcile：旧标签页写盘时与磁盘取大，已消耗的金币/道具不会复活', () => {
  const S = Stock.create(COIN_CFG);
  const seed = { coinsEarned: 500 };
  const base = apply(seed, S.migrate(seed));
  const onDisk = apply(base, { coinsSpent: 200, toolMineGranted: 3, toolMineSpent: 1 });  // A 已写盘
  // B 用过期快照写盘前，先 reconcile
  const patch = S.reconcile(base, onDisk);
  const safeWrite = apply(base, patch);
  assert.strictEqual(safeWrite.coinsSpent, 200, '消耗被保住');
  assert.strictEqual(safeWrite.toolMineGranted, 3, '发放被保住');
  assert.strictEqual(safeWrite.toolMineSpent, 1, '道具消耗被保住');
  assert.strictEqual(S.stock(safeWrite, 'coins'), 300, '余额仍是 300，没有复活');
});

test('reconcile：反向也不丢 —— 本地比磁盘新时保留本地值（取大，不是无脑覆盖）', () => {
  const S = Stock.create(COIN_CFG);
  const mine = { coinsEarned: 500, coinsSpent: 400, toolMineGranted: 5, toolMineSpent: 2 };
  const older = { coinsEarned: 500, coinsSpent: 200, toolMineGranted: 3, toolMineSpent: 1 };
  const patch = S.reconcile(mine, older);
  assert.deepStrictEqual(patch, {}, '本地更新时不产生任何回退补丁');
  assert.strictEqual(S.stock(apply(mine, patch), 'coins'), 100);
});

test('reconcile：只碰账本字段，不动 level/energy 这类非单调字段', () => {
  const S = Stock.create(COIN_CFG);
  const mine = { coinsEarned: 500, coinsSpent: 0, level: 9, energy: 30 };
  const onDisk = { coinsEarned: 500, coinsSpent: 200, level: 1, energy: 120 };
  const patch = S.reconcile(mine, onDisk);
  assert.deepStrictEqual(Object.keys(patch).sort(), ['coinsSpent'], '只应回填 coinsSpent');
  assert.strictEqual(patch.level, undefined, 'level 不该被 reconcile 碰');
  assert.strictEqual(patch.energy, undefined, 'energy 不该被 reconcile 碰');
});

test('reconcile：磁盘为空/首次写盘时安全返回空补丁', () => {
  const S = Stock.create(COIN_CFG);
  assert.deepStrictEqual(S.reconcile({ coinsSpent: 5 }, null), {});
  assert.deepStrictEqual(S.reconcile({ coinsSpent: 5 }, {}), {}, '磁盘无账本字段时不回退');
});

/* ---- 物理上限 audit（issue #1 · 广告奖励可信度 3/4）----
   背景：只增账本 + max 合并让**被篡改的数字不可回收**。实测把 toolMineGranted 改成
   99999 再同步一次，正常值就再也顶不回去了。audit 不是"检测作弊"（客户端做不到），
   是限损：削平到按游戏规则物理上可能的量，并留下可查的异常记录。 */
const ceilCfg = {
  ceiling: { safety: 3, perDay: { toolMine: 60 } },
  items: {
    toolMine: { granted: 'g', spent: 's', initial: 2 },
    toolSafe: { granted: 'g2', spent: 's2', initial: 2 }
  }
};

test('audit：没配 ceiling 的游戏行为完全不变（向后兼容）', () => {
  const S = Stock.create({ items: { a: { granted: 'ag', spent: 'as' } } });
  assert.deepStrictEqual(S.audit({ ag: 999999 }, 1), { patch: {}, anomalies: [], unknownAge: false });
  assert.strictEqual(S.ceiling('a', 5), null);
});

test('audit：正常玩家一个字段都不动', () => {
  const S = Stock.create(ceilCfg);
  assert.deepStrictEqual(S.audit({ g: 7, s: 3 }, 3), { patch: {}, anomalies: [], unknownAge: false });
});

test('audit：新账号第 0 天也有整整一天的额度，不能把首日正常获得判成异常', () => {
  const S = Stock.create(ceilCfg);
  assert.strictEqual(S.ceiling('toolMine', 0), 2 + 1 * 60 * 3);
  assert.deepStrictEqual(S.audit({ g: 100 }, 0).anomalies, []);
});

test('audit：控制台改出来的 99999 被削平，并留下能追查的明细', () => {
  const S = Stock.create(ceilCfg);
  const r = S.audit({ g: 99999, s: 3 }, 3);
  const cap = 2 + 4 * 60 * 3;
  assert.deepStrictEqual(r.patch, { g: cap });
  assert.deepStrictEqual(r.anomalies, [{ key: 'toolMine', field: 'g', claimed: 99999, cap: cap, ageDays: 3 }]);
});

test('audit：天数不可信时不 clamp，但要把这条路走了多少次标出来', () => {
  const S = Stock.create(ceilCfg);
  /* 本地时钟是玩家的，拿它当证据等于自欺欺人；宁可不削，也不能凭假证据削真玩家。 */
  assert.deepStrictEqual(S.audit({ g: 99999 }, null), { patch: {}, anomalies: [], unknownAge: true });
  assert.strictEqual(S.audit({ g: 99999 }, undefined).unknownAge, true);
});

test('audit：没配上限的道具不受影响（只削声明过的）', () => {
  const S = Stock.create(ceilCfg);
  assert.deepStrictEqual(S.audit({ g2: 99999 }, 3).patch, {});
});

test('ceiling 配置 fail-fast', () => {
  assert.throws(() => Stock.create({ ceiling: { perDay: { nope: 1 } }, items: { a: { granted: 'g', spent: 's' } } }),
    /不是已声明的道具/);
  assert.throws(() => Stock.create({ ceiling: { perDay: { a: -1 } }, items: { a: { granted: 'g', spent: 's' } } }),
    /必须是非负数/);
  assert.throws(() => Stock.create({ ceiling: { perDay: { a: 1 }, safety: 0.5 }, items: { a: { granted: 'g', spent: 's' } } }),
    /safety/);
  assert.throws(() => Stock.create({ ceiling: {}, items: { a: { granted: 'g', spent: 's' } } }), /perDay/);
});
