/* S17 存档 schema 版本迁移（issue #1 场景清单 · H 桥接层）
   验收：新游戏声明自己的存档版本与迁移表——storage core 的迁移机制复用；
   迁移表是代码（每步一个函数，机制侧），表本身声明式注册；链断/超前拒载。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../../core/bridge.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};
const host = () => B.createWebHost(memStorage(), {});

// 迁移表 = 游戏侧代码，声明式注册；core 只跑链
const MIGRATIONS = {
  sudoku: { 1: (d) => ({ ...d, noteMode: false }) },
  mockc: { 1: (d) => ({ ...d, combo: 0 }), 2: (d) => ({ ...d, skins: [] }) }
};

test('S17: 三款游戏三个版本声明，同一 core 迁移机制承载', () => {
  const h = host();
  assert.equal(B.createSaveStore({ ...FIX.water }, h).version, 1);
  assert.equal(B.createSaveStore({ ...FIX.sudoku, migrations: MIGRATIONS.sudoku }, h).version, 2);
  assert.equal(B.createSaveStore({ ...FIX.mockc, migrations: MIGRATIONS.mockc }, h).version, 3);
});

test('S17: mock 游戏 C 旧存档 v1 → v3 顺序跑迁移链', () => {
  const h = host();
  h.storageSet('save', JSON.stringify({ v: 1, data: { taps: 7 } }));
  const st = B.createSaveStore({ ...FIX.mockc, migrations: MIGRATIONS.mockc }, h);
  assert.deepEqual(st.load(), { taps: 7, combo: 0, skins: [], __v: 3 });
});

test('S17: 声明 v2 却缺 1→2 迁移函数 → 启动期断言链连续', () => {
  assert.throws(() => B.createSaveStore({ ...FIX.sudoku }, host()), /迁移链断裂/);
});

test('S17: 存档版本超前（回滚场景）→ 显式报错不硬解析', () => {
  const h = host();
  h.storageSet('save', JSON.stringify({ v: 9, data: {} }));
  assert.throws(() => B.createSaveStore({ ...FIX.water }, h).load(), /超前/);
});

test('S17: 真实游戏 config 声明 save.version，落地可加载', () => {
  for (const id of ['water', 'sudoku', 'mockc']) {
    const st = B.createSaveStore({ ...gameCfg(id).save }, host());
    assert.ok(st.version >= 1, id + ' 声明了存档版本');
    st.save({ ok: 1 });
    assert.equal(st.load().ok, 1);
  }
});
