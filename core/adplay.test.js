'use strict';
/* core/adplay.js 单测：广告播放层
   背景（2026-08-21 RCA）：core/placements.js 一直要求宿主注入 provider（「放一次广告并回报成败」），
   但从没人实现过，于是两个游戏的「看广告」点了直接发奖 —— Telegram 和浏览器里都不会出现广告。
   这个文件锁住新播放层的三条底线：
     ① 没看完不给奖（宁可不发，也不能"点一下就拿"）；
     ② 广告源不可用时按 config 顺序降级，最终有兜底；
     ③ 每次失败都可观测（stats + reason），能发现"常态化降级"。 */
const test = require('node:test');
const assert = require('node:assert');
const AdPlay = require('./adplay.js');
const Placements = require('./placements.js');

/* 各种环境的假 window */
function envTelegram(result) {
  return { Telegram: { WebApp: { showAd: () => Promise.resolve(result) } } };
}
function envAdsgram(behavior) {
  return { Adsgram: { init: () => ({ show: () => behavior === 'ok' ? Promise.resolve() : Promise.reject({ description: behavior }) }) } };
}
const houseWatched = (sec, done) => done(true);
const houseSkipped = (sec, done) => done(false);

test('config fail-fast：未知广告源 / 非法参数一律加载期抛错', () => {
  assert.throws(() => AdPlay.create({ sources: [] }), /非空数组/);
  assert.throws(() => AdPlay.create({ sources: ['nope'] }), /未知广告源/);
  assert.throws(() => AdPlay.create({ houseSeconds: 0 }), /houseSeconds/);
  assert.throws(() => AdPlay.create({ timeoutMs: -1 }), /timeoutMs/);
  assert.throws(() => AdPlay.create({ blockId: '' }), /blockId/);
  assert.throws(() => AdPlay.create([]), /必须是对象/);
});

test('缺省配置：源顺序 telegram → adsgram → house（house 兜底保证游戏能继续玩）', () => {
  const a = AdPlay.create(null, { houseAd: houseWatched });
  assert.deepStrictEqual(a.sources, ['telegram', 'adsgram', 'house']);
  assert.strictEqual(a.houseSeconds, 5);
});

test('每个游戏可以配自己的广告源与参数', async () => {
  const a = AdPlay.create({ sources: ['adsgram', 'house'], blockId: 'blk-123', houseSeconds: 8 },
    { env: envAdsgram('ok'), houseAd: houseWatched });
  assert.deepStrictEqual(a.sources, ['adsgram', 'house']);
  assert.strictEqual(a.blockId, 'blk-123');
  assert.strictEqual(a.houseSeconds, 8);
  const r = await a.play();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.source, 'adsgram', '按配置优先用 adsgram');
});

test('可用性判定：没有对应能力的源不参与（不会假装能放）', () => {
  const none = AdPlay.create(null, { env: {} });          // 没 Telegram、没 Adsgram、没注入 houseAd
  const av = none.availability();
  assert.strictEqual(av.telegram, false);
  assert.strictEqual(av.adsgram, false);
  assert.strictEqual(av.house, false, '宿主没注入 houseAd 时 house 不可用');
});

test('Telegram 激励广告：看完才算成功', async () => {
  const okA = AdPlay.create({ sources: ['telegram'] }, { env: envTelegram({ status: 'ok' }) });
  assert.strictEqual((await okA.play()).ok, true);
  // 各种"没看完"的形态都必须判失败 —— 这是不发错奖的底线
  for (const bad of [false, { status: 'skipped' }, { completed: false }, { status: 'error' }]) {
    const a = AdPlay.create({ sources: ['telegram'] }, { env: envTelegram(bad) });
    const r = await a.play();
    assert.strictEqual(r.ok, false, '未看完必须判失败：' + JSON.stringify(bad));
  }
});

test('降级链：前面的源失败 → 自动落到下一个源', async () => {
  // Telegram 报错（不是用户放弃）→ 降级到 house，house 看完 → 成功
  const env = { Telegram: { WebApp: { showAd: () => Promise.reject(new Error('boom')) } } };
  const a = AdPlay.create({ sources: ['telegram', 'house'] }, { env, houseAd: houseWatched });
  const r = await a.play();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.source, 'house', '降级到兜底源');
  const s = a.stats();
  assert.strictEqual(s.bySource.telegram.failed, 1, '失败被记账');
  assert.strictEqual(s.bySource.house.ok, 1);
});

test('用户主动放弃 → 不再降级（他不是没广告，是不想看）', async () => {
  const a = AdPlay.create({ sources: ['house', 'telegram'] },
    { env: envTelegram({ status: 'ok' }), houseAd: houseSkipped });
  const r = await a.play();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'skipped');
  assert.strictEqual(a.stats().bySource.telegram, undefined, '放弃后不该再去试别的源');
});

test('全部源不可用 → 明确失败，不静默假成功', async () => {
  const a = AdPlay.create({ sources: ['telegram', 'adsgram'] }, { env: {} });
  const r = await a.play();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-source');
  assert.strictEqual(a.stats().failed, 1);
});

