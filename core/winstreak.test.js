/* 双连胜 core 单元测试：A 大连胜（保持/清零/门槛）+ B 奖励票（出票/冻结/领取）
   + A/B 独立性 + fail-fast 配置校验（2026-08-24 需求定案）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const K = require('./winstreak.js');

const CFG = { enabled: true }; // 缺省：keepMinPrompt 3 / every 10 / rewards {60,10,10}

function winN(s, st, n) { for (let i = 0; i < n; i++) st = s.win(st).state; return st; }

test('默认配置 = 无此系统（入口不渲染、API 调用即拒）', () => {
  for (const s of [K.create(null), K.create({ enabled: false })]) {
    assert.equal(s.visible(), false);
    assert.equal(s.hasTicket({}), false);
    assert.throws(() => s.win({}), /未开启/);
    assert.throws(() => s.claim({}), /未开启/);
  }
});

test('配置 fail-fast：未知键 / 非法值 / 全零奖励', () => {
  assert.throws(() => K.create({ enabled: true, foo: 1 }), /未知键/);
  assert.throws(() => K.create({ enabled: true, every: 1 }), /every/);
  assert.throws(() => K.create({ enabled: true, keepMinPrompt: 0 }), /keepMinPrompt/);
  assert.throws(() => K.create({ enabled: true, rewards: { gems: 5 } }), /rewards 未知键/);
  assert.throws(() => K.create({ enabled: true, rewards: { energy: -1 } }), /rewards\.energy/);
  assert.throws(() => K.create({ enabled: true, rewards: { energy: 0, coins: 0, frags: 0 } }), /不能全为 0/);
  assert.throws(() => K.create({ enabled: 1 }), /enabled/);
});

test('A：胜利只增不封顶；小连胜断了静默清零（< keepMinPrompt 不弹）', () => {
  const s = K.create(CFG);
  let st = winN(s, s.init(), 2);
  assert.equal(st.cur, 2);
  const r = s.lose(st);
  assert.equal(r.outcome, 'reset');
  assert.equal(r.state.cur, 0);
  assert.equal(r.state.pend, false);
});

test('A：连胜 >= keepMinPrompt 断链挂 pend，keep 保原值 / drop 清零', () => {
  const s = K.create(CFG);
  let st = winN(s, s.init(), 5);
  const r = s.lose(st);
  assert.equal(r.outcome, 'prompt');
  assert.equal(r.state.pend, true);
  assert.equal(r.state.cur, 5, 'pend 期间大连胜数字保留');
  assert.equal(s.keep(r.state).cur, 5, '看广告保持原值');
  assert.equal(s.keep(r.state).pend, false);
  assert.equal(s.drop(r.state).cur, 0, '拒绝清零');
  // pend 未决时禁止直接开下一局记胜负（宿主必须先 keep/drop）
  assert.throws(() => s.win(r.state), /未决/);
  assert.throws(() => s.lose(r.state), /未决/);
  // keep 后继续赢，连胜接着涨（没有最高只有更高）
  assert.equal(winN(s, s.keep(r.state), 3).cur, 8);
});

test('A：keepMinPrompt 可配（=1 时任何断链都弹）', () => {
  const s = K.create({ enabled: true, keepMinPrompt: 1 });
  const st = winN(s, s.init(), 1);
  assert.equal(s.lose(st).outcome, 'prompt');
});

test('B：数到 every 出票；冻结在 every/every 不叠加；失败票仍在', () => {
  const s = K.create({ enabled: true, every: 3 });
  let st = winN(s, s.init(), 2);
  assert.equal(st.cyc, 2);
  assert.equal(s.hasTicket(st), false);
  const r3 = s.win(st);
  assert.equal(r3.ticket, true, '第 every 胜出票');
  st = r3.state;
  assert.equal(s.hasTicket(st), true);
  assert.equal(s.cycleShown(st), 3, '展示冻结在 every/every');
  // 有票期间继续赢：不叠加第二张票（用户拍板）
  const r4 = s.win(st);
  assert.equal(r4.ticket, false);
  assert.equal(r4.state.earned, 1);
  assert.equal(s.cycleShown(r4.state), 3);
  // 有票期间失败：票与冻结展示都保留（用户拍板：哪怕以后失败还是 10/10 状态）
  const lost = s.lose(r4.state).state;
  assert.equal(s.hasTicket(lost), true);
  assert.equal(s.cycleShown(lost), 3);
});

test('B：无票时失败周期清零（连胜语义）', () => {
  const s = K.create({ enabled: true, every: 3, keepMinPrompt: 99 });
  let st = winN(s, s.init(), 2);
  st = s.lose(st).state;
  assert.equal(st.cyc, 0);
});

test('B：claim 核销票、周期归零、奖励数值按 config 透传；无票即拒', () => {
  const s = K.create({ enabled: true, every: 2, rewards: { energy: 60, coins: 10, frags: 10 } });
  let st = winN(s, s.init(), 2);
  const c = s.claim(st);
  assert.deepEqual(c.rewards, { energy: 60, coins: 10, frags: 10 });
  assert.equal(c.state.claimed, 1);
  assert.equal(c.state.cyc, 0, '领取后从 0 重新累积');
  assert.equal(s.hasTicket(c.state), false);
  assert.throws(() => s.claim(c.state), /没有可领取/);
  // 领取后再连赢 every 盘，第二张票照常出
  assert.equal(winN(s, c.state, 2).earned, 2);
});

test('B：rewards 支持部分通道为 0（周活动关闭的游戏 frags 配 0）', () => {
  const s = K.create({ enabled: true, rewards: { energy: 30, coins: 5, frags: 0 } });
  assert.deepEqual(s.rewards(), { energy: 30, coins: 5, frags: 0 });
});

test('A/B 独立：失败瞬间 B 清零，A 的 keep 不救 B 周期（用户拍板）', () => {
  const s = K.create({ enabled: true, every: 10 });
  let st = winN(s, s.init(), 7);          // A=7, B=7/10
  const r = s.lose(st);
  assert.equal(r.state.cyc, 0, 'B 周期在失败瞬间清零，不等弹窗');
  const kept = s.keep(r.state);
  assert.equal(kept.cur, 7, 'A 保住');
  assert.equal(kept.cyc, 0, 'B 不被广告救回');
});

test('from：持久化恢复防损坏（缺字段/负数/倒挂/越界一律收敛）', () => {
  const s = K.create(CFG);
  assert.deepEqual(s.from(null), s.init());
  assert.deepEqual(s.from({ cur: -3, cyc: 99, earned: 1, claimed: 5, pend: 'x' }),
    { cur: 0, pend: false, cyc: 10, earned: 1, claimed: 1 });
  assert.deepEqual(s.from({ cur: 4, pend: 1, cyc: 2, earned: 3, claimed: 1 }),
    { cur: 4, pend: true, cyc: 2, earned: 3, claimed: 1 });
});
