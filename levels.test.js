// 固定关卡测试(issue #14,issue #16 更新):5 盘唯一解 + 快照不变 + singles-only 零卡壳
const { test } = require('node:test');
const assert = require('node:assert');
const { FIXED_LEVELS, solvableBySingles } = require('./levels.js');
const { solve, countSolutions } = require('./engine.js');

// 快照:与 levels.js 内常量逐字节对账,改盘面必须同步改这里(有意的双写锁)
const SNAPSHOT = [
  '456218937010007456937406218504892301390745082802163509649501723125300060783624195',
  '452063978160078452978400060520300786796805231381007049040006817615780024837210695',
  '614857392807390010092610000146700925900261008728009163000075280080023706279486531',
  '389000067510400389407300002890240671640708025275096034900001706158004093720000148',
  '304006105876025004125004800040608050007539400050702030001900582700250643502400709',
];

test('固定关卡:恰好 5 盘且快照不变', () => {
  assert.strictEqual(FIXED_LEVELS.length, 5);
  FIXED_LEVELS.forEach((lv, i) => assert.strictEqual(lv.p, SNAPSHOT[i], '第 ' + (i + 1) + ' 关盘面快照变了'));
});

test('固定关卡:每盘唯一解且内置解正确', () => {
  FIXED_LEVELS.forEach((lv, i) => {
    const puzzle = lv.p.split('').map(Number);
    const sol = lv.s.split('').map(Number);
    assert.strictEqual(puzzle.length, 81);
    assert.strictEqual(sol.length, 81);
    assert.strictEqual(countSolutions(puzzle, 2), 1, '第 ' + (i + 1) + ' 关应唯一解');
    assert.deepStrictEqual(solve(puzzle), sol, '第 ' + (i + 1) + ' 关内置解应与求解一致');
    for (let k = 0; k < 81; k++) if (puzzle[k]) assert.strictEqual(sol[k], puzzle[k]);
  });
});

test('固定关卡:给定数为 65→60→55→50→45 递减爬坡(issue #16)', () => {
  const givens = FIXED_LEVELS.map((lv) => lv.p.split('').filter((c) => c !== '0').length);
  assert.deepStrictEqual(givens, [65, 60, 55, 50, 45], '给定数应精确为 65/60/55/50/45');
});

test('固定关卡:每盘全程 naked-single 零卡壳可解(issue #16)', () => {
  FIXED_LEVELS.forEach((lv, i) => {
    const puzzle = lv.p.split('').map(Number);
    assert.strictEqual(solvableBySingles(puzzle), true, '第 ' + (i + 1) + ' 关应 singles-only 可解');
  });
});

test('solvableBySingles:对需要高级技巧的盘返回 false', () => {
  // 一个合法但非 singles-only 的困难盘(经典 17 给定示例)
  const hard = '000000010400000000020000000000050407008000300001090000300400200050100000000806000'
    .split('').map(Number);
  assert.strictEqual(solvableBySingles(hard), false);
});
