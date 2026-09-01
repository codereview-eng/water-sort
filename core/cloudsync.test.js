'use strict';
/* 门禁：多端账目同步的调度规则（core/cloudsync.js）。
   用户实报（2026-09-01）：「一个用户在多个浏览器都打开，金币经常变化，不同浏览器不一样，
   有时突然变多有时突然变少」——根因是客户端只在启动时读一次云端，之后整场只写不读。
   这些断言就是那份规则的机器可执行版本：
     ① 前台按周期拉；② 页面不可见不拉、回前台立刻补；③ 频控与并发不重复打服务器；
     ④ 超时/失败不阻塞玩法且指数退避；⑤ 失败原因必须可观测（不许裸吞异常）。 */
const test = require('node:test');
const assert = require('node:assert');
const CloudSync = require('./cloudsync.js');

// 可控时钟 + 可控定时器：不用真等 45 秒
function harness(overrides) {
  let now = 1000;
  let seq = 0;
  const timers = new Map();
  const events = [];
  const ctl = {
    now: () => now,
    events,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    /* 推进时间并触发到点的定时器（按到点顺序） */
    advance: async (ms) => {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        const [id, t] = due[0];
        timers.delete(id);
        now = t.at;
        t.fn();
        // 排空整条微任务链（拉取 → apply → 重新排期都发生在 then 里）
        await new Promise((r) => setImmediate(r));
      }
      now = target;
      await new Promise((r) => setImmediate(r));
    },
  };
  const opts = Object.assign({
    now: ctl.now, setTimer: ctl.setTimer, clearTimer: ctl.clearTimer,
    onEvent: (e, d) => events.push(Object.assign({ e }, d)),
    pull: () => Promise.resolve({ coins_earned: 10, coins_spent: 0 }),
    apply: () => ({ changed: false }),
  }, overrides || {});
  return { ctl, sync: CloudSync.create(opts) };
}
const names = (events) => events.map((x) => x.e);

test('前台按周期自动拉取（默认 45 秒一次）', async () => {
  let pulls = 0;
  const { ctl, sync } = harness({ pull: () => { pulls++; return Promise.resolve({}); } });
  sync.start();
  assert.strictEqual(pulls, 0, 'start 时不该立刻打服务器（初始化那次由页面自己做）');
  await ctl.advance(45000);
  assert.strictEqual(pulls, 1);
  await ctl.advance(45000);
  assert.strictEqual(pulls, 2, '周期要能自我延续，不是只跑一次');
  sync.stop();
  await ctl.advance(45000 * 3);
  assert.strictEqual(pulls, 2, 'stop 之后不许再拉');
});

test('页面不可见不拉；回到前台立刻补一次', async () => {
  let pulls = 0, visible = false;
  const { ctl, sync } = harness({ pull: () => { pulls++; return Promise.resolve({}); }, isVisible: () => visible });
  sync.start();
  await ctl.advance(45000 * 2);
  assert.strictEqual(pulls, 0, '后台标签页拉了也没人看，纯浪费电量与配额');
  assert.ok(ctl.events.some((x) => x.e === 'sync_skip' && x.why === 'hidden'));
  visible = true;
  await sync.onVisible();
  assert.strictEqual(pulls, 1, '回前台必须立刻补一次：后台期间别的设备可能花过钱');
});

test('频控：4 秒内的重复触发不重复打服务器，但不当成失败', async () => {
  let pulls = 0;
  const { ctl, sync } = harness({ pull: () => { pulls++; return Promise.resolve({}); } });
  await sync.pullNow('home');
  const r = await sync.pullNow('shop');
  assert.strictEqual(pulls, 1, '两次触发撞在一起只该真拉一次');
  assert.strictEqual(r.skipped, 'gap');
  assert.strictEqual(r.ok, true, '被频控挡掉不是失败——调用方照常按本地值继续');
  await ctl.advance(5000);
  await sync.pullNow('home');
  assert.strictEqual(pulls, 2, '过了最小间隔要能再拉');
});

test('并发：同一时刻只有一个在飞的请求，重复调用复用同一个 Promise', async () => {
  let pulls = 0, resolve;
  const { sync } = harness({ pull: () => { pulls++; return new Promise((r) => { resolve = r; }); } });
  const a = sync.pullNow('home');
  const b = sync.pullNow('before-spend');
  assert.strictEqual(pulls, 1);
  assert.strictEqual(a, b, '第二次调用应直接拿到同一个在飞的 Promise');
  resolve({});
  await a;
});

