/* core/cloudsync.js —— 多端账目同步的调度层（金币/道具/体力共用一套规则）。

   用户实报（2026-09-01）：「一个用户在多个浏览器都打开，金币经常变化，不同浏览器不一样，
   有时突然变多，有时突然变少」。

   根因不在存储层，在**读的时机**：客户端只在启动/登录时 loadCloud 一次，之后整场只写不读。
   于是 A 设备花掉的金币、B 设备赚到的金币，彼此都不知道；各自把自己那份陈旧账本写上去，
   云端靠 merge=max 勉强收敛，但**两个屏幕上显示的数字长时间不一致**，直到某一端刷新页面
   才「突然变多 / 突然变少」。

   规则（本模块负责第 2~6 条；第 1 条由 platform 的 mergeSave / Stock.reconcile 保证）：
     1. 云端行是权威，本地是缓存；账目字段一律单调合并（granted/spent 各取 max），
        余额 = granted − spent，永不为负 —— 所以「同步」永远不会凭空吞掉玩家已赚的币。
     2. 前台定期拉取（默认 45s）。
     3. 页面从后台回到前台立刻补一次（后台期间不拉，省电省流量）。
     4. 要用余额的时刻先拉：回首页、打开背包/商店、**花钱之前**（先同步后扣款）。
     5. 频控与并发：两次拉取最小间隔（默认 4s）；同一时刻只有一个在飞的请求，
        期间重复触发复用同一个 Promise；单次拉取超时（默认 2.5s）按失败处理，
        **绝不阻塞玩法**（调用方拿到 ok:false 照常按本地值继续）。
     6. 失败指数退避（45s → 90s → … 封顶 5min），成功立即复位；全过程 onEvent 可观测。

   本模块是纯逻辑：时钟、定时器、拉取、合并、可见性全部注入，所以能在测试里跑真代码。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CloudSyncCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULTS = {
    pullMs: 45000,        // 前台基准周期
    minGapMs: 4000,       // 两次拉取的最小间隔（多个触发点撞一起时不重复打服务器）
    backoffMaxMs: 300000, // 失败退避封顶 5 分钟
    timeoutMs: 2500,      // 单次拉取超时：超了就按失败处理，玩法照常走本地值
  };

  function create(opts) {
    var o = opts || {};
    var cfg = {
      pullMs: o.pullMs || DEFAULTS.pullMs,
      minGapMs: o.minGapMs === undefined ? DEFAULTS.minGapMs : o.minGapMs,
      backoffMaxMs: o.backoffMaxMs || DEFAULTS.backoffMaxMs,
      timeoutMs: o.timeoutMs === undefined ? DEFAULTS.timeoutMs : o.timeoutMs,
    };
    if (typeof o.pull !== 'function') throw new Error('cloudsync: 必须注入 pull()');
    if (typeof o.apply !== 'function') throw new Error('cloudsync: 必须注入 apply(row)');
    var now = o.now || function () { return Date.now(); };
    var setTimer = o.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    var clearTimer = o.clearTimer || function (id) { clearTimeout(id); };
    var isVisible = o.isVisible || function () { return true; };
    var emit = o.onEvent || function () {};

    var running = false, timer = null, inFlight = null;
    var lastAt = 0, failStreak = 0, pulls = 0, applied = 0, fails = 0, skips = 0;

    function delayMs() {
      if (!failStreak) return cfg.pullMs;
      var d = cfg.pullMs * Math.pow(2, failStreak);
      return Math.min(cfg.backoffMaxMs, d);
    }

    function schedule() {
      if (!running) return;
      if (timer !== null) { clearTimer(timer); timer = null; }
      timer = setTimer(function () { timer = null; tick(); }, delayMs());
    }

    function tick() {
      if (!running) return;
      /* 页面不可见就不拉：后台标签页拉了也没人看，纯属浪费电量与配额。
         回到前台时 onVisible() 会立刻补一次，所以不会漏。 */
      if (!isVisible()) { skips++; emit('sync_skip', { why: 'hidden' }); schedule(); return; }
      /* 定时触发一律 force：周期本身就是频控，再被 minGap 挡一道会让「周期比 minGap 短」
         这种配置静默失效（配错了也看不出来，正是最难查的那类问题）。 */
      pullNow('timer', true).then(schedule, schedule);
    }

    /* reason 只用于埋点：timer / visible / home / shop / before-spend / after-write / manual */
    function pullNow(reason, force) {
      if (inFlight) { emit('sync_skip', { why: 'inflight', reason: reason }); return inFlight; }
      var t = now();
      if (!force && cfg.minGapMs && lastAt && (t - lastAt) < cfg.minGapMs) {
        skips++;
        emit('sync_skip', { why: 'gap', reason: reason, since: t - lastAt });
        return Promise.resolve({ ok: true, changed: false, skipped: 'gap' });
      }
      lastAt = t;
      pulls++;
      emit('sync_pull', { reason: reason, n: pulls });

      var settled = false;
      var started = t;
      var timeoutP = new Promise(function (resolve) {
        if (!cfg.timeoutMs) return;
        setTimer(function () {
          if (!settled) resolve({ __timeout: true });
        }, cfg.timeoutMs);
      });

      /* 同步调用 pull()：包在 Promise.resolve().then 里会推迟一个微任务，
         「同一时刻只有一个在飞的请求」就变得依赖调度顺序，难测也难推理。 */
      var pullP;
      try { pullP = Promise.resolve(o.pull()); }
      catch (err) { pullP = Promise.reject(err); }

      inFlight = Promise.race([
        pullP.then(function (row) { return { row: row }; }, function (err) { return { err: err }; }),
        timeoutP,
      ]).then(function (res) {
        settled = true;
        inFlight = null;
        if (res && res.__timeout) {
          fails++; failStreak++;
          emit('sync_fail', { reason: reason, why: 'timeout', ms: cfg.timeoutMs, streak: failStreak });
          return { ok: false, changed: false, why: 'timeout' };
        }
        if (res && res.err) {
          var e = res.err;
          fails++; failStreak++;
          /* 降级必须说得出原因（本机纪律第 5 条）：err_name + 截断的 err_msg */
          emit('sync_fail', { reason: reason, why: 'error', streak: failStreak,
            err_name: (e && e.name) || 'Error',
            err_msg: String((e && e.message) || e).slice(0, 200) });
          return { ok: false, changed: false, why: 'error', err: e };
        }
        failStreak = 0;
        var out;
        try { out = o.apply(res.row) || {}; }
        catch (err) {
          fails++;
          emit('sync_fail', { reason: reason, why: 'apply', err_name: (err && err.name) || 'Error',
            err_msg: String((err && err.message) || err).slice(0, 200) });
          return { ok: false, changed: false, why: 'apply' };
        }
        if (out.changed) applied++;
        emit(out.changed ? 'sync_applied' : 'sync_same', {
          reason: reason, ms: now() - started,
          delta: out.delta === undefined ? undefined : out.delta,
          balance: out.balance === undefined ? undefined : out.balance,
        });
        return { ok: true, changed: !!out.changed, delta: out.delta, balance: out.balance };
      });
      return inFlight;
    }

    function start() {
      if (running) return;
      running = true; failStreak = 0;
      emit('sync_start', { pullMs: cfg.pullMs });
      schedule();
    }
    function stop() {
      running = false;
      if (timer !== null) { clearTimer(timer); timer = null; }
      emit('sync_stop', {});
    }
    /* 页面回到前台：立刻补一次（后台期间别端可能花过钱），并把周期重新对齐 */
    function onVisible() {
      if (!running) return Promise.resolve({ ok: true, changed: false, skipped: 'stopped' });
      var p = pullNow('visible', true);
      schedule();
      return p;
    }

    function state() {
      return { running: running, pulls: pulls, applied: applied, fails: fails, skips: skips,
        failStreak: failStreak, nextMs: delayMs(), lastAt: lastAt };
    }

    return { start: start, stop: stop, pullNow: pullNow, onVisible: onVisible, state: state, config: cfg };
  }

  return { create: create, DEFAULTS: DEFAULTS };
});
