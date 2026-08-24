'use strict';
/* mine-engine.test.js —— 彩色扫雷引擎单测:确定性/规则约束/解唯一/道具纯函数 */
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('./mine-engine.js');

function chebyshev(size, a, b) {
  const ar = (a / size) | 0, ac = a % size;
  const br = (b / size) | 0, bc = b % size;
  return Math.max(Math.abs(ar - br), Math.abs(ac - bc));
}

test('rng: 同 seed 同序列,不同 seed 不同序列', () => {
  const a = E.rng(42), b = E.rng(42), c = E.rng(43);
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepStrictEqual(sa, sb);
  assert.notDeepStrictEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('generate: 不支持的尺寸直接抛错(fail-closed)', () => {
  assert.throws(() => E.generate(6, 1));
});

for (const size of E.SIZES) {
  test(`generate ${size}x${size}: 满足全部规则且解唯一`, () => {
    const b = E.generate(size, 12345);
    assert.ok(b, 'generate 不应返回 null');
    assert.strictEqual(b.size, size);
    // 每行一雷(mines 即每行列号) + 每列一雷(列排列)
    assert.strictEqual(b.mines.length, size);
    assert.deepStrictEqual(Array.from(new Set(b.mines)).sort((x, y) => x - y),
      Array.from({ length: size }, (_, i) => i));
    // 雷不相邻:任意两雷切比雪夫距离 >= 2
    const idx = E.mineIndexes(b);
    for (let i = 0; i < idx.length; i++) {
      for (let j = i + 1; j < idx.length; j++) {
        assert.ok(chebyshev(size, idx[i], idx[j]) >= 2, `雷 ${idx[i]} 与 ${idx[j]} 相邻`);
      }
    }
    // 色块:全覆盖、恰 N 色、每色连通、每色恰一雷
    assert.strictEqual(b.region.length, size * size);
    const counts = new Array(size).fill(0);
    for (const id of b.region) {
      assert.ok(id >= 0 && id < size, '色块 id 越界');
      counts[id]++;
    }
    for (const c of counts) assert.ok(c >= 1);
    assert.ok(E.regionsConnected(size, b.region), '存在不连通的色块');
    const perRegion = new Array(size).fill(0);
    for (const i of idx) perRegion[b.region[i]]++;
    assert.deepStrictEqual(perRegion, new Array(size).fill(1));
    // 解唯一
    assert.strictEqual(E.countSolutions(size, b.region, 3), 1);
  });

  test(`generate ${size}x${size}: 同 seed 确定性`, () => {
    assert.deepStrictEqual(E.generate(size, 777), E.generate(size, 777));
  });
}

test('pickUnfoundMine: 只从未找到的雷里挑,找完返回 -1', () => {
  const b = E.generate(5, 99);
  const all = E.mineIndexes(b);
  const rand = E.rng(1);
  const got = E.pickUnfoundMine(b, all.slice(0, 4), rand);
  assert.strictEqual(got, all[4]);
  assert.strictEqual(E.pickUnfoundMine(b, all, rand), -1);
});

test('pickUnfoundMine: 接受页面运行时使用的 Set', () => {
  const b = E.generate(5, 99);
  const all = E.mineIndexes(b);
  assert.strictEqual(E.pickUnfoundMine(b, new Set(all.slice(0, 4))), all[4]);
  assert.strictEqual(E.pickUnfoundMine(b, new Set(all)), -1);
});

test('pickSafeCell: 只挑非雷且未排除的格子,挑光返回 -1', () => {
  const b = E.generate(5, 99);
  const mines = new Set(E.mineIndexes(b));
  const rand = E.rng(2);
  const got = E.pickSafeCell(b, [], rand);
  assert.ok(got >= 0 && !mines.has(got));
  const allSafe = [];
  for (let i = 0; i < 25; i++) if (!mines.has(i)) allSafe.push(i);
  assert.strictEqual(E.pickSafeCell(b, allSafe, rand), -1);
  const leftOne = allSafe.slice(1);
  assert.strictEqual(E.pickSafeCell(b, leftOne, rand), allSafe[0]);
});

test('pickSafeCell: 接受页面运行时使用的 Set', () => {
  const b = E.generate(5, 99);
  const mines = new Set(E.mineIndexes(b));
  const allSafe = [];
  for (let i = 0; i < 25; i++) if (!mines.has(i)) allSafe.push(i);
  assert.strictEqual(E.pickSafeCell(b, new Set(allSafe)), -1);
  assert.strictEqual(E.pickSafeCell(b, new Set(allSafe.slice(1))), allSafe[0]);
});