test('超时按失败处理（卡住的广告不能永远挂着游戏）', async () => {
  const env = { Telegram: { WebApp: { showAd: () => new Promise(() => {}) } } };  // 永不 resolve
  const a = AdPlay.create({ sources: ['telegram', 'house'], timeoutMs: 30 }, { env, houseAd: houseWatched });
  const r = await a.play();
  assert.strictEqual(r.ok, true, '超时后降级到 house 仍能完成');
  assert.strictEqual(a.stats().bySource.telegram.failed, 1);
  assert.strictEqual(a.stats().lastReason, 'timeout');
});

test('可观测：stats 能看出「常态化降级」（本机硬纪律要求）', async () => {
  const env = { Telegram: { WebApp: { showAd: () => Promise.resolve(false) } } };
  const a = AdPlay.create({ sources: ['telegram', 'house'] }, { env, houseAd: houseWatched });
  await a.play(); await a.play(); await a.play();
  const s = a.stats();
  assert.strictEqual(s.attempts >= 3, true);
  assert.strictEqual(s.bySource.telegram.failed, 3, '3 次全落在降级上 —— 这就是要能看出来的信号');
  assert.strictEqual(s.lastReason, 'declined');
});

test('与 placements 串起来：广告结果决定是否发奖，core 自己不代发', async () => {
  const cfg = { 'tool-refill': { format: 'rewarded', onFail: 'deny' } };
  // 看完 → 允许发奖
  const a = AdPlay.create({ sources: ['house'] }, { houseAd: houseWatched });
  const got = await a.playPlacement(Placements.create(cfg, () => false), 'tool-refill', {});
  assert.strictEqual(got.granted, true, '看完了 → 允许发奖');
  assert.strictEqual(got.ad.source, 'house');
  assert.ok(got.state && got.state.sessionN === 1, '频控状态回传给宿主保存');

  // 没看完 + onFail:'deny' → 不发奖（这条是本次 RCA 的核心）
  const a2 = AdPlay.create({ sources: ['house'] }, { houseAd: houseSkipped });
  const got2 = await a2.playPlacement(Placements.create(cfg, () => true), 'tool-refill', {});
  assert.strictEqual(got2.granted, false, '没看完不给奖');

  // onFail:'grant' 是配置显式声明的宽容位 → 放弃也给
  const a3 = AdPlay.create({ sources: ['house'] }, { houseAd: houseSkipped });
  const got3 = await a3.playPlacement(
    Placements.create({ 'streak-claim': { format: 'rewarded', onFail: 'grant' } }, () => true), 'streak-claim', {});
  assert.strictEqual(got3.granted, true, 'onFail:grant 由 config 决定，不是代码里偷偷放水');

  // 频控生效：maxPerSession=1 时第二次直接不播（shown:false，也不发奖）
  const capped = Placements.create({ 'time-bonus': { format: 'rewarded', onFail: 'deny', capping: { maxPerSession: 1 } } }, () => true);
  const a4 = AdPlay.create({ sources: ['house'] }, { houseAd: houseWatched });
  const r1 = await a4.playPlacement(capped, 'time-bonus', {});
  const r2 = await a4.playPlacement(capped, 'time-bonus', r1.state);
  assert.strictEqual(r1.granted, true);
  assert.strictEqual(r2.shown, false, '超出每场上限 → 不播');
  assert.strictEqual(r2.granted, false);
});

test('没有 placements 配置时也能单独用（宿主自己判发奖）', async () => {
  const a = AdPlay.create({ sources: ['house'] }, { houseAd: houseWatched });
  const r = await a.playPlacement(null, 'anything', {});
  assert.strictEqual(r.granted, true);
  const b = AdPlay.create({ sources: ['house'] }, { houseAd: houseSkipped });
  assert.strictEqual((await b.playPlacement(null, 'anything', {})).granted, false);
});

/* ---- Monetag 源（倒水线上一直在用的那家，2026-08-21 提到 core 供两个游戏共用）---- */
function envMonetag(zone, behavior) {
  const env = {};
  env['show_' + zone] = () => behavior === 'ok' ? Promise.resolve()
    : behavior === 'throw' ? (() => { throw new Error('boom'); })()
    : Promise.reject(new Error('no-fill'));
  return env;
}

test('monetag：配了 zoneId 且 SDK 挂上 show_<zone> 才算可用', () => {
  const noZone = AdPlay.create({ sources: ['monetag'] }, { env: envMonetag('999', 'ok') });
  assert.strictEqual(noZone.availability().monetag, false, '没配 zoneId → 不可用');
  const noSdk = AdPlay.create({ sources: ['monetag'], zoneId: '999' }, { env: {} });
  assert.strictEqual(noSdk.availability().monetag, false, 'SDK 没加载 → 不可用');
  const ok = AdPlay.create({ sources: ['monetag'], zoneId: '999' }, { env: envMonetag('999', 'ok') });
  assert.strictEqual(ok.availability().monetag, true);
  assert.strictEqual(ok.zoneId, '999');
});

