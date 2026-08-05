// 倒水排序空瓶解锁规则：关卡布局预先带齐空瓶，道具/广告只负责逐个解锁。
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

  function lockedBottleIndexes(state, unlocked) {
    const open = new Set(Array.isArray(unlocked) ? unlocked : []);
    return emptyBottleIndexes(state).filter((i) => !open.has(i));
  }

  function unlockBottle(state, opts) {
    const o = opts || {};
    const stock = Number(o.stock) || 0;
    const unlocked = Array.isArray(o.unlocked) ? o.unlocked.slice() : [];
    const mode = o.mode === 'ad' ? 'ad' : 'item';
    const locked = lockedBottleIndexes(state, unlocked);
    const target = o.target == null ? locked[0] : Number(o.target);
    if (!locked.includes(target) || (mode === 'item' && stock <= 0)) return null;
    return {
      state: state.map((tube) => tube.slice()),
      stock: mode === 'item' ? stock - 1 : stock,
      unlocked: unlocked.concat([target]),
      index: target,
    };
  }

  return { emptyBottleIndexes, lockedBottleIndexes, unlockBottle };
});
