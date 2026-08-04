/* tgid.js — 兜底身份解析(issue #20)。
   telegram-web-app.js SDK 在部分网络(telegram.org 被墙)加载失败时,
   直接从 Mini App URL hash 的 tgWebAppData=<urlencoded query> 解析 user。
   纯函数,无 DOM/网络依赖;双环境:Node (module.exports) 与浏览器 (window.TgId)。
   hash 形如 #tgWebAppData=query_id%3D...%26user%3D%7B...%7D%26...&tgWebAppVersion=...
   需两层解码:先按 & 取 tgWebAppData 值 decodeURIComponent 得内层 query,
   再取内层 user= 值 decodeURIComponent 后 JSON.parse。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TgId = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 从 location.hash(或 search)解析 Telegram 用户。
     返回 {id,first_name,last_name,username,language_code}(id 为字符串)或 null。 */
  function parseTgWebAppData(hashOrSearch) {
    if (!hashOrSearch || typeof hashOrSearch !== 'string') return null;
    const s = hashOrSearch.replace(/^[#?]/, '');
    let raw = null;
    const parts = s.split('&');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].indexOf('tgWebAppData=') === 0) { raw = parts[i].slice(13); break; }
    }
    if (!raw) return null;
    let inner;
    try { inner = decodeURIComponent(raw); } catch (e) { return null; }
    let userStr = null;
    const kv = inner.split('&');
    for (let i = 0; i < kv.length; i++) {
      if (kv[i].indexOf('user=') === 0) { userStr = kv[i].slice(5); break; }
    }
    if (!userStr) return null;
    let u;
    try { u = JSON.parse(decodeURIComponent(userStr)); } catch (e) { return null; }
    if (!u || typeof u !== 'object' || u.id == null) return null;
    return {
      id: String(u.id),
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      username: u.username || '',
      language_code: u.language_code || '',
    };
  }

  /* 展示名:first_name+last_name,退 username;无则空串(调用方再退本地化名)。 */
  function displayName(u) {
    if (!u) return '';
    return ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.username || '';
  }

  return { parseTgWebAppData, displayName };
});