test('monetag：resolve = 看完发奖；reject/抛错 = 未完成并降级', async () => {
  const good = AdPlay.create({ sources: ['monetag'], zoneId: 'z1' }, { env: envMonetag('z1', 'ok') });
  const r = await good.play();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.source, 'monetag');

  // 没有填充（no-fill）→ 判失败并降级到 house
  const bad = AdPlay.create({ sources: ['monetag', 'house'], zoneId: 'z1' },
    { env: envMonetag('z1', 'reject'), houseAd: houseWatched });
  const r2 = await bad.play();
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.source, 'house', 'monetag 无填充时降级到兜底');
  assert.strictEqual(bad.stats().bySource.monetag.failed, 1);
});

test('两个游戏可以用完全不同的广告源组合（可配性双向断言）', () => {
  // 倒水：Monetag（线上已有 zone）→ 兜底
  const water = AdPlay.create({ sources: ['monetag', 'house'], zoneId: '11440777' },
    { env: envMonetag('11440777', 'ok'), houseAd: houseWatched });
  // 彩雷：Telegram 官方 → AdsGram → 兜底
  const mine = AdPlay.create({ sources: ['telegram', 'adsgram', 'house'] },
    { env: envTelegram({ status: 'ok' }), houseAd: houseWatched });
  assert.notDeepStrictEqual(water.sources, mine.sources, '两个游戏的广告源应各自配置');
  assert.strictEqual(water.availability().monetag, true);
  assert.strictEqual(mine.availability().telegram, true);
  assert.strictEqual(mine.availability().monetag, false, '彩雷没配 zone → monetag 不参与');
  // 但两边最后都有 house 兜底，保证玩家永远能拿到奖励入口
  for (const a of [water, mine]) assert.strictEqual(a.sources[a.sources.length - 1], 'house');
});

/* ---- 环境分流（2026-08-21）：Monetag 的 TMA zone 与 Website zone 是两条独立通道 ----
   TMA zone 的前提是在 Telegram WebView 内经 bot 的 Web App API 启动；
   普通浏览器访问属于 web 流量，必须用 Website 广告位的 zone。
   所以同一个游戏要配两个 zone，按运行环境自动选，而不是共用一个。 */
const envInTelegram = (extra) => Object.assign({
  Telegram: { WebApp: { initData: 'query_id=AAA', initDataUnsafe: { user: { id: 7 } } } }
}, extra || {});
const envPlainWeb = (extra) => Object.assign({}, extra || {});

function monetagSdk(zone, behavior) {
  const o = {};
  o['show_' + zone] = () => behavior === 'ok' ? Promise.resolve() : Promise.reject(new Error('no-fill'));
  return o;
}

test('inTelegram：只看 Telegram.WebApp 存在不够，要有 initData / user', () => {
  const a = AdPlay.create({ sources: ['house'] }, { env: envInTelegram(), houseAd: houseWatched });
  assert.strictEqual(a.inTelegram(), true);
  // 网页里也可能引了 telegram-web-app.js，但没有 initData → 不算在 Telegram 内
  const b = AdPlay.create({ sources: ['house'] },
    { env: { Telegram: { WebApp: { initData: '', initDataUnsafe: {} } } }, houseAd: houseWatched });
  assert.strictEqual(b.inTelegram(), false, '空 initData 不能当成 Telegram 环境');
  const c = AdPlay.create({ sources: ['house'] }, { env: envPlainWeb(), houseAd: houseWatched });
  assert.strictEqual(c.inTelegram(), false);
});

test('两个 zone 按环境自动选：Telegram 内用 TMA zone，浏览器用 Web zone', async () => {
  const cfg = {
    sources: [
      { type: 'monetag', zoneId: 'TMA', env: 'telegram' },
      { type: 'monetag', zoneId: 'WEB', env: 'web' },
      { type: 'house' }
    ]
  };
  // 在 Telegram 内：只有 TMA zone 可用，且真的播的是它
  const inTg = AdPlay.create(cfg, {
    env: envInTelegram(Object.assign(monetagSdk('TMA', 'ok'), monetagSdk('WEB', 'ok'))),
    houseAd: houseWatched
  });
  const r1 = await inTg.play();
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.source, 'monetag');
  assert.strictEqual(r1.zone, 'TMA', 'Telegram 内必须用 TMA zone');
  assert.deepStrictEqual(inTg.availability().detail.map((d) => d.usable), [true, false, true],
    'web 限定的源在 Telegram 内不可用');

  // 在浏览器：只有 Web zone 可用
  const inWeb = AdPlay.create(cfg, {
    env: envPlainWeb(Object.assign(monetagSdk('TMA', 'ok'), monetagSdk('WEB', 'ok'))),
    houseAd: houseWatched
  });
  const r2 = await inWeb.play();
  assert.strictEqual(r2.zone, 'WEB', '浏览器里必须用 Website zone');
  assert.strictEqual(inWeb.availability().env, 'web');
});

