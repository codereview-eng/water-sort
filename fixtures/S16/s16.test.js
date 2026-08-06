/* S16 同一游戏双宿主（issue #1 场景清单 · H 桥接层）
   验收：Telegram Mini App 环境 vs 纯 web 环境——桥接实现按环境配置切换，
   玩法与 core 零改动（同一 Host 合同，同一 save-store 代码跑两宿主）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../../core/bridge.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), _m: m };
};
const mockTelegramEnv = () => ({ Telegram: { WebApp: { initDataUnsafe: { user: { id: 7 } }, CloudStorage: memStorage() } } });

test('S16: 探测按环境切换——mockTelegramEnv → telegram，裸环境 → web', () => {
  assert.equal(B.detectHost(mockTelegramEnv()), 'telegram');
  assert.equal(B.detectHost({}), 'web');
});

test('S16: 双宿主满足同一 Host 合同，core 玩法代码零改动跑两边', () => {
  const env = mockTelegramEnv();
  const hosts = [
    B.createTelegramHost(env.Telegram.WebApp),
    B.createWebHost(memStorage(), FIX.water)
  ];
  for (const host of hosts) {
    B.assertHost(host);
    // 同一段「玩法侧」代码：存档读写走合同，不判宿主
    const st = B.createSaveStore({ version: 1, defaults: { level: 1 } }, host);
    st.save({ level: 5 });
    assert.equal(st.load().level, 5, host.kind + ' 宿主存档回环');
  }
});

test('S16: mock 游戏 C 在两宿主下行为一致（合同测试矩阵）', () => {
  const env = mockTelegramEnv();
  const run = (host) => {
    const st = B.createSaveStore({ version: 1, defaults: { taps: 0 } }, host);
    st.save({ taps: 3 });
    return st.load();
  };
  assert.deepEqual(
    run(B.createTelegramHost(env.Telegram.WebApp)),
    run(B.createWebHost(memStorage(), FIX.mockc)),
    '同输入同输出，宿主差异被桥接层吸收'
  );
});

test('S16: TG 环境缺关键能力 → 显式报错，拒绝静默降级', () => {
  assert.throws(() => B.createTelegramHost({ initDataUnsafe: { user: { id: 1 } } }), /缺关键能力/);
});

test('S16: 真实游戏 config 宿主参数落地——前缀隔离、判定逻辑不进 config', () => {
  const st = memStorage();
  for (const id of ['water', 'sudoku', 'mockc']) {
    const host = B.createWebHost(st, gameCfg(id).host);
    host.storageSet('save', id);
  }
  assert.deepEqual([...st._m.keys()].sort(), ['mockc:save', 'sudoku:save', 'water:save'], '三游戏 key 前缀互不相同');
  for (const id of ['water', 'sudoku', 'mockc']) {
    assert.deepEqual(Object.keys(gameCfg(id).host), ['storagePrefix'], 'config 只有参数、没有判定逻辑');
  }
});
