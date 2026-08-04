// 局间插屏纯函数(issue #22;浏览器/Node 双环境,与 sudoku.html 内联同源):
// 每局进入结算态随机四选一(均匀):null=本局不弹 / 5000 / 10000 / 20000 ms 空闲后弹。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IdleAd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DELAYS = [null, 5000, 10000, 20000];

  // rand ∈ [0,1)(如 Math.random() 产出);非法输入(NaN/越界/非数字)一律安全回退 null(不弹)
  function pickInterstitialDelay(rand) {
    if (typeof rand !== 'number' || !isFinite(rand) || rand < 0 || rand >= 1) return null;
    return DELAYS[Math.floor(rand * DELAYS.length)];
  }

  return { DELAYS, pickInterstitialDelay };
});
