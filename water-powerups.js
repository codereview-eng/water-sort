// 倒水排序空瓶解锁规则：关卡逐瓶配置锁状态，道具/广告只负责解锁明确上锁的空瓶。
// 双环境：Node (module.exports) 与浏览器 (window.WaterPowerups)。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaterPowerups = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function emptyBottleIndexes(state) {
    if (!Array.isArray(state)) return [];
    const out = [];
    for (let i = 0; i < state.length; i += 1) {
      if (Array.isArray(state[i]) && state[i].length === 0) out.push(i);
    }
    return out;
  }

  function normalizeLockedBottleIndexes(state, configured) {
    const empty = new Set(emptyBottleIndexes(state));
    const seen = new Set();
    const out = [];
    if (!Array.isArray(configured)) return out;
    for (const index of configured) {
      if (!Number.isInteger(index) || !empty.has(index) || seen.has(index)) continue;
      seen.add(index);
      out.push(index);
    }
    return out;
  }

  function lockedBottleIndexes(state, configured, unlocked) {
    const open = new Set(Array.isArray(unlocked) ? unlocked : []);
    return normalizeLockedBottleIndexes(state, configured).filter((i) => !open.has(i));
  }

  function unlockBottle(state, opts) {
    const o = opts || {};
    const stock = Number(o.stock) || 0;
    const unlocked = Array.isArray(o.unlocked) ? o.unlocked.slice() : [];
    const mode = o.mode === 'ad' ? 'ad' : 'item';
    const locked = lockedBottleIndexes(state, o.lockedBottleIndexes, unlocked);
    const target = o.target == null ? locked[0] : Number(o.target);
    if (!locked.includes(target) || (mode === 'item' && stock <= 0)) return null;
    return {
      state: state.map((tube) => tube.slice()),
      stock: mode === 'item' ? stock - 1 : stock,
      unlocked: unlocked.concat([target]),
      index: target,
    };
  }

  return {
    emptyBottleIndexes,
    normalizeLockedBottleIndexes,
    lockedBottleIndexes,
    unlockBottle,
  };
});
