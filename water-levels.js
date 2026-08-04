// 倒水关卡数据。颜色用稳定 id，色值由 PALETTE 决定（与 sudoku.html 的墨绿深色主题协调）。
// 每关的 minMoves 由 water-engine 的 BFS 求解器标定，water-engine.test.js 硬校验。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaterLevels = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PALETTE = {
    mint: '#7FC29B',   // 与 --accent 同源
    gold: '#D4B36A',   // --podium
    coral: '#DE7A70',  // --bad
    amber: '#D2A05C',  // --warn
    sky: '#6FA8D6',
    violet: '#9B8BD0',
    rose: '#D982A8',
    teal: '#5FBFB0',
  };

  const LEVELS = [
    {
      id: 1,
      capacity: 4,
      colors: ['mint', 'gold', 'coral'],
      empty: 2,
      // 教学关：每管两两成段，顶部段可整段搬走；3 色 + 2 空管。
      // 教会「点源管 → 点目标管」与「空管是周转位」，不需要复杂前瞻。
      layout: [
        ['mint', 'mint', 'gold', 'gold'],
        ['gold', 'gold', 'coral', 'coral'],
        ['coral', 'coral', 'mint', 'mint'],
        [],
        [],
      ],
      // solver 标定：最短 4 步 [0→3] [2→0] [1→2] [1→3]
      minMoves: 4,
    },
  ];

  const getLevel = (id) => LEVELS.filter((l) => l.id === id)[0] || null;
  // UI 每次开局都要拿一份可变副本，禁止直接改 LEVELS
  const initialState = (id) => {
    const lv = getLevel(id);
    return lv ? lv.layout.map((t) => t.slice()) : null;
  };

  return { PALETTE, LEVELS, getLevel, initialState };
});