test('Web zone 没配好时：浏览器里降级到兜底卡，而不是去用 TMA zone', async () => {
  // 只配了 TMA zone（限定 telegram）→ 浏览器里它不参与，落到 house
  const a = AdPlay.create({
    sources: [{ type: 'monetag', zoneId: 'TMA', env: 'telegram' }, { type: 'house' }]
  }, { env: envPlainWeb(monetagSdk('TMA', 'ok')), houseAd: houseWatched });
  const r = await a.play();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.source, 'house', '浏览器里不得偷用 TMA zone（会是无效流量）');
  assert.strictEqual(a.stats().bySource.monetag, undefined, 'TMA zone 完全没被尝试');
});

test('SDK 按需加载：只加载当前环境要用的那个 zone', async () => {
  const loaded = [];
  const env = envInTelegram();                       // 一开始两个 zone 的 SDK 都没加载
  const a = AdPlay.create({
    sources: [{ type: 'monetag', zoneId: 'TMA', env: 'telegram' },
      { type: 'monetag', zoneId: 'WEB', env: 'web' }, { type: 'house' }]
  }, {
    env,
    houseAd: houseWatched,
    loadSdk: (zone) => { loaded.push(zone); Object.assign(env, monetagSdk(zone, 'ok')); return Promise.resolve(); }
  });
  const r = await a.play();
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(loaded, ['TMA'], '只加载 Telegram 环境要用的那个 zone');
});

test('SDK 加载失败 / 缺失 → 判失败并降级（不静默假成功）', async () => {
  const a = AdPlay.create({ sources: [{ type: 'monetag', zoneId: 'Z' }, { type: 'house' }] },
    { env: envPlainWeb(), houseAd: houseWatched, loadSdk: () => Promise.reject(new Error('blocked')) });
  const r = await a.play();
  assert.strictEqual(r.source, 'house');
  assert.ok(/sdk-load-failed/.test(a.stats().lastReason), '失败原因要能看出是 SDK 没加载上');
});

test('config fail-fast：env 只能是 telegram / web', () => {
  assert.throws(() => AdPlay.create({ sources: [{ type: 'house', env: 'ios' }] }), /只能是 telegram 或 web/);
  assert.throws(() => AdPlay.create({ sources: [{ type: 'monetag', zoneId: '' }] }), /zoneId 必须是非空字符串/);
  assert.throws(() => AdPlay.create({ sources: [123] }), /必须是字符串或对象/);
});

test('向后兼容：老的字符串简写 + 顶层 zoneId 行为不变', async () => {
  const a = AdPlay.create({ sources: ['monetag', 'house'], zoneId: 'OLD' },
    { env: envPlainWeb(monetagSdk('OLD', 'ok')), houseAd: houseWatched });
  assert.deepStrictEqual(a.sources, ['monetag', 'house']);
  const r = await a.play();
  assert.strictEqual(r.zone, 'OLD', '源上没写 zone 时回落到顶层 zoneId');
});

/* ---- Direct Link（2026-08-21）：Monetag 网站类六种格式里唯一玩家主动触发、可驱动奖励的一种 ----
   2026-08-29 收紧（issue #1）：判据从「标签开了」改成「真的离开且停留够久才回来」。
   旧判据实测 0.24 秒能白拿一个道具，等于按钮直接发奖。 */

/* 假 document：能控制 visibilityState 并派发 visibilitychange，用来演玩家切走/切回 */
function fakeDoc() {
  const listeners = [];
  return {
    visibilityState: 'visible',
    addEventListener: (t, fn) => { if (t === 'visibilitychange') listeners.push(fn); },
    removeEventListener: (t, fn) => {
      const i = listeners.indexOf(fn); if (t === 'visibilitychange' && i >= 0) listeners.splice(i, 1);
    },
    fire() { listeners.slice().forEach((fn) => fn()); },
    leave() { this.visibilityState = 'hidden'; this.fire(); },
    back() { this.visibilityState = 'visible'; this.fire(); }
  };
}
/* 可控时钟：每次读表都停在 t 上，测试自己推进 */
function fakeClock() {
  let t = 1000;
  return { now: () => t, advance(ms) { t += ms; } };
}

test('directlink：真的离开且停留够久才回来 → 发奖', async () => {
  const opened = [];
  const doc = fakeDoc(); const clk = fakeClock();
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://omg10.com/4/11622862', env: 'web' }, { type: 'house' }],
    directDwellSec: 5
  }, { env: {}, houseAd: houseWatched, doc, now: clk.now, openUrl: (u) => { opened.push(u); return true; } });
  const p = a.play();
  doc.leave();
  clk.advance(6000);      // 在广告页待了 6 秒
  doc.back();
  const r = await p;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.source, 'directlink');
  assert.deepStrictEqual(opened, ['https://omg10.com/4/11622862']);
});