test('花钱前的同步超时了也不能卡住玩法：按失败返回，调用方照常继续', async () => {
  const { ctl, sync } = harness({ pull: () => new Promise(() => {}), timeoutMs: 1500 });
  const p = sync.pullNow('before-spend');
  await ctl.advance(1500);
  const r = await p;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.why, 'timeout');
  assert.ok(ctl.events.some((x) => x.e === 'sync_fail' && x.why === 'timeout' && x.ms === 1500));
});

test('失败要指数退避并封顶，成功立刻复位', async () => {
  let fail = true;
  const { ctl, sync } = harness({
    pull: () => (fail ? Promise.reject(Object.assign(new Error('offline'), { name: 'TypeError' })) : Promise.resolve({})),
    pullMs: 1000, backoffMaxMs: 8000,
  });
  sync.start();
  await ctl.advance(1000);                      // 第 1 次失败 → 下次 2s
  assert.strictEqual(sync.state().failStreak, 1);
  assert.strictEqual(sync.state().nextMs, 2000);
  await ctl.advance(2000);                      // 第 2 次失败 → 4s
  assert.strictEqual(sync.state().nextMs, 4000);
  await ctl.advance(4000);                      // 第 3 次 → 8s（封顶）
  assert.strictEqual(sync.state().nextMs, 8000);
  await ctl.advance(8000);
  assert.strictEqual(sync.state().nextMs, 8000, '退避必须封顶，不能越拖越久到天荒地老');
  fail = false;
  await ctl.advance(8000);
  assert.strictEqual(sync.state().failStreak, 0, '成功一次就复位');
  assert.strictEqual(sync.state().nextMs, 1000);
});

test('失败原因必须可观测：err_name + err_msg 都要落到事件里（不许裸吞）', async () => {
  const { ctl, sync } = harness({
    pull: () => Promise.reject(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' })),
  });
  await sync.pullNow('timer');
  const f = ctl.events.find((x) => x.e === 'sync_fail');
  assert.ok(f, '失败必须发事件');
  assert.strictEqual(f.err_name, 'TypeError');
  assert.match(f.err_msg, /Failed to fetch/);
});

test('合并有变化时报 sync_applied 并带上余额与变化量；没变化报 sync_same', async () => {
  let balance = 120;
  const { ctl, sync } = harness({
    apply: () => ({ changed: balance !== 120, delta: balance - 120, balance: balance }),
  });
  await sync.pullNow('home');
  assert.ok(ctl.events.some((x) => x.e === 'sync_same'));
  balance = 20;                                   // 另一台设备花掉了 100
  await sync.pullNow('visible', true);
  const ap = ctl.events.find((x) => x.e === 'sync_applied');
  assert.ok(ap, '账目被别端改动时必须报 applied');
  assert.strictEqual(ap.delta, -100);
  assert.strictEqual(ap.balance, 20);
  assert.strictEqual(sync.state().applied, 1);
});

test('apply 抛错不许把定时器打死：记 fail 事件，周期继续', async () => {
  const { ctl, sync } = harness({
    pullMs: 1000,
    apply: () => { throw Object.assign(new Error('bad row'), { name: 'TypeError' }); },
  });
  sync.start();
  await ctl.advance(1000);
  assert.ok(ctl.events.some((x) => x.e === 'sync_fail' && x.why === 'apply'));
  await ctl.advance(1000);
  assert.strictEqual(sync.state().pulls, 2, 'apply 出错后周期还得继续跑');
});

test('注入缺失直接报错（拉取与合并都是必需品，不给静默默认值）', () => {
  assert.throws(() => CloudSync.create({ apply: () => ({}) }), /pull/);
  assert.throws(() => CloudSync.create({ pull: () => Promise.resolve({}) }), /apply/);
});

test('事件序列自解释：start → pull → applied/same，排障时一眼看懂', async () => {
  const { ctl, sync } = harness({ apply: () => ({ changed: true, delta: 5, balance: 15 }), pullMs: 1000 });
  sync.start();
  await ctl.advance(1000);
  assert.deepStrictEqual(names(ctl.events).slice(0, 3), ['sync_start', 'sync_pull', 'sync_applied']);
});
