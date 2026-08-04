// 国家判定决策链纯函数(issue #27;浏览器/Node 双环境,与 sudoku.html 内联同源):
// 首次启动用免费 IP 归属地 API(多提供方依次降级),判不出记 'other';
// 一经确认(含 other)永久锁定,后续启动只读存储、零 IP 请求。
// 旧的 language 推断(lb.js detectCountry,issue #24)自本 issue 起退役,不再参与决策。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const OTHER = 'other';
  const TIMEOUT_MS = 4000; // 每个提供方的请求超时(AbortController)

  // 提供方顺序:api.country.is 响应体最小放最前;两家均 HTTPS+CORS(本机实测可达)。
  // 禁用 http:// 提供方(HTTPS 页面 mixed content 会拦)。
  const PROVIDERS = [
    { name: 'country.is', url: 'https://api.country.is/' },
    { name: 'ipwho.is', url: 'https://ipwho.is/' },
  ];

  // 两位字母国家码归一:合法返回大写码,否则 null
  function normCountry(c) {
    const s = String(c == null ? '' : c).trim().toUpperCase();
    return /^[A-Z]{2}$/.test(s) ? s : null;
  }

  // 已存值归一:合法两位码或 'other' 视为已确认;旧 'UN' 合并为 'other';其余(空/垃圾)null=未确认
  function normSaved(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (s.toLowerCase() === OTHER) return OTHER;
    const c = normCountry(s);
    if (c === 'UN') return OTHER; // 'UN' 恰好也是两位码形态,显式合并
    return c;
  }

  // 各提供方响应解析:成功返回两位大写国家码,失败/非法返回 null
  function parseCountryResponse(provider, json) {
    if (!json || typeof json !== 'object') return null;
    if (provider === 'country.is') return normCountry(json.country);          // {ip, country}
    if (provider === 'ipwho.is') {
      if (json.success === false) return null;                                // ipwho.is 失败仍返回 200
      return normCountry(json.country_code);                                  // {country_code, ...}
    }
    return null;
  }

  // 决策链:已存值(含 other)短路,零请求;否则依次尝试 fetchers(() => Promise<code|null>),
  // 第一个合法码即定;全部失败/超时/非法 → 'other'。永不 reject(静默降级)。
  function resolveCountry(saved, fetchers) {
    const s = normSaved(saved);
    if (s) return Promise.resolve({ country: s, source: 'saved', requests: 0 });
    const list = (fetchers || []).slice();
    let requests = 0;
    function next(i) {
      if (i >= list.length) return Promise.resolve({ country: OTHER, source: 'fallback', requests });
      requests += 1;
      return Promise.resolve().then(() => list[i]()).then(
        (c) => {
          const n = normCountry(c);
          return n ? { country: n, source: 'ip', requests } : next(i + 1);
        },
        () => next(i + 1)
      );
    }
    return next(0);
  }

  return { OTHER, TIMEOUT_MS, PROVIDERS, normCountry, normSaved, parseCountryResponse, resolveCountry };
});