test('directlink：开了标签立刻关（0.24 秒白嫖那条路）→ 不发奖', async () => {
  const doc = fakeDoc(); const clk = fakeClock();
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://a.com/1', env: 'web' }],
    directDwellSec: 5
  }, { env: {}, doc, now: clk.now, openUrl: () => true });
  const p = a.play();
  doc.leave();
  clk.advance(240);       // spike 实测的滥用速度：0.24 秒
  doc.back();
  const r = await p;
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /^directlink:too-short:/, '原因要带真实停留时长，便于事后判断阈值是否合理');
});

test('directlink：点开之后页面压根没切走 → 判定他没去看', async () => {
  const doc = fakeDoc();
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://a.com/1', env: 'web' }],
    directLeaveWaitSec: 0.05
  }, { env: {}, doc, openUrl: () => true });
  const r = await a.play();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'directlink:no-leave');
  assert.strictEqual(a.stats().reasons['directlink:no-leave'], 1, 'no-leave 必须可计数：某些 webview 不触发 visibilitychange，常态化 no-leave 是误伤诚实玩家的信号');
});

test('directlink：玩家在广告页待多久是他的自由，不设硬超时', async () => {
  const doc = fakeDoc(); const clk = fakeClock();
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://a.com/1', env: 'web' }],
    directDwellSec: 5, timeoutMs: 30       // 故意把通用超时设得极短
  }, { env: {}, doc, now: clk.now, openUrl: () => true });
  const p = a.play();
  doc.leave();
  await new Promise((r) => setTimeout(r, 60));   // 真等过通用超时
  clk.advance(120000);                            // 他看了两分钟
  doc.back();
  assert.strictEqual((await p).ok, true, '认真看广告的人不能被 20 秒硬超时判死');
});

test('directlink：拿不到 document → 没有任何"看完"证据，不发奖', async () => {
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://a.com/1', env: 'web' }, { type: 'house' }]
  }, { env: {}, houseAd: houseWatched, doc: null, openUrl: () => true });
  const r = await a.play();
  assert.strictEqual(r.source, 'house', '没有可见性 API 就降级到兜底卡，而不是白发奖');
});

test('directDwellSec / directLeaveWaitSec 非法值加载期抛错', () => {
  assert.throws(() => AdPlay.create({ sources: ['house'], directDwellSec: -1 }), /directDwellSec/);
  assert.throws(() => AdPlay.create({ sources: ['house'], directLeaveWaitSec: 0 }), /directLeaveWaitSec/);
});

test('directlink：弹窗被拦 → 判失败并降级，不能白发奖', async () => {
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://omg10.com/4/1' }, { type: 'house' }]
  }, { env: {}, houseAd: houseWatched, openUrl: () => false });   // 浏览器拦弹窗
  const r = await a.play();
  assert.strictEqual(r.source, 'house', '被拦时必须降级到兜底卡');
  assert.strictEqual(a.stats().lastReason, 'directlink:blocked');
});

test('directlink：openUrl 抛异常也不白发奖，且原因可查', async () => {
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://omg10.com/4/1' }, { type: 'house' }]
  }, { env: {}, houseAd: houseWatched, openUrl: () => { const e = new Error('x'); e.name = 'SecurityError'; throw e; } });
  const r = await a.play();
  assert.strictEqual(r.source, 'house');
  assert.match(a.stats().lastReason, /directlink:error:SecurityError/, '降级原因必须带异常本体');
});

test('directlink：env=web 限定 → Telegram 内不开外部标签（体验灾难）', async () => {
  const opened = [];
  const cfg = {
    sources: [{ type: 'directlink', url: 'https://omg10.com/4/1', env: 'web' }, { type: 'house' }]
  };
  const tgEnv = { Telegram: { WebApp: { initData: 'x', initDataUnsafe: { user: { id: 1 } } } } };
  const a = AdPlay.create(cfg, { env: tgEnv, houseAd: houseWatched, openUrl: (u) => { opened.push(u); return true; } });
  const r = await a.play();
  assert.strictEqual(r.source, 'house');
  assert.deepStrictEqual(opened, [], 'Telegram 内一次都不该打开外部链接');
});

test('directlink：没注入 openUrl 或缺 url → 该源不可用', () => {
  const noOpen = AdPlay.create({ sources: [{ type: 'directlink', url: 'https://a.com/1' }, { type: 'house' }] },
    { env: {}, houseAd: houseWatched });
  assert.strictEqual(noOpen.availability().directlink, false, '宿主没给 openUrl 就不该声称可用');
  const noUrl = AdPlay.create({ sources: [{ type: 'directlink' }, { type: 'house' }] },
    { env: {}, houseAd: houseWatched, openUrl: () => true });
  assert.strictEqual(noUrl.availability().directlink, false, '没 url 不该声称可用');
});

test('directlink：url 必须是 https（防止配成 http 或垃圾值）', () => {
  assert.throws(() => AdPlay.create({ sources: [{ type: 'directlink', url: 'http://a.com' }] }),
    /url 必须是 https/);
  assert.throws(() => AdPlay.create({ directUrl: 'javascript:alert(1)', sources: ['house'] }),
    /directUrl 必须是 https/);
});

