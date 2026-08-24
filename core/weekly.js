/* 每周活动 core（一份代码，所有游戏共用）
   ——把原来散在四处的副本合并：core/weekly.js（领取状态机）、weekly.js（周界/主题/结转）、
   water.html 内联的 Weekly + WeeklyCore 两份。

   分工纪律：
   - core 只做「周界 / 解锁 / 领取状态机 / 结转」这些**所有游戏一样**的机制；
   - 奖励内容、阈值、碎片数量、主题文案这些**每个游戏不一样**的东西，全部由 config 声明；
   - 碎片怎么来（通关/看广告）、奖励怎么入账（体力/道具/金币）、存档怎么落盘，仍归宿主；
   - 奖励随机 roll 由宿主注入随机数（便于测试确定化）。

   状态机（每张主题图）：locked →(碎片达阈值) claimable →(用户点击领取) claimed。
   解锁 ≠ 领取：达阈值只进 claimable，必须用户点击才发放；大奖同口径。
   claim 不可变：返回新 state，不改入参。

   config（game.config.json 的 weekly 段，全部可省，缺省 = 下面 DEFAULTS）：
     enabled     不开活动 = false，宿主据此整体不渲染入口
     thresholds  各主题图解锁所需碎片（升序，张数由数组长度决定，不再写死 6 张）
     goal        大奖阈值 + 结转基准（默认取 thresholds 最后一项）
     frags       碎片来源数量 { win, ad }
     grand       大奖内容，任意 {奖励键: 数量}，由宿主决定怎么入账
     rewardPool  每张图的奖励池 [{ type, min, max, weight }]，type 任意（宿主自己认）
     themes      主题轮换（每项 { zh:{name,pics[]}, en:{...}, c1,c2,bg }）
   浏览器/Node 双环境。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeeklyCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var WEEK = 7 * DAY;
  var STATUS = ['locked', 'claimable', 'claimed'];

  /* 缺省值 = 倒水上线至今的既有数值，所以老配置（或整段不配）行为完全不变 */
  var DEFAULTS = {
    enabled: true,
    thresholds: [100, 200, 300, 400, 500, 600],
    frags: { win: 10, ad: 10 },
    grand: { energy: 60, hints: 5 },
    rewardPool: [
      { type: 'energy', min: 10, max: 60, weight: 1 },
      { type: 'hints', min: 1, max: 3, weight: 1 }
    ],
    themes: [
      { zh: { name: '星空周', pics: ['晓星', '孤星', '行星环', '彗星', '星云涡', '星座图'] },
        en: { name: 'Starry Week', pics: ['Dawn Star', 'Lone Star', 'Ringed Planet', 'Comet', 'Nebula', 'Constellation'] },
        c1: '#D4B36A', c2: '#7FC29B', bg: '#101820' },
      { zh: { name: '深海周', pics: ['珍珠', '水母', '游鱼', '海螺', '暗流', '灯塔'] },
        en: { name: 'Deep Sea Week', pics: ['Pearl', 'Jellyfish', 'Fish', 'Conch', 'Undertow', 'Lighthouse'] },
        c1: '#7FB8C2', c2: '#7FC29B', bg: '#0E1A20' },
      { zh: { name: '森林周', pics: ['嫩芽', '孤木', '年轮', '飞鸟', '林间光', '山丘'] },
        en: { name: 'Forest Week', pics: ['Sprout', 'Lone Tree', 'Rings', 'Bird', 'Sunbeam', 'Hills'] },
        c1: '#8FC27F', c2: '#D4B36A', bg: '#121D14' },
      { zh: { name: '灯火周', pics: ['烛光', '灯笼', '街灯', '篝火', '烟花', '灯河'] },
        en: { name: 'Lantern Week', pics: ['Candle', 'Lantern', 'Streetlamp', 'Bonfire', 'Fireworks', 'River of Light'] },
        c1: '#D2A05C', c2: '#DE9A70', bg: '#1C1410' }
    ]
  };

  function fail(msg) { throw new Error('weekly-core: ' + msg); }
  function isPosInt(v) { return typeof v === 'number' && isFinite(v) && v > 0 && v === Math.floor(v); }

  /* ---------- 周界：UTC 周，周一 00:00 UTC 为界（= 周日 24:00 UTC 重置） ----------
     这部分对所有游戏完全一致，不开放配置：跨游戏的活动周必须同步，
     否则同一时刻两个游戏显示不同的「本周」，运营和排行榜都会错位。
     1970-01-01 是周四（day 0），+3 使周一对齐周界。 */
  function weekIndex(now) {
    if (typeof now !== 'number' || !isFinite(now)) fail('now 必须是毫秒时间戳');
    return Math.floor((Math.floor(now / DAY) + 3) / 7);
  }
  function weekKey(now) { return 'w' + weekIndex(now); }
  function weekEnd(now) { return (weekIndex(now) + 1) * WEEK - 3 * DAY; }

  /* ISO 周 key（UTC），与 assets/weekly/weekly-config.json 的键一致（如 2026-W34）。
     口径：所在周的周四决定 ISO 年。 */
  function isoWeekKey(now) {
    if (typeof now !== 'number' || !isFinite(now)) fail('now 必须是毫秒时间戳');
    var d = new Date(now);
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    var y = t.getUTCFullYear();
    var wk = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
    return y + '-W' + (wk < 10 ? '0' + wk : wk);
  }

  /* 取当周配置条目（运营排期表）：命中返回条目，未命中/结构非法返回 null（宿主回退主题轮换） */
  function resolveWeek(config, now) {
    if (!config || typeof config !== 'object') return null;
    var e = config[isoWeekKey(now)];
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    return e;
  }

  /* ---------- 配置化实例 ---------- */
  function create(cfg) {
    if (cfg !== undefined && cfg !== null && (typeof cfg !== 'object' || Array.isArray(cfg))) {
      fail('config 必须是对象或省略');
    }
    var c = cfg || {};
    var enabled = c.enabled === undefined ? DEFAULTS.enabled : !!c.enabled;

    var thresholds = c.thresholds === undefined ? DEFAULTS.thresholds.slice() : c.thresholds;
    if (!Array.isArray(thresholds) || thresholds.length === 0) fail('thresholds 必须是非空数组');
    thresholds.forEach(function (v, i) {
      if (!isPosInt(v)) fail('thresholds[' + i + '] 必须是正整数，得到 ' + JSON.stringify(v));
      if (i > 0 && v <= thresholds[i - 1]) fail('thresholds 必须严格升序（第 ' + i + ' 项 ' + v + ' 不大于前一项）');
    });
    var goal = c.goal === undefined ? thresholds[thresholds.length - 1] : c.goal;
    if (!isPosInt(goal)) fail('goal 必须是正整数');
    if (goal < thresholds[thresholds.length - 1]) fail('goal 不能小于最后一个 threshold');

    var frags = Object.assign({}, DEFAULTS.frags, c.frags || {});
    ['win', 'ad'].forEach(function (k) { if (!isPosInt(frags[k])) fail('frags.' + k + ' 必须是正整数'); });

    var grand = c.grand === undefined ? Object.assign({}, DEFAULTS.grand) : c.grand;
    if (!grand || typeof grand !== 'object' || Array.isArray(grand)) fail('grand 必须是对象');
    var grandKeys = Object.keys(grand);
    if (grandKeys.length === 0) fail('grand 至少要有一项奖励');
    grandKeys.forEach(function (k) { if (!isPosInt(grand[k])) fail('grand.' + k + ' 必须是正整数'); });

    var pool = c.rewardPool === undefined ? DEFAULTS.rewardPool.slice() : c.rewardPool;
    if (!Array.isArray(pool) || pool.length === 0) fail('rewardPool 必须是非空数组');
    pool.forEach(function (p, i) {
      if (!p || typeof p !== 'object') fail('rewardPool[' + i + '] 必须是对象');
      if (typeof p.type !== 'string' || !p.type) fail('rewardPool[' + i + '].type 必须是非空字符串');
      if (!isPosInt(p.min)) fail('rewardPool[' + i + '].min 必须是正整数');
      if (!isPosInt(p.max) || p.max < p.min) fail('rewardPool[' + i + '].max 必须是 >= min 的正整数');
      if (p.weight !== undefined && !(typeof p.weight === 'number' && isFinite(p.weight) && p.weight > 0)) {
        fail('rewardPool[' + i + '].weight 必须是正数');
      }
    });
    var themes = c.themes === undefined ? DEFAULTS.themes.slice() : c.themes;
    if (!Array.isArray(themes) || themes.length === 0) fail('themes 必须是非空数组');

    var COUNT = thresholds.length;
    var totalWeight = pool.reduce(function (s, p) { return s + (p.weight === undefined ? 1 : p.weight); }, 0);

    function assertState(st) {
      if (!st || typeof st !== 'object') fail('state 必须是对象');
      if (typeof st.frags !== 'number' || !isFinite(st.frags) || st.frags < 0) fail('state.frags 必须是 >=0 的数');
      if (!Array.isArray(st.claimed) || st.claimed.length !== COUNT) {
        fail('state.claimed 必须是长度 ' + COUNT + ' 的数组');
      }
    }
    function assertIdx(i) {
      if (!Number.isInteger(i) || i < 0 || i >= COUNT) fail('图索引必须是 0..' + (COUNT - 1) + ' 的整数');
    }

    function picStatus(st, i) {
      assertState(st); assertIdx(i);
      if (st.claimed[i]) return 'claimed';
      return st.frags >= thresholds[i] ? 'claimable' : 'locked';
    }
    function claimable(st) {
      assertState(st);
      var out = [];
      for (var i = 0; i < COUNT; i++) if (picStatus(st, i) === 'claimable') out.push(i);
      return out;
    }
    function grandStatus(st) {
      assertState(st);
      if (st.grand) return 'claimed';
      return st.frags >= goal ? 'claimable' : 'locked';
    }
    function claimableCount(st) {
      return claimable(st).length + (grandStatus(st) === 'claimable' ? 1 : 0);
    }

    /* 奖励 roll：按 weight 选池中一档，再在 [min,max] 里取值。
       随机数由宿主注入（randPick/randAmt ∈ [0,1)），便于测试确定化；非法输入回退最小奖励。 */
    function rollReward(randPick, randAmt) {
      var ok = function (r) { return typeof r === 'number' && isFinite(r) && r >= 0 && r < 1; };
      var rp = ok(randPick) ? randPick : 0;
      var ra = ok(randAmt) ? randAmt : 0;
      var acc = 0, hit = pool[0], target = rp * totalWeight;
      for (var i = 0; i < pool.length; i++) {
        acc += pool[i].weight === undefined ? 1 : pool[i].weight;
        if (target < acc) { hit = pool[i]; break; }
      }
      var span = hit.max - hit.min + 1;
      return { type: hit.type, n: hit.min + Math.floor(ra * span) };
    }

    /* 领取第 i 张图：仅 claimable 可领。rollFn 省略则用内置 rollReward（宿主可注入自己的随机源）。
       校验奖励 type 必须来自配置的 rewardPool —— 防止宿主 roll 出一个游戏不认识的奖励类型。 */
    function claim(st, i, rollFn) {
      var s = picStatus(st, i);
      if (s === 'claimed') fail('图 ' + (i + 1) + ' 已领取，不能重复领');
      if (s === 'locked') fail('图 ' + (i + 1) + ' 未解锁（碎片 ' + st.frags + '/' + thresholds[i] + '），不能领取');
      var reward = typeof rollFn === 'function' ? rollFn() : rollReward(Math.random(), Math.random());
      if (!reward || typeof reward !== 'object') fail('奖励必须是对象 {type, n}');
      var known = pool.some(function (p) { return p.type === reward.type; });
      if (!known) fail('奖励类型 "' + reward.type + '" 不在 rewardPool 里（配置未声明的奖励不发）');
      if (!isPosInt(reward.n)) fail('奖励数量必须是正整数');
      var next = Object.assign({}, st, { claimed: st.claimed.slice() });
      next.claimed[i] = true;
      next['r' + i] = reward;              // 记录已领奖励，活动页展示用（与既有存档字段兼容）
      return { state: next, reward: reward };
    }

    function claimGrand(st) {
      var s = grandStatus(st);
      if (s === 'claimed') fail('大奖已领取，不能重复领');
      if (s === 'locked') fail('大奖未解锁（碎片 ' + st.frags + '/' + goal + '），不能领取');
      var next = Object.assign({}, st, { claimed: st.claimed.slice(), grand: true });
      return { state: next, reward: Object.assign({}, grand) };
    }

    function unlockedCount(f) {
      var n = 0;
      for (var i = 0; i < COUNT; i++) if (f >= thresholds[i]) n++;
      return n;
    }
    function newlyUnlocked(before, after) {
      var out = [];
      for (var i = 0; i < COUNT; i++) if (before < thresholds[i] && after >= thresholds[i]) out.push(i);
      return out;
    }
    function carry(f) { return Math.max(0, (f | 0) - goal); }           // 超出大奖阈值的部分结转下周
    function blank(wk) {
      var claimedArr = [];
      for (var i = 0; i < COUNT; i++) claimedArr.push(false);
      return { week: wk, frags: 0, carried: 0, claimed: claimedArr, grand: false };
    }
    /* 换周归零 + 结转：老状态张数与当前配置不一致时也走重置（改配置不会崩存档） */
    function normalize(state, wk) {
      if (state && state.week === wk && Array.isArray(state.claimed) && state.claimed.length === COUNT) return state;
      var b = blank(wk);
      if (state && typeof state.frags === 'number' && state.week !== wk) {
        b.carried = carry(state.frags);
        b.frags = b.carried;
      }
      return b;
    }
    function themeFor(now) { return themes[weekIndex(now) % themes.length]; }

    return {
      enabled: enabled,
      thresholds: thresholds.slice(),
      goal: goal,
      count: COUNT,
      frags: Object.assign({}, frags),
      grand: Object.assign({}, grand),
      rewardPool: pool.slice(),
      themes: themes.slice(),
      picStatus: picStatus, claimable: claimable, claimableCount: claimableCount,
      claim: claim, grandStatus: grandStatus, claimGrand: claimGrand,
      rollReward: rollReward, unlockedCount: unlockedCount, newlyUnlocked: newlyUnlocked,
      carry: carry, blank: blank, normalize: normalize, themeFor: themeFor,
      weekIndex: weekIndex, weekKey: weekKey, weekEnd: weekEnd,
      isoWeekKey: isoWeekKey, resolveWeek: resolveWeek
    };
  }

  /* 向后兼容：老代码直接用 WeeklyCore.picStatus(...) / .THRESHOLDS 的路径继续可用，
     等价于「用默认配置的实例」。新代码一律走 create(CFG.weekly)。 */
  var dflt = create(null);

  return {
    create: create,
    DEFAULTS: DEFAULTS,
    DAY: DAY, WEEK: WEEK, STATUS: STATUS,
    THRESHOLDS: dflt.thresholds, GOAL: dflt.goal, GRAND: dflt.grand, THEMES: dflt.themes,
    FRAG_WIN: dflt.frags.win, FRAG_AD: dflt.frags.ad,
    picStatus: dflt.picStatus, claimable: dflt.claimable, claimableCount: dflt.claimableCount,
    claim: dflt.claim, grandStatus: dflt.grandStatus, claimGrand: dflt.claimGrand,
    rollReward: dflt.rollReward, unlockedCount: dflt.unlockedCount, newlyUnlocked: dflt.newlyUnlocked,
    carry: dflt.carry, blank: dflt.blank, normalize: dflt.normalize, themeFor: dflt.themeFor,
    weekIndex: weekIndex, weekKey: weekKey, weekEnd: weekEnd,
    isoWeekKey: isoWeekKey, resolveWeek: resolveWeek
  };
});
