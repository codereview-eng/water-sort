/* 激励循环入口：core/reward.js 的默认(=现行)配置实例；差异化配置用 RewardCore.create(cfg)（issue #1） */
(function (root, factory) {
  // 路径用 join 拼接：此 require 仅 Node 分支执行；避免内联进单文件预览后被
  // build-preview.mjs 的零外链扫描（单引号相对路径字面量）误判为运行时本地依赖。
  if (typeof module === 'object' && module.exports) module.exports = factory(require(['.', 'core', 'reward.js'].join('/')), null);
  else root.Reward = factory(root.RewardCore, root.GameConfig && root.GameConfig.reward);
})(typeof self !== 'undefined' ? self : this, function (core, cfg) {
  'use strict';
  return core.create(cfg);
});