test('完整链路：Telegram 用 TMA zone，浏览器用 Direct Link，都不可用才兜底', async () => {
  const cfg = {
    sources: [
      { type: 'monetag', zoneId: '11440777', env: 'telegram' },
      { type: 'directlink', url: 'https://omg10.com/4/11622862', env: 'web' },
      { type: 'house' }
    ]
  };
  const tgEnv = {
    Telegram: { WebApp: { initData: 'x', initDataUnsafe: { user: { id: 1 } } } },
    show_11440777: () => Promise.resolve()
  };
  const inTg = AdPlay.create(cfg, { env: tgEnv, houseAd: houseWatched, openUrl: () => true });
  const r1 = await inTg.play();
  assert.strictEqual(r1.source, 'monetag');
  assert.strictEqual(r1.zone, '11440777');

  const doc = fakeDoc(); const clk = fakeClock();
  const inWeb = AdPlay.create(cfg, { env: {}, houseAd: houseWatched, doc, now: clk.now, openUrl: () => true });
  const p2 = inWeb.play();
  doc.leave(); clk.advance(6000); doc.back();     // 浏览器里：真去看了 6 秒再回来
  const r2 = await p2;
  assert.strictEqual(r2.source, 'directlink');
  assert.strictEqual(r2.ok, true);

  // 浏览器里 Direct Link 也失败 → 兜底卡，玩家仍拿得到奖励
  const degraded = AdPlay.create(cfg, { env: {}, houseAd: houseWatched, openUrl: () => false });
  const r3 = await degraded.play();
  assert.strictEqual(r3.source, 'house');
  assert.strictEqual(r3.ok, true);
});

/* ---- 广告商判定（reward_event_type）与失败原因直方图 · issue #1 广告奖励可信度 ----
   为什么加：Monetag SDK 的 Promise 其实 resolve 出一个对象，带 reward_event_type
   （'valued' = 这次曝光真变现了 / 'not_valued' = 展示了但没变现，见
   https://docs.monetag.com/docs/sdk-reference/）。以前我们只看"有没有 resolve"，
   把这个唯一能在客户端拿到的真伪信号扔了，于是没人回答得了
   「我们发出去的奖励里，有多少真的赚到钱」。
   注意底线：这个信号**只记账、不当发奖开关** —— 玩家确实看完了，没变现是我们和
   广告商之间的事，扣他的奖励等于让玩家替填充率背锅。 */
function envMonetagResolving(zone, value) {
  const env = {};
  env['show_' + zone] = () => Promise.resolve(value);
  return env;
}

test('monetag：valued 被记进 stats().reward，奖励照发', async () => {
  const a = AdPlay.create({ sources: ['monetag'], zoneId: 'z' },
    { env: envMonetagResolving('z', { reward_event_type: 'valued', estimated_price: 0.0023, zone_id: 123 }) });
  const r = await a.play();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.detail.rewardEventType, 'valued');
  assert.strictEqual(r.detail.estimatedPrice, 0.0023);
  assert.strictEqual(r.detail.zoneId, '123');
  assert.deepStrictEqual(a.stats().reward, { valued: 1, not_valued: 0, unknown: 0 });
});

test('monetag：not_valued 也照发奖（玩家看完了），但单独计数以便发现"白发奖没赚钱"', async () => {
  const a = AdPlay.create({ sources: ['monetag'], zoneId: 'z' },
    { env: envMonetagResolving('z', { reward_event_type: 'not_valued' }) });
  const r = await a.play();
  assert.strictEqual(r.ok, true, 'not_valued 不是玩家的错，必须照发');
  assert.strictEqual(r.detail.rewardEventType, 'not_valued');
  assert.deepStrictEqual(a.stats().reward, { valued: 0, not_valued: 1, unknown: 0 });
});

test('老 SDK / 其它广告源不返回对象 → unknown，不当失败', async () => {
  const a = AdPlay.create({ sources: ['monetag'], zoneId: 'z' }, { env: envMonetagResolving('z', undefined) });
  assert.strictEqual((await a.play()).ok, true);
  assert.deepStrictEqual(a.stats().reward, { valued: 0, not_valued: 0, unknown: 1 });

  const h = AdPlay.create({ sources: ['house'] }, { houseAd: houseWatched });
  const hr = await h.play();
  assert.strictEqual(hr.detail.rewardEventType, 'unknown');
  assert.strictEqual(h.stats().reward.unknown, 1);
});

test('失败原因直方图：能回答"为什么降级"，不是只有一个计数', async () => {
  const a = AdPlay.create({ sources: [{ type: 'monetag', zoneId: 'z' }, { type: 'house' }] },
    { env: envMonetag('z', 'reject'), houseAd: houseWatched });
  await a.play();
  await a.play();
  const s = a.stats();
  assert.strictEqual(s.reasons['monetag:no-fill'], 2, '同一个原因要累计，才能看出常态化降级');
  assert.strictEqual(s.bySource.house.ok, 2);
  assert.strictEqual(s.reward.unknown, 2);
});

