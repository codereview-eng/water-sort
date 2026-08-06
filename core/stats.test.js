/* 排行与档案 core 单元测试：声明式聚合 + 排行维度 + fail-fast
   （issue #1 · S11/S12 的机制面；场景级断言见 fixtures/S11–S12） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./stats.js');

test('默认配置 = 无此系统（附加式，不改既有行为）', () => {
  assert.deepEqual(S.createArchive(null).keys(), []);
  assert.deepEqual(S.createRank(null, []).ids(), []);
});

test('档案：五种聚合算子按声明工作，core 对字段语义零认知', () => {
  const ar = S.createArchive([
    { key: 'n', event: 'ev', agg: 'count' },
    { key: 'total', event: 'ev', agg: 'sum', field: 'x' },
    { key: 'best', event: 'ev', agg: 'max', field: 'x' },
    { key: 'least', event: 'ev', agg: 'min', field: 'x' },
    { key: 'recent', event: 'ev', agg: 'last', field: 'x' }
  ]);
  ar.onEvent('ev', { x: 5 });
  ar.onEvent('other', { x: 999 }); // 未声明事件被忽略
  ar.onEvent('ev', { x: 2 });
  assert.deepEqual(ar.all(), { n: 2, total: 7, best: 5, least: 2, recent: 2 });
});

test('排行：order 生成比较器，best/increment 两种写入语义', () => {
  const rk = S.createRank([
    { id: 'time', metric: 'best_ms', order: 'asc', operator: 'best' },
    { id: 'score', metric: 'top', order: 'desc', operator: 'best' }
  ], ['best_ms', 'top']);
  rk.submit('time', 'a', 120); rk.submit('time', 'a', 90); rk.submit('time', 'a', 200);
  rk.submit('time', 'b', 100);
  assert.deepEqual(rk.standings('time'), [{ player: 'a', value: 90 }, { player: 'b', value: 100 }], '升序 + best 保最小');
  rk.submit('score', 'a', 10); rk.submit('score', 'b', 30); rk.submit('score', 'b', 20);
  assert.deepEqual(rk.standings('score'), [{ player: 'b', value: 30 }, { player: 'a', value: 10 }], '降序 + best 保最大');
});

test('排行：weekly/biweekly 周期分桶，翻转即新榜', () => {
  const WEEK = 7 * 86400000;
  const rk = S.createRank([{ id: 'wk', metric: 'pts', order: 'desc', operator: 'increment', period: 'weekly' }], ['pts']);
  rk.submit('wk', 'p', 5, 0); rk.submit('wk', 'p', 4, WEEK - 1);
  assert.deepEqual(rk.standings('wk', 0), [{ player: 'p', value: 9 }], '同周累计');
  assert.deepEqual(rk.standings('wk', WEEK), [], '翻周清零');
  const bi = S.createRank([{ id: 'b', metric: 'pts', order: 'desc', operator: 'increment', period: 'biweekly' }], ['pts']);
  bi.submit('b', 'p', 1, 13 * 86400000);
  assert.deepEqual(bi.standings('b', 13 * 86400000), [{ player: 'p', value: 1 }], '双周同桶');
});

test('fail-fast：未知 agg/缺 field/重复 key/未知键/metric 越界/未知 order/operator/period 一律加载期抛错', () => {
  assert.throws(() => S.createArchive('x'), /必须是数组/);
  assert.throws(() => S.createArchive([{ key: 'a', event: 'e', agg: 'avg' }]), /未知 agg/);
  assert.throws(() => S.createArchive([{ key: 'a', event: 'e', agg: 'sum' }]), /必须声明 field/);
  assert.throws(() => S.createArchive([{ key: 'a', event: 'e', agg: 'count', field: 'x' }]), /不接受 field/);
  assert.throws(() => S.createArchive([{ key: 'a', event: 'e', agg: 'count' }, { key: 'a', event: 'e', agg: 'count' }]), /重复/);
  assert.throws(() => S.createArchive([{ key: 'a', agg: 'count' }]), /必须声明 event/);
  assert.throws(() => S.createArchive([{ key: 'a', event: 'e', agg: 'count', theme: 'x' }]), /未知键/);
  assert.throws(() => S.createRank([{ id: 'x', metric: 'ghost', order: 'asc', operator: 'best' }], ['a']), /不在已声明统计项集合内/);
  assert.throws(() => S.createRank([{ id: 'x', metric: 'a', order: 'up', operator: 'best' }], ['a']), /未知 order/);
  assert.throws(() => S.createRank([{ id: 'x', metric: 'a', order: 'asc', operator: 'set' }], ['a']), /未知 operator/);
  assert.throws(() => S.createRank([{ id: 'x', metric: 'a', order: 'asc', operator: 'best', period: 'daily' }], ['a']), /未知 period/);
  assert.throws(() => S.createRank([{ id: 'x', metric: 'a', order: 'asc', operator: 'best', reset: 'cron' }], ['a']), /未知键/);
});

test('运行期硬闸：未声明 statKey/未知榜/非法事件字段/非法提交值', () => {
  const ar = S.createArchive([{ key: 'total', event: 'ev', agg: 'sum', field: 'x' }]);
  assert.throws(() => ar.get('ghost'), /未声明 statKey/);
  assert.throws(() => ar.onEvent('ev', { x: 'NaN 串' }), /必须是有限数/);
  const rk = S.createRank([{ id: 't', metric: 'total', order: 'asc', operator: 'best' }], ['total']);
  assert.throws(() => rk.submit('ghost', 'p', 1), /未知榜/);
  assert.throws(() => rk.submit('t', '', 1), /非空字符串/);
  assert.throws(() => rk.submit('t', 'p', Infinity), /有限数/);
});
