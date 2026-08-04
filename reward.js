// 激励循环纯函数:体力恢复 + 关卡难度映射(浏览器/Node 双环境)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Reward = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const E_MAX = 120;        // 体力上限
  const E_COST = 15;        // 每盘消耗
  const E_TICK = 60_000;    // 每分钟 +1
  const E_AD = 60;          // 看广告补充量

  // 体力离线恢复:lastTs 只前移已结算整分钟(余秒保留);回拨收敛 now;
  // >=120 时自然恢复不生效且超额保留不回收(issue #7),lastTs 贴 now
  function restore(energy, lastTs, now) {
    if (energy >= E_MAX) return { energy, lastTs: now };
    if (now < lastTs) return { energy, lastTs: now };
    const gained = Math.floor((now - lastTs) / E_TICK);
    const newEnergy = Math.min(E_MAX, energy + gained);
    return { energy: newEnergy, lastTs: newEnergy >= E_MAX ? now : lastTs + gained * E_TICK };
  }

  // 关卡 → 难度:1-20 新手, 21-60 简单, 61-150 中等, 151+ 困难
  function levelDiff(level) {
    if (level <= 20) return 'beginner';
    if (level <= 60) return 'easy';
    if (level <= 150) return 'medium';
    return 'hard';
  }

  // 关卡 → 确定性 seed(全网同关同题,排行榜可比)
  function levelSeed(level) {
    return (Math.imul(level, 2654435761) ^ 0x5D0C0) >>> 1;
  }

  return { restore, levelDiff, levelSeed, E_MAX, E_COST, E_TICK, E_AD };
});
