// 排行榜每日快照纯函数测试(issue #11)
const { test } = require('node:test');
const assert = require('node:assert');
const Lb = require('./lb.js');

test('todayUTC: UTC 日期串', () => {
  assert.strictEqual(Lb.todayUTC(Date.UTC(2026, 6, 28, 23, 59)), '2026-07-28');
  assert.strictEqual(Lb.todayUTC(Date.UTC(2026, 6, 29, 0, 0)), '2026-07-29');
});

test('needsRebuild: date 翻转/缺失/损坏触发重算,当天不重算', () => {
  const today = '2026-07-28';
  assert.ok(Lb.needsRebuild(undefined, today));                       // 无快照
  assert.ok(Lb.needsRebuild({ date: today }, today));                 // top 缺失
  assert.ok(Lb.needsRebuild({ date: '2026-07-27', top: [] }, today)); // 日期翻转
  assert.ok(!Lb.needsRebuild({ date: today, top: [] }, today));       // 当天快照直接用
});

test('buildTop: 降序 + Top50 裁剪 + 无效条目过滤', () => {
  const players = {};
  for (let i = 1; i <= 60; i++) players['p' + i] = { name: 'P' + i, level: i };
  players.bad1 = { name: '', level: 5 };
  players.bad2 = { name: 'X', level: 0 };
  players.bad3 = null;
  const b = Lb.buildTop(players, '2026-07-28');
  assert.strictEqual(b.date, '2026-07-28');
  assert.strictEqual(b.top.length, 50);
  assert.strictEqual(b.top[0].level, 60);
  assert.strictEqual(b.top[0].rank, 1);
  assert.strictEqual(b.top[49].level, 11); // 60..11 共 50 条,level<=10 落榜
});

test('buildTop: 并列 competition ranking(同分同名次,后继跳号)', () => {
  const b = Lb.buildTop({
    a: { name: 'A', level: 9 }, b: { name: 'B', level: 9 },
    c: { name: 'C', level: 7 }, d: { name: 'D', level: 7 }, e: { name: 'E', level: 5 },
  }, '2026-07-28');
  assert.deepStrictEqual(b.top.map((p) => p.rank), [1, 1, 3, 3, 5]);
  assert.deepStrictEqual(b.top.map((p) => p.name), ['A', 'B', 'C', 'D', 'E']); // 并列按名字序
});

test('trimPlayers: 提交池裁剪为仅保留榜内条目', () => {
  const players = {};
  for (let i = 1; i <= 60; i++) players['p' + i] = { name: 'P' + i, level: i };
  const b = Lb.buildTop(players, '2026-07-28');
  const trimmed = Lb.trimPlayers(players, b.top);
  assert.strictEqual(Object.keys(trimmed).length, 50);
  assert.ok(!trimmed.p1 && !trimmed.p10); // 落榜删除
  assert.ok(trimmed.p11 && trimmed.p60);  // 榜内保留原始条目
});

/* ===== issue #24:国家推断/过滤 ===== */
test('detectCountry: zh-CN→CN / en-US→US(tg 优先)', () => {
  assert.strictEqual(Lb.detectCountry('zh-CN', 'en-US'), 'CN');
  assert.strictEqual(Lb.detectCountry('', 'en-US'), 'US');
  assert.strictEqual(Lb.detectCountry('en_GB', ''), 'GB'); // 下划线分隔也接受
});

test('detectCountry: 无地区码/空值 → UN', () => {
  assert.strictEqual(Lb.detectCountry('zh', 'en'), 'UN');
  assert.strictEqual(Lb.detectCountry('', ''), 'UN');
  assert.strictEqual(Lb.detectCountry(null, undefined), 'UN');
  assert.strictEqual(Lb.detectCountry('zh-Hans', 'en'), 'UN'); // 脚本子标签非地区码(4 字母)
});

test('normCountry: 旧记录无 country 兼容为 UN', () => {
  assert.strictEqual(Lb.normCountry(undefined), 'UN');
  assert.strictEqual(Lb.normCountry('cn'), 'CN');
  assert.strictEqual(Lb.normCountry('XYZ'), 'UN');
});

test('buildTop: 携带 country,旧记录归 UN', () => {
  const b = Lb.buildTop({
    a: { name: 'A', level: 9, country: 'CN' },
    b: { name: 'B', level: 7 }, // 旧记录
  }, '2026-07-29');
  assert.deepStrictEqual(b.top.map((p) => p.country), ['CN', 'UN']);
});

test('filterCountry: 按国过滤并在国内重排名次', () => {
  const top = Lb.buildTop({
    a: { name: 'A', level: 9, country: 'CN' }, b: { name: 'B', level: 8, country: 'US' },
    c: { name: 'C', level: 7, country: 'CN' }, d: { name: 'D', level: 7, country: 'CN' },
    e: { name: 'E', level: 5 },
  }, '2026-07-29').top;
  const cn = Lb.filterCountry(top, 'CN');
  assert.deepStrictEqual(cn.map((p) => p.name), ['A', 'C', 'D']);
  assert.deepStrictEqual(cn.map((p) => p.rank), [1, 2, 2]); // 国内重排,并列 competition ranking
  assert.strictEqual(Lb.filterCountry(top, 'UN').length, 1); // 旧记录落 UN 桶
});

/* ===== issue #25:分享文本 ===== */
test('buildShareText: zh 正常榜 + 自己在榜', () => {
  const rows = [
    { name: 'A', level: 9, rank: 1 }, { name: 'B', level: 8, rank: 2 },
    { name: 'C', level: 7, rank: 3 }, { name: 'D', level: 6, rank: 4 },
  ];
  const s = Lb.buildShareText(rows, { rank: 2, level: 8 }, 'zh', { date: '2026-07-29', scope: 'local', url: 'https://t.me/sudoku2_bot/sudoku' });
  assert.ok(s.includes('本国排行榜 · 2026-07-29'));
  assert.ok(s.includes('🥇 A · 第 9 关'));
  assert.ok(s.includes('🥉 C · 第 7 关'));
  assert.ok(!s.includes('D')); // 只取前 3
  assert.ok(s.includes('我的名次:第 2 名(第 8 关)'));
  assert.ok(s.includes('来挑战我 👉 https://t.me/sudoku2_bot/sudoku'));
});

test('buildShareText: en 空榜', () => {
  const s = Lb.buildShareText([], { rank: 0, level: 0 }, 'en', { date: '2026-07-29', scope: 'global' });
  assert.ok(s.includes('global leaderboard'));
  assert.ok(s.includes('wide open'));
  assert.ok(!s.includes('My rank')); // 无成绩不带我的行
  assert.ok(s.includes('https://t.me/sudoku2_bot/sudoku'));
});

test('buildShareText: 自己不在榜(有成绩无名次)', () => {
  const s = Lb.buildShareText([{ name: 'A', level: 9, rank: 1 }], { rank: 0, level: 3 }, 'en', { date: '2026-07-29', scope: 'global' });
  assert.ok(s.includes('My score: Lv 3 (not on board yet)'));
});
