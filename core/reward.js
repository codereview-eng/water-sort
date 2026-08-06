/* 激励循环 core：与具体玩法无关；奖励参数全配置化 + fail-fast 校验（issue #1 · M3/M4/S1/S2/S19）
 * 纪律：配置只放参数（数值/开关），行为解释权在本模块（防 soft-coding）；
 * 未知键/非法值一律在加载期抛错（防静默吞错）。浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RewardCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DEFAULTS = Object.freeze({ eMax: 120, eCost: 15, eTickMs: 60000, eAd: 60 });
  const KEYS = Object.keys(DEFAULTS);

  function validate(cfg) {
    if (cfg == null) return Object.assign({}, DEFAULTS);
    if (typeof cfg !== 'object' || Array.isArray(cfg)) {
      throw new Error('reward config: 必须是对象，得到 ' + Object.prototype.toString.call(cfg));
    }
    for (const k of Object.keys(cfg)) {
      if (KEYS.indexOf(k) === -1) throw new Error('reward config: 未知键 "' + k + '"（合法键: ' + KEYS.join(', ') + '）');
    }
    const out = Object.assign({}, DEFAULTS, cfg);
    for (const k of KEYS) {
      const v = out[k];
      if (typeof v !== 'number' || !isFinite(v) || v < 0) {
        throw new Error('reward config: "' + k + '" 必须是 >= 0 的有限数，得到 ' + JSON.stringify(v));
      }
    }
    if (out.eMax <= 0) throw new Error('reward config: "eMax" 必须 > 0');
    if (out.eTickMs <= 0) throw new Error('reward config: "eTickMs" 必须 > 0');
    return out;
  }

  function create(cfg) {
    const C = validate(cfg);
    const E_MAX = C.eMax, E_COST = C.eCost, E_TICK = C.eTickMs, E_AD = C.eAd;
    function restore(energy, lastTs, now) {
      if (energy >= E_MAX) return { energy, lastTs: now };
      if (now < lastTs) return { energy, lastTs: now };
      const gained = Math.floor((now - lastTs) / E_TICK);
      const newEnergy = Math.min(E_MAX, energy + gained);
      return { energy: newEnergy, lastTs: newEnergy >= E_MAX ? now : lastTs + gained * E_TICK };
    }
    function levelDiff(level) {
      if (level <= 20) return 'beginner';
      if (level <= 60) return 'easy';
      if (level <= 150) return 'medium';
      return 'hard';
    }
    function levelSeed(level) {
      return (Math.imul(level, 2654435761) ^ 0x5D0C0) >>> 1;
    }
    return { restore, levelDiff, levelSeed, E_MAX, E_COST, E_TICK, E_AD };
  }

  return { create, validate, DEFAULTS };
});
