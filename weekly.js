// 每周活动纯函数(issue #30):周 key/倒计时/主题轮换/解锁阈值/奖励 roll(注入 rand)/结转
// 浏览器/Node 双环境。周界取舍:UTC 周,周一 00:00 UTC 起算(与排行榜 todayUTC 同口径),
// 即「周日 24:00 UTC 重置」,详见 issue #30 评论。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Weekly = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 86400000;
  const WEEK = 7 * DAY;
  const GOAL = 600;                                    // 大奖阈值
  const THRESHOLDS = [100, 200, 300, 400, 500, 600];   // 6 张主题图解锁阈值
  const FRAG_WIN = 10;                                 // 每盘胜利 +10 碎片
  const FRAG_AD = 10;                                  // 看广告 +10 碎片
  const GRAND = { energy: 60, hints: 5 };              // 大奖(各图奖励之外)

  // 周序号:UTC 周一 00:00 为界。1970-01-01 是周四(day 0),+3 使周一对齐周界。
  function weekIndex(now) {
    return Math.floor((Math.floor(now / DAY) + 3) / 7);
  }
  function weekKey(now) { return 'w' + weekIndex(now); }
  // 本周结束时刻(下周一 00:00 UTC)
  function weekEnd(now) {
    return (weekIndex(now) + 1) * WEEK - 3 * DAY;
  }

  // 主题:按周序号确定性轮换,加主题只补数组
  const THEMES = [
    { zh: { name: '星空周', pics: ['晓星', '孤星', '行星环', '彗星', '星云涡', '星座图'] },
      en: { name: 'Starry Week', pics: ['Dawn Star', 'Lone Star', 'Ringed Planet', 'Comet', 'Nebula', 'Constellation'] },
      c1: '#D4B36A', c2: '#7FC29B', bg: '#101820' },
    { zh: { name: '深海周', pics: ['珍珠', '水母', '游鱼', '海螺', '暗流', '灯塔'] },
      en: { name: 'Deep Sea Week', pics: ['Pearl', 'Jellyfish', 'Fish', 'Conch', 'Undertow', 'Lighthouse'] },
      c1: '#7FB8C2', c2: '#7FC29B', bg: '#0E1A20' },
    { zh: { name: '森林周', pics: ['嫩芽', '孤木', '年轮', '飞鸟', '林间光', '山丘'] },
      en: { name: 'Forest Week', pics: ['Sprout', 'Lone Tree', 'Rings', 'Bird', 'Sunbeam', 'Hills'] },
      c1: '#8FC27F', c2: '#D4B36A', bg: '#121D14' },
    { zh: { name: '灯火周', pics: ['烛光', '灯笼', '街灯', '篝火', '烟花', '灯河'] },
      en: { name: 'Lantern Week', pics: ['Candle', 'Lantern', 'Streetlamp', 'Bonfire', 'Fireworks', 'River of Light'] },
      c1: '#D2A05C', c2: '#DE9A70', bg: '#1C1410' },
  ];
  function themeFor(now) { return THEMES[weekIndex(now) % THEMES.length]; }

  // 已达阈值张数(0..6)
  function unlockedCount(frags) {
    let n = 0;
    for (let i = 0; i < THRESHOLDS.length; i++) if (frags >= THRESHOLDS[i]) n++;
    return n;
  }
  // 碎片从 before 涨到 after 时,新解锁的图索引(0-based)
  function newlyUnlocked(before, after) {
    const out = [];
    for (let i = 0; i < THRESHOLDS.length; i++) {
      if (before < THRESHOLDS[i] && after >= THRESHOLDS[i]) out.push(i);
    }
    return out;
  }

  // 图奖励 roll(注入 rand,便于测试):二选一随机 —
  // randType<0.5 → 体力 10-60;否则 → 提示 1-3。randAmt ∈ [0,1)。非法输入安全回退最小奖励。
  function rollReward(randType, randAmt) {
    const ok = (r) => typeof r === 'number' && isFinite(r) && r >= 0 && r < 1;
    const rt = ok(randType) ? randType : 0;
    const ra = ok(randAmt) ? randAmt : 0;
    if (rt < 0.5) return { type: 'energy', n: 10 + Math.floor(ra * 51) };  // 10..60
    return { type: 'hints', n: 1 + Math.floor(ra * 3) };                   // 1..3
  }

  // 结转:当周超 600 的部分结转下周(只结转一次)
  function carry(frags) { return Math.max(0, (frags | 0) - GOAL); }

  // 空白周状态
  function blank(wk) {
    return { week: wk, frags: 0, carried: 0, claimed: [false, false, false, false, false, false], grand: false };
  }
  // 周对账:state 属于当前周则原样返回;跨周则重置并把上周超额结转进来。
  // 取舍:跨多周未登录也按「向当前周结转一次」处理(碎片不作废),见 issue #30 评论。
  function normalize(state, wk) {
    if (state && state.week === wk && Array.isArray(state.claimed) && state.claimed.length === 6) return state;
    const b = blank(wk);
    if (state && typeof state.frags === 'number' && state.week !== wk) {
      b.carried = carry(state.frags);
      b.frags = b.carried;
    }
    return b;
  }

  return {
    DAY, WEEK, GOAL, THRESHOLDS, FRAG_WIN, FRAG_AD, GRAND, THEMES,
    weekIndex, weekKey, weekEnd, themeFor,
    unlockedCount, newlyUnlocked, rollReward, carry, blank, normalize,
  };
});
