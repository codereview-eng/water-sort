// 排行榜每日快照纯函数(issue #11;浏览器/Node 双环境,与 sudoku.html 内联同源):
// 快照日期用 UTC;Top50 按 level 降序,并列 competition ranking(同分同名次,后继跳号,并列内按名字序);
// 重算时提交池裁剪为仅保留榜内条目,控制 blob 大小。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lb = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TOP_N = 50;

  // 当日日期(UTC),YYYY-MM-DD
  function todayUTC(now) { return new Date(now).toISOString().slice(0, 10); }

  // 快照缺失/损坏/过期(date 翻转)→ 需要重算
  function needsRebuild(board, today) {
    return !board || !Array.isArray(board.top) || board.date !== today;
  }

  // competition ranking(同分同名次,后继跳号);入参需已按 level 降序
  function assignRanks(rows) {
    let rank = 0, prev = null;
    rows.forEach((p, i) => {
      if (p.level !== prev) { rank = i + 1; prev = p.level; }
      p.rank = rank;
    });
    return rows;
  }

  // 国家码归一:两位字母大写才合法,否则 'UN'(未知桶;issue #24 旧记录兼容)
  function normCountry(c) {
    const s = String(c || '').toUpperCase();
    return /^[A-Z]{2}$/.test(s) ? s : 'UN';
  }

  // 国家判定(issue #24,纯前端;issue #27 起退役:决策改走 geo.js IP 归属地链,
  // 本函数仅保留纯函数与既有测试,不再参与运行时国家判定)。
  function detectCountry(tgCode, navLang) {
    for (const cand of [tgCode, navLang]) {
      const m = /^[A-Za-z]{2,3}[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(String(cand || ''));
      if (m) return m[1].toUpperCase();
    }
    return 'UN';
  }

  // 本国 Tab 过滤(issue #24):按 country 过滤快照并在本国范围内重排名次(competition ranking)
  function filterCountry(top, country) {
    const c = normCountry(country);
    const rows = (top || []).filter((p) => normCountry(p && p.country) === c)
      .map((p) => ({ id: p.id, name: p.name, level: p.level, country: normCountry(p.country) }));
    return assignRanks(rows);
  }

  // 从提交池重算当日 Top50 快照(issue #24 起携带 country 字段,旧记录归 'UN')
  function buildTop(players, today) {
    const rows = Object.entries(players || {})
      .map(([id, p]) => p && { id, name: String(p.name == null ? '' : p.name).slice(0, 16), level: Number(p.level), country: normCountry(p.country) })
      .filter((p) => p && p.name && Number.isFinite(p.level) && p.level > 0)
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
      .slice(0, TOP_N);
    assignRanks(rows);
    return { date: today, top: rows };
  }

  // 分享文本组装(issue #25,纯函数):rows=当前 Tab 榜单(已排名),my={rank,level}(rank 空=未上榜,level 0=无成绩),
  // lang='zh'|'en',opts={date,scope,url}。模板与 sudoku.html I18N 同源内置,方便 node 直测 zh/en 成文。
  const SHARE_TPL = {
    zh: {
      head: '🧩 数独{scope}排行榜 · {date}',
      scopeLocal: '本国', scopeGlobal: '全球',
      row: '{medal} {name} · 第 {level} 关',
      mineRanked: '我的名次:第 {rank} 名(第 {level} 关)',
      mineUnranked: '我的成绩:第 {level} 关(尚未上榜)',
      empty: '榜单虚位以待,快来抢头名!',
      call: '来挑战我 👉 {url}',
    },
    en: {
      head: '🧩 Sudoku {scope} leaderboard · {date}',
      scopeLocal: 'national', scopeGlobal: 'global',
      row: '{medal} {name} · Lv {level}',
      mineRanked: 'My rank: #{rank} (Lv {level})',
      mineUnranked: 'My score: Lv {level} (not on board yet)',
      empty: 'The board is wide open — claim the top spot!',
      call: 'Beat me 👉 {url}',
    },
  };
  function fmtTpl(s, vars) { return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : '')); }
  function buildShareText(rows, my, lang, opts) {
    // opts.tpl 可传入 I18N 字典里的模板(sudoku.html 内联走字典;node 直测用内置同源模板)
    const T = (opts && opts.tpl) || SHARE_TPL[lang] || SHARE_TPL.en;
    const o = opts || {};
    const medals = ['🥇', '🥈', '🥉'];
    const lines = [fmtTpl(T.head, { scope: o.scope === 'global' ? T.scopeGlobal : T.scopeLocal, date: o.date || '' })];
    const top3 = (rows || []).slice(0, 3);
    if (top3.length === 0) lines.push(T.empty);
    else top3.forEach((p, i) => lines.push(fmtTpl(T.row, { medal: medals[i], name: p.name, level: p.level })));
    if (my && my.level > 0) {
      lines.push(my.rank ? fmtTpl(T.mineRanked, { rank: my.rank, level: my.level }) : fmtTpl(T.mineUnranked, { level: my.level }));
    }
    lines.push(fmtTpl(T.call, { url: o.url || 'https://t.me/sudoku2_bot/sudoku' }));
    return lines.join('\n');
  }

  // 提交池裁剪:仅保留榜内玩家,落榜条目删除
  function trimPlayers(players, top) {
    const keep = new Set(top.map((p) => p.id));
    const out = {};
    for (const id in players) if (keep.has(id)) out[id] = players[id];
    return out;
  }

  return { TOP_N, todayUTC, needsRebuild, buildTop, trimPlayers, normCountry, detectCountry, filterCountry, buildShareText };
});