test('directlink：起手页面已经是 hidden（标签页先切走了）也要算他离开过', async () => {
  /* 真浏览器实测抓到的首坏（.spike/verify-real-visibility.mjs）：
     打开广告标签页有时快过我们挂监听，"变 hidden"那一跳我们根本收不到，
     结果认真看了 3 秒回来的人被判成"没离开过"，白等一场。 */
  const doc = fakeDoc(); const clk = fakeClock();
  doc.visibilityState = 'hidden';                 // play() 之前就已经切走
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://a.com/1', env: 'web' }],
    directDwellSec: 2, directLeaveWaitSec: 0.05   // 极短的"没离开"窗口：一旦误判会立刻红
  }, { env: {}, doc, now: clk.now, openUrl: () => true });
  const p = a.play();
  await new Promise((r) => setTimeout(r, 80));     // 等过 no-leave 窗口，证明没被误判
  clk.advance(3000);
  doc.back();
  assert.deepStrictEqual(await p, { ok: true, source: 'directlink', zone: null, ms: 3000,
    detail: { rewardEventType: 'unknown' } });
});

/* ---- 反向阈值告警（issue #1 · 广告奖励可信度 4/4）----
   为什么需要它：降级分支「HTTP 200、无异常、功能消失」，常规告警一条都不会响。
   判据只有一个 —— 如果这条降级从明天起 100% 触发，我们多久会知道？ */
test('health：样本不够就不下结论（开局两次失败不该吓人）', () => {
  const s = { attempts: 3, failed: 3, reasons: { 'directlink:no-leave': 3 }, reward: {} };
  assert.deepStrictEqual(AdPlay.health(s), { ok: true, samples: 3, alerts: [] });
});

test('health：某个 webview 压根不触发 visibilitychange → no-leave 独占，必须报', () => {
  const s = { attempts: 20, ok: 0, failed: 20, reasons: { 'directlink:no-leave': 20 }, reward: {} };
  const h = AdPlay.health(s);
  assert.strictEqual(h.ok, false);
  const codes = h.alerts.map((a) => a.code).sort();
  assert.deepStrictEqual(codes, ['fail-rate', 'reason-dominant']);
  assert.strictEqual(h.alerts.find((a) => a.code === 'reason-dominant').reason, 'directlink:no-leave');
});

test('health：奖励照发但广告商几乎都判 not_valued → 白发奖没赚钱，也要报', () => {
  const s = { attempts: 30, ok: 30, failed: 0, reasons: {}, reward: { valued: 0, not_valued: 30, unknown: 0 } };
  const h = AdPlay.health(s);
  assert.strictEqual(h.ok, false);
  assert.deepStrictEqual(h.alerts.map((a) => a.code), ['valued-rate']);
});

test('health：正常运行不报警；阈值可由 config 调', () => {
  const s = { attempts: 40, ok: 34, failed: 6, reasons: { 'monetag:no-fill': 6 },
    reward: { valued: 30, not_valued: 4, unknown: 0 } };
  assert.strictEqual(AdPlay.health(s).ok, true);
  // 把单一原因的阈值收到 0.1 → 同一份数据就该报
  assert.strictEqual(AdPlay.health(s, { maxReasonRate: 0.1 }).ok, false);
});

test('mergeStats：跨会话累计，单次会话回答不了"最近是不是一直这样"', () => {
  const a = { attempts: 5, ok: 5, failed: 0, reasons: {}, reward: { valued: 5 }, bySource: { monetag: { ok: 5, failed: 0 } } };
  const b = { attempts: 7, ok: 2, failed: 5, reasons: { 'directlink:too-short:0.3s': 5 },
    reward: { valued: 1, unknown: 1 }, bySource: { directlink: { ok: 2, failed: 5 } } };
  const m = AdPlay.mergeStats(a, b);
  assert.strictEqual(m.attempts, 12);
  assert.strictEqual(m.failed, 5);
  assert.strictEqual(m.reasons['directlink:too-short:0.3s'], 5);
  assert.strictEqual(m.reward.valued, 6);
  assert.deepStrictEqual(m.bySource, { monetag: { ok: 5, failed: 0 }, directlink: { ok: 2, failed: 5 } });
  // 脏数据不能把累计搞崩
  assert.strictEqual(AdPlay.mergeStats(null, undefined).attempts, 0);
});

/* ---- 兜底广告卡：切走就停表（issue #1 · shams 清单 S2）----
   原来那张卡是 setInterval 硬减秒，切到别的标签/别的 App 表照走，
   回来奖励已经到账 —— 一条"什么都不用看"的白拿通道。 */
