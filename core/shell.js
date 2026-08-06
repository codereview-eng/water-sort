/* UI 骨架 core：首页/结算页模块开关声明式（issue #1 · S15）
   纪律：CDUI（构建期定形）——config 只声明「哪些模块、什么顺序、什么
   props」，shell 持有组件注册表按声明渲染，不认识具体游戏；注册表的
   安全边界：配置只能重排已注册组件，变不出新功能；未知模块 type、
   未知声明键一律加载期抛错（拒绝行业常见的静默跳过反模式）。
   浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShellCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fail(msg) { throw new Error('shell config: ' + msg); }

  var MODULE_KEYS = ['type', 'props'];

  // registry: Map<type, renderFn(props, ctx)>；screensCfg: { <screen>: { modules: [{type, props?}] } }
  function create(registry, screensCfg) {
    if (!(registry instanceof Map)) fail('registry 必须是 Map（type → 渲染函数）');
    registry.forEach(function (fn, type) {
      if (typeof fn !== 'function') fail('注册组件 "' + type + '" 必须是函数');
    });
    if (screensCfg == null) screensCfg = {};
    if (typeof screensCfg !== 'object' || Array.isArray(screensCfg)) fail('screens 必须是对象');
    Object.keys(screensCfg).forEach(function (screen) {
      var sc = screensCfg[screen];
      if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) fail('screens.' + screen + ' 必须是对象');
      Object.keys(sc).forEach(function (k) { if (k !== 'modules') fail('screens.' + screen + ' 未知键 "' + k + '"（合法键：modules）'); });
      if (!Array.isArray(sc.modules)) fail('screens.' + screen + '.modules 必须是数组');
      sc.modules.forEach(function (m) {
        if (typeof m !== 'object' || m === null || Array.isArray(m)) fail('screens.' + screen + ' 模块声明必须是对象');
        Object.keys(m).forEach(function (k) {
          if (MODULE_KEYS.indexOf(k) === -1) fail('screens.' + screen + ' 模块声明未知键 "' + k + '"（合法键：' + MODULE_KEYS.join('、') + '）');
        });
        if (typeof m.type !== 'string' || !m.type) fail('screens.' + screen + ' 模块缺 type');
        if (!registry.has(m.type)) fail('screens.' + screen + ' 引用未注册模块 type "' + m.type + '"（已注册：' + Array.from(registry.keys()).join('、') + '）');
        if (m.props !== undefined && (typeof m.props !== 'object' || m.props === null || Array.isArray(m.props))) fail('screens.' + screen + '.' + m.type + '.props 必须是对象');
      });
    });
    return {
      screens: function () { return Object.keys(screensCfg); },
      modules: function (screen) {
        var sc = screensCfg[screen];
        if (!sc) throw new Error('shell: 未声明 screen "' + screen + '"');
        return sc.modules.map(function (m) { return m.type; });
      },
      // 开/关 = 模块在不在数组里；顺序 = 数组序
      render: function (screen, ctx) {
        var sc = screensCfg[screen];
        if (!sc) throw new Error('shell: 未声明 screen "' + screen + '"');
        return sc.modules.map(function (m) { return registry.get(m.type)(m.props || {}, ctx); });
      }
    };
  }

  return { create: create };
});
