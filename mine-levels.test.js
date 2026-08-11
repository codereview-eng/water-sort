'use strict';
/* mine-levels.test.js —— 扫雷关卡表单测:难度曲线/时限规则/逐关可生成且解唯一 */
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('./mine-levels.js');
const E = require('./mine-engine.js');

test('spec: 尺寸爬坡 5→7→9,10 关起进入波动循环且只出现合法尺寸', () => {
  assert.strictEqual(L.spec(1).size, 5);
  assert.strictEqual(L.spec(2).size, 5);
  assert.strictEqual(L.spec(3).size, 7);
  assert.strictEqual(L.spec(5).size, 7);
  assert.strictEqual(L.spec(6).size, 9);
  assert.strictEqual(L.spec(9).size, 9);
  // 波动段:10 关起按 WAVE 周期取尺寸,几盘 11×11 后夹 9×9/7×7 喘息关
  assert.deepStrictEqual(L.WAVE, [11, 11, 11, 9, 11, 11, 7]);
  assert.strictEqual(L.spec(10).size, 11);
  assert.strictEqual(L.spec(13).size, 9);
  assert.strictEqual(L.spec(16).size, 7);
  assert.strictEqual(L.spec(17).size, 11);   // 新一轮周期
  for (let lv = 10; lv <= 60; lv++) {
    assert.strictEqual(L.spec(lv).size, L.WAVE[(lv - 10) % L.WAVE.length]);
  }
  for (let lv = 1; lv <= 60; lv++) {
    assert.ok(E.SIZES.includes(L.spec(lv).size));
  }
  // 波动段确实有回落(喘息),不再是单调稳态
  assert.ok(L.spec(13).size < L.spec(12).size);
});

test('spec: 前 3 关不限时,之后逐关收紧且不低于基准一半', () => {
  for (let lv = 1; lv <= L.FREE_LEVELS; lv++) assert.strictEqual(L.spec(lv).timeLimit, null);
  for (let lv = L.FREE_LEVELS + 1; lv <= 60; lv++) {
    const s = L.spec(lv);
    assert.ok(Number.isInteger(s.timeLimit) && s.timeLimit > 0);
    assert.ok(s.timeLimit <= L.BASE_TIME[s.size]);
    assert.ok(s.timeLimit >= Math.round(L.BASE_TIME[s.size] / 2));
  }
  // 同尺寸段内单调不增
  assert.ok(L.spec(5).timeLimit <= L.spec(4).timeLimit);
  assert.ok(L.spec(12).timeLimit <= L.spec(11).timeLimit);
});

test('spec: 每关 3 血,非法输入回落到第 1 关', () => {
  assert.strictEqual(L.spec(7).lives, 3);
  assert.strictEqual(L.spec(0).level, 1);
  assert.strictEqual(L.spec(NaN).level, 1);
});

test('get: 1..40 关全部可生成、确定性、盘面与规格一致且解唯一', () => {
  for (let lv = 1; lv <= 40; lv++) {
    const a = L.get(lv);
    assert.ok(a, `第 ${lv} 关生成失败`);
    assert.strictEqual(a.size, L.spec(lv).size);
    assert.strictEqual(a.board.size, a.size);
    assert.strictEqual(E.countSolutions(a.size, a.board.region, 2), 1, `第 ${lv} 关解不唯一`);
    assert.deepStrictEqual(a, L.get(lv), `第 ${lv} 关不确定`);
  }
});

test('扩池: FAST_SEEDS 5/7/9 各 256,BOARDS_11 共 64 张且底盘互不重复', () => {
  for (const size of [5, 7, 9]) assert.strictEqual(L.FAST_SEEDS[size].length, 256);
  assert.strictEqual(L.BOARDS_11.length, 64);
  const keys = new Set(L.BOARDS_11.map(b => b.r + '|' + b.m.join(',')));
  assert.strictEqual(keys.size, 64, '底盘有重复');
});

test('D4 派生: 全量 512 张盘面互不重复,抽查各变换解唯一且雷位即解', () => {
  const n = L.BOARDS_11.length * 8; // 512
  const keys = new Set();
  for (let idx = 0; idx < n; idx++) {
    const b = L.decodeBoard(idx);
    assert.ok(b && b.size === 11, `idx ${idx} 解码失败`);
    assert.strictEqual(b.region.length, 121);
    assert.strictEqual(b.mines.length, 11);
    keys.add(b.region.join(',') + '|' + b.mines.join(','));
  }
  assert.strictEqual(keys.size, n, 'D4 派生盘面有重复');
  // 抽查:8 个变换各取 3 张底盘,countSolutions===1 且雷位就是那个唯一解
  for (let t = 0; t < 8; t++) {
    for (const bi of [0, 31, 63]) {
      const idx = t * L.BOARDS_11.length + bi;
      const b = L.decodeBoard(idx);
      assert.strictEqual(E.countSolutions(11, b.region, 2), 1, `idx ${idx} 解不唯一`);
      if (E.enumSolutions) {
        const sols = E.enumSolutions(11, b.region, 2);
        assert.deepStrictEqual(sols[0], b.mines, `idx ${idx} 雷位≠唯一解`);
      }
    }
  }
});

test('反重复: 连续 128 个 11×11 关在池耗尽(512)前盘面不复现', () => {
  const seen = new Set();
  let count = 0;
  for (let lv = 10; count < 128; lv++) {
    if (L.spec(lv).size !== 11) continue;
    const a = L.get(lv);
    const key = a.board.region.join(',') + '|' + a.board.mines.join(',');
    assert.ok(!seen.has(key), `lv ${lv} 盘面复现`);
    seen.add(key);
    count++;
  }
});
