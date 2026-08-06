/* S32 双游戏皮肤/连胜数据不串味（issue #1 场景清单 · M v2 反例边界）
   验收：同端双游戏（S16 复用）——连胜计数与已购皮肤互不污染；storage
   按 tgid + gameId 命名空间；迁移框架复用 S17（单命名空间迁移不影响
   其它命名空间）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../../core/bridge.js');
const K = require('../../core/streak.js');

const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), _m: m };
};

// 命名空间口径：<tgid>:<游戏前缀（config 声明）>——与 S16 host 参数拼接
const hostFor = (storage, tgid, gameId) =>
  B.createWebHost(storage, { storagePrefix: tgid + ':' + gameCfg(gameId).host.storagePrefix });

test('S32: tgid × gameId 四命名空间互不覆盖——连胜计数各归各', () => {
  const storage = memStorage();
  const cells = [];
  for (const tgid of ['42', '77']) {
    for (const gid of ['water', 'sudoku']) {
      const st = B.createSaveStore({ version: 1, defaults: { streak: 0 } }, hostFor(storage, tgid, gid));
      cells.push([tgid, gid, st]);
    }
  }
  // 各自写不同连胜值
  cells.forEach(([tgid, gid, st], i) => st.save({ streak: i + 1 }));
  cells.forEach(([tgid, gid, st], i) => {
    assert.equal(st.load().streak, i + 1, tgid + '/' + gid + ' 读回自己的连胜');
  });
  assert.equal(storage._m.size, 4, '四把 key 零覆盖');
  assert.deepEqual([...storage._m.keys()].sort(), ['42:sudoku:save', '42:water:save', '77:sudoku:save', '77:water:save']);
});

test('S32: 已购皮肤不串味——同一玩家双游戏的皮肤库存互不可见', () => {
  const storage = memStorage();
  const water = B.createSaveStore({ version: 1, defaults: { skins: [] } }, hostFor(storage, '42', 'water'));
  const sudoku = B.createSaveStore({ version: 1, defaults: { skins: [] } }, hostFor(storage, '42', 'sudoku'));
  water.save({ skins: ['gold-bottle'] });
  assert.deepEqual(sudoku.load().skins, [], 'sudoku 看不到 water 的皮肤');
  sudoku.save({ skins: ['wood-board'] });
  assert.deepEqual(water.load().skins, ['gold-bottle'], '反向也不串');
});

test('S32: 连胜状态机实例隔离——mock C 续命不影响真实游戏计数', () => {
  const mc = K.create(gameCfg('mockc').streak);
  const w = K.create(gameCfg('water').streak);
  let mcSt = mc.init(); let wSt = w.init();
  mcSt = mc.win(mcSt).state; mcSt = mc.win(mcSt).state;
  const l = mc.lose(mcSt, 0);
  assert.equal(l.outcome, 'revivable');
  mcSt = mc.freeze(l.state);
  wSt = w.win(wSt).state;
  assert.equal(mcSt.current, 2);
  assert.equal(wSt.current, 1, 'water 计数不受 mock C 事件影响');
});

test('S32: 迁移框架复用 S17——单命名空间 v1→v2 迁移不触碰其它命名空间', () => {
  const storage = memStorage();
  const oldHost = hostFor(storage, '42', 'water');
  oldHost.storageSet('save', JSON.stringify({ v: 1, data: { streak: 9 } }));
  const other = B.createSaveStore({ version: 1, defaults: { streak: 0 } }, hostFor(storage, '42', 'sudoku'));
  other.save({ streak: 3 });
  const migrated = B.createSaveStore({
    version: 2,
    migrations: { 1: (d) => ({ ...d, skins: [] }) },
    defaults: {}
  }, oldHost);
  assert.deepEqual(migrated.load(), { streak: 9, skins: [], __v: 2 }, 'water@42 完成迁移');
  assert.equal(other.load().streak, 3, 'sudoku@42 命名空间原样');
  assert.equal(JSON.parse(storage._m.get('42:sudoku:save')).v, 1, '未迁移方版本戳不变');
});
