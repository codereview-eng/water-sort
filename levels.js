// 前 5 关固定盘面(issue #14,issue #16 重生成):由 engine.js 离线生成(自定义 givens 档,
// seed 1065/1060/1055/1050/1045),给定数 65→60→55→50→45 递减爬坡,全网同题;
// 每盘均经 countSolutions===1 唯一解校验 + solvableBySingles 全程 naked-single 零卡壳校验,
// 快照由 levels.test.js 锁定。第 6 关起改走 seed 随机 + 关卡-难度映射(beginner 40-47 givens)。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SudokuLevels = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FIXED_LEVELS = [
    { // 第 1 关 · seed 1065 · 65 给定
      p: '456218937010007456937406218504892301390745082802163509649501723125300060783624195',
      s: '456218937218937456937456218564892371391745682872163549649581723125379864783624195',
    },
    { // 第 2 关 · seed 1060 · 60 给定
      p: '452063978160078452978400060520300786796805231381007049040006817615780024837210695',
      s: '452163978163978452978452163524391786796845231381627549249536817615789324837214695',
    },
    { // 第 3 关 · seed 1055 · 55 给定
      p: '614857392807390010092610000146700925900261008728009163000075280080023706279486531',
      s: '614857392857392614392614857146738925935261478728549163463175289581923746279486531',
    },
    { // 第 4 关 · seed 1050 · 50 给定
      p: '389000067510400389407300002890240671640708025275096034900001706158004093720000148',
      s: '389512467512467389467389512893245671641738925275196834934821756158674293726953148',
    },
    { // 第 5 关 · seed 1045 · 45 给定
      p: '304006105876025004125004800040608050007539400050702030001900582700250643502400709',
      s: '394876125876125394125394876943618257217539468658742931431967582789251643562483719',
    },
  ];

  // 零卡壳校验器(issue #16):从初始局面反复填 naked single(某格候选只剩一个),
  // 直到解完返回 true;中途找不到任何 naked single 即 false。不接受 hidden single,
  // 采用最严格口径——玩家只需逐格数候选即可通关,无需任何行列宫排除技巧。
  function solvableBySingles(puzzle) {
    const g = puzzle.slice();
    const ok = (i, v) => {
      const r = Math.floor(i / 9), c = i % 9, br = r - (r % 3), bc = c - (c % 3);
      for (let k = 0; k < 9; k++) {
        if (g[r * 9 + k] === v || g[k * 9 + c] === v) return false;
        if (g[(br + Math.floor(k / 3)) * 9 + bc + (k % 3)] === v) return false;
      }
      return true;
    };
    for (;;) {
      let placed = false, done = true;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        done = false;
        let cand = 0, n = 0;
        for (let v = 1; v <= 9; v++) if (ok(i, v)) { cand = v; n++; if (n > 1) break; }
        if (n === 0) return false;
        if (n === 1) { g[i] = cand; placed = true; }
      }
      if (done) return true;
      if (!placed) return false;
    }
  }

  return { FIXED_LEVELS, solvableBySingles };
}));