test('watchClock：一直在看 → 到点算看完', () => {
  const doc = fakeDoc(); const clk = fakeClock();
  const c = AdPlay.createWatchClock(5, { doc, now: clk.now, maxStepMs: 5000 });
  clk.advance(3000);
  assert.deepStrictEqual(c.sample().leftSec, 2);
  clk.advance(2000);
  assert.strictEqual(c.sample().done, true);
});

test('watchClock：手机把后台定时器冻住，回来那一下不能一次性补上整段', () => {
  /* 这是宿主真正会遇到的形态：切走期间一次采样都没跑，回到前台第一次采样看到
     一个巨大的时间差，而那时 visibilityState 已经是 visible。不夹刀就等于白送。 */
  const doc = fakeDoc(); const clk = fakeClock();
  const c = AdPlay.createWatchClock(5, { doc, now: clk.now });   // maxStepMs 默认 1 秒
  c.sample();
  doc.visibilityState = 'hidden';
  clk.advance(60000);                       // 切走一分钟，期间定时器完全冻结（没有采样）
  doc.visibilityState = 'visible';          // 回来
  const back = c.sample();
  assert.strictEqual(back.done, false, '切走一分钟不能算成看完了广告');
  assert.ok(back.watchedMs <= 1000, '最多只能补记 1 秒，得到 ' + back.watchedMs);
});

/* 宿主是每 250ms 采一次样的，测试也照这个节奏推时钟 */
function watchFor(c, clk, ms) {
  let out = null;
  for (let t = 0; t < ms; t += 250) { clk.advance(250); out = c.sample(); }
  return out;
}

test('watchClock：切到后台的那段时间不算数', () => {
  const doc = fakeDoc(); const clk = fakeClock();
  const c = AdPlay.createWatchClock(5, { doc, now: clk.now });
  watchFor(c, clk, 1000);
  doc.visibilityState = 'hidden';
  const away = watchFor(c, clk, 60000);     // 切走一分钟（定时器仍在跑，只是页面不可见）
  assert.strictEqual(away.done, false, '人不在场就不该算看完');
  assert.strictEqual(away.leftSec, 4, '倒计时应该停在切走那一刻');
  doc.visibilityState = 'visible';
  assert.strictEqual(watchFor(c, clk, 4000).done, true, '回来接着看够了就该算数');
});

test('watchClock：拿不到 document（Node/异常宿主）时退回按真实时间走，不卡死玩家', () => {
  const clk = fakeClock();
  const c = AdPlay.createWatchClock(2, { doc: null, now: clk.now });
  assert.strictEqual(watchFor(c, clk, 2000).done, true);
});

/* ---- 秒退之后不许再掉进兜底卡（2026-08-29 线上真机首坏）----
   玩家反馈：看 1 秒广告切回来，再等 5 秒就拿到奖励，其实根本没看广告。
   根因不在判据，而在判据**之后**：too-short 被当成"这个广告源坏了"，于是降级到
   队列最后的 house 兜底卡，5 秒本地倒计时照样发奖 —— 安全网把判据抵消掉了。
   之前的 spike 之所以测出 0/25，是因为它把 sources 改成只剩 directlink，
   恰好删掉了 house 这一环：那是假绿，测的是判据本身，不是线上那条真链。 */
test('秒退：判定为没挣到，不再降级到兜底卡', async () => {
  const doc = fakeDoc(); const clk = fakeClock();
  let houseShown = 0;
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://a.com/1', env: 'web' }, { type: 'house' }],
    directDwellSec: 5
  }, { env: {}, doc, now: clk.now, openUrl: () => true,
    houseAd: (s, done) => { houseShown += 1; done(true); } });
  const p = a.play();
  doc.leave(); clk.advance(1000); doc.back();          // 看了 1 秒就回来
  const r = await p;
  assert.strictEqual(r.ok, false, '秒退绝不能拿到奖励');
  assert.strictEqual(r.source, 'directlink');
  assert.strictEqual(houseShown, 0, '兜底卡根本不该出现——它是给"没广告可放"准备的，不是给"没看够"准备的');
});

test('没切走过：同样不掉进兜底卡', async () => {
  const doc = fakeDoc();
  let houseShown = 0;
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://a.com/1', env: 'web' }, { type: 'house' }],
    directLeaveWaitSec: 0.05
  }, { env: {}, doc, openUrl: () => true, houseAd: (s, done) => { houseShown += 1; done(true); } });
  const r = await a.play();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'directlink:no-leave');
  assert.strictEqual(houseShown, 0);
});

test('广告源真的坏了（弹窗被拦）→ 仍然降级到兜底卡，不能连累玩家', async () => {
  /* 这条是上面两条的反面：区分标准是"广告源坏了"还是"玩家没看够"。 */
  let houseShown = 0;
  const a = AdPlay.create({
    sources: [{ type: 'directlink', url: 'https://a.com/1', env: 'web' }, { type: 'house' }]
  }, { env: {}, openUrl: () => false, houseAd: (s, done) => { houseShown += 1; done(true); } });
  const r = await a.play();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.source, 'house');
  assert.strictEqual(houseShown, 1);
});
