/* mine-story.js —— 彩色扫雷剧情 CG 层。
   两部分：① 剧情数据（CG 表 + 双语字幕 catalog）；② CG 播放机标准件。

   播放机来源：作品广场《黎明崛起》线上产物的逐行移植（2026-08-27 拆解），
   设计与红线见 color-mines/STORY-FRAMEWORK.md §7.2。**禁止另造一套播 CG 的方式。**

   四条不变量（改这个文件前先读）：
     1. 任何异步分支最终必须走向 advance 或 end —— 不存在「什么都不做」的分支；
     2. end 幂等，st.done 是全局熔断，所有回调开头先查；
     3. 进度条读满再进 CG，绝不边播边解码；
     4. 资源用逻辑键标识，真实路径只存在于 MEDIA 映射表里 —— 换托管方式零改代码。

   降级可观测（AGENTS 纪律：静默降级必须能回答「为什么降级、降级了多少次」）：
     每次跳过都记 reason（timeout|blocked|missing|error|skip|seen），
     计数落 window.MineStory.telemetry，可被自检/埋点读走。 */
(function (root) {
  'use strict';

  /* ── ① 剧情节奏：整张表由规则生成（2026-08-29 起）────────────────────
     cadence = 每多少关一段；count = 段数（含序章 cg0）。
     **加 1000 关 = 把 count 加 10**，不必手写任何 id / 路径 / 映射 —— 手写清单
     到 100 段就没人维护得动，且漏配只会在发布时才炸。
     段 i：id=cgN，at = i===0 ? 0 : i*cadence，素材 cg/cgN.mp4 + cg/bgmN.opus。
     字幕 key 同 id；SUBS 里没写的段自动没有字幕（章节名照常显示，不阻塞加关卡）。 */
  var plan = { cadence: 100, count: 11 };

  /* 例外覆盖：只有需要特殊待遇的段写在这里，其余全靠规则。
     目前唯一的例外是序章的分句字幕时间轴 —— 开场必须把「你是谁 / 出了什么事 /
     你要去干什么」讲清楚，单句字幕只有气氛没有目标。 */
  var OVERRIDES = {
    cg0: {
      cues: [
        { t: 0.4, k: 'cg0a' },
        { t: 2.6, k: 'cg0b' },
        { t: 5.0, k: 'cg0c' },
        { t: 7.2, k: 'cg0d' }
      ]
    }
  };

  /* ── ② 资源映射表：逻辑键 → 真实路径（唯一改托管的地方，不变量 4）─────
     现在由规则生成；改成 CDN/对象存储时只改这里的右值，播放机零改动。 */
  var MEDIA = {};
  var CG = [];
  function rebuild() {
    MEDIA = {}; CG = [];
    for (var i = 0; i < plan.count; i++) {
      var v = 'cg/cg' + i + '.mp4', m = 'cg/bgm' + i + '.opus';
      MEDIA[v] = v; MEDIA[m] = m;
      var seg = { id: 'cg' + i, at: i === 0 ? 0 : i * plan.cadence, v: v, m: m, k: 'cg' + i };
      var ov = OVERRIDES[seg.id];
      if (ov) { for (var key in ov) { if (Object.prototype.hasOwnProperty.call(ov, key)) seg[key] = ov[key]; } }
      CG.push(seg);
    }
    if (api) { api.CG = CG; api.MEDIA = MEDIA; }
  }

  /* ── ③ 字幕 catalog：zh/en 成对（唯一合法的中文出现点）─────────────── */
  var SUBS = {
    /* 开场四句递进：处境 → 代价 → 身份 → 目标。
       目标句是最后一句，也是玩家点进第 1 关时脑子里该剩下的那句话。 */
    cg0a: { zh: '十年前，锈铁商会抽干了这里的矿脉。',
            en: 'Ten years ago, Rustiron drained the veins beneath this town.' },
    cg0b: { zh: '灯落镇的光被一车车运走，家家户户从此黑着。',
            en: 'They carted the light away. Every window has been dark since.' },
    cg0c: { zh: '祖父提着这盏灯下矿去追，再没上来。你是最后一个矿灯师。',
            en: 'Grandfather took this lamp down after them, and never came back up. You are the last lampwright.' },
    cg0d: { zh: '把七种光一盏一盏找回来——让灯落镇重新亮起来。',
            en: 'Bring the seven lights home, one lamp at a time. Make Lumen Hollow shine again.' },
    /* 兼容回落：无 cues 时用的单句 */
    cg0: { zh: '把七种光一盏一盏找回来——让灯落镇重新亮起来。',
           en: 'Bring the seven lights home, one lamp at a time.' },
    cg1: { zh: '光回来了，人也就回来了。', en: 'The light came back. So did the people.' },
    cg2: { zh: '他到过这里，然后再没上去。', en: 'He made it this far. He never went back up.' },
    cg3: { zh: '第一封信。他还在往更深的地方走。', en: "The first letter. He's still heading deeper." }
    ,
    cg4: { zh: '七条脉之外，还有第八条。他把路留给了你。',
           en: 'Beyond the seven veins lies an eighth. He left the way open for you.' },
    cg5: { zh: '哑火不是死的。它记着被夺走的一切。',
           en: "A cinder isn't dead. It remembers everything that was taken." },
    cg6: { zh: '光没有消失——它被装箱、编号，运去了别处。',
           en: 'The light never vanished. It was crated, tallied, and shipped away.' },
    cg7: { zh: '顺着这条铁轨，你第一次走出了灯落镇。',
           en: 'You follow the rails, and leave Lumen Hollow for the first time.' },
    cg8: { zh: '这里的人整夜不熄灯。他们不知道光是从谁家偷来的。',
           en: "This city never turns its lights off. No one here knows whose light it is." },
    cg9: { zh: '要把光还回去，这座城得先黑下来。',
           en: 'To give the light back, this city must go dark first.' },
    cg10: { zh: '灯落镇亮了。可地平线那头，还有一片黑着的地方。',
            en: 'Lumen Hollow shines. But out past the horizon, somewhere is still dark.' }
  };
  var UI = {
    skip: { zh: '跳过 ▶', en: 'Skip ▶' },
    loading: { zh: '加载中', en: 'Loading' }
  };

  var SEEN_KEY = 'cm.story.seen';
  var WATCHDOG_MS = 4000;   // 设计定案：4 秒内 readyState<2 即无感放行
  var GO_FALLBACK_MS = 2500; // playing 事件没来也要收 loading 层

  var telemetry = { played: 0, skipped: 0, reasons: {} };
  function note(reason) {
    telemetry.reasons[reason] = (telemetry.reasons[reason] || 0) + 1;
    if (reason !== 'seen') {
      telemetry.skipped++;
      // 只看日志就能判断「为什么降级」——禁止裸跳过
      try { console.warn('[mine-story] cg degraded reason=' + reason); } catch (e) {}
    }
  }

  var lang = 'zh';
  function tx(tbl, key) {
    var row = tbl[key];
    if (!row) return '';
    return row[lang] || row.en || '';
  }

  /* ── seen 记录：读失败按「全没看过」，但同会话内不重播 ───────────────── */
  var sessionPlayed = {};
  function seenList() {
    try {
      var raw = root.localStorage.getItem(SEEN_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
    } catch (e) { return []; }
  }
  function markSeen(id) {
    sessionPlayed[id] = true;
    try {
      var arr = seenList();
      if (arr.indexOf(id) < 0) { arr.push(id); root.localStorage.setItem(SEEN_KEY, JSON.stringify(arr)); }
    } catch (e) {}
  }
  function hasSeen(id) {
    if (sessionPlayed[id]) return true;
    return seenList().indexOf(id) >= 0;
  }

  /* ── 逻辑键 → 可播 URL：Blob 优先 → 映射表 → 原键兜底（不变量 4）──── */
  var BLOB = {};
  function res(k) {
    if (BLOB[k]) return BLOB[k];
    if (MEDIA[k]) return MEDIA[k];
    return k;
  }

  /* ── DOM：遮罩层按需建，游戏首屏零成本 ───────────────────────────────── */
  var dom = null;
  function ensureDom() {
    if (dom) return dom;
    var ov = root.document.createElement('div');
    ov.id = 'cgov';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:90;background:#000;display:none;'
      + 'align-items:center;justify-content:center;overflow:hidden');
    ov.innerHTML =
      '<video id="cgVideo" playsinline preload="auto" style="position:absolute;inset:0;width:100%;'
      + 'height:100%;object-fit:contain;background:#000;visibility:hidden"></video>'
      + '<div id="cgLoad" style="position:absolute;left:0;right:0;bottom:38%;display:none;'
      + 'flex-direction:column;align-items:center;gap:10px;color:#e8ddc8;font-size:13px">'
      + '<div style="width:56%;height:3px;background:rgba(255,255,255,.18);border-radius:2px;overflow:hidden">'
      + '<div id="cgBar" style="width:0;height:100%;background:#ffb454;transition:width .18s linear"></div></div>'
      + '<div id="cgLoadTxt"></div></div>'
      + '<div id="cgSub" style="position:absolute;left:6%;right:6%;bottom:9%;text-align:center;'
      + 'color:#f4ecd8;font-size:15px;line-height:1.5;text-shadow:0 2px 8px rgba(0,0,0,.9);'
      + 'opacity:0;transition:opacity .5s ease"></div>'
      + '<button id="cgSkip" type="button" style="position:absolute;right:14px;top:14px;z-index:2;'
      + 'font-size:12px;padding:6px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.35);'
      + 'background:rgba(0,0,0,.45);color:#f0e6d2;cursor:pointer"></button>';
    root.document.body.appendChild(ov);
    dom = {
      ov: ov,
      vid: ov.querySelector('#cgVideo'),
      load: ov.querySelector('#cgLoad'),
      bar: ov.querySelector('#cgBar'),
      loadTxt: ov.querySelector('#cgLoadTxt'),
      sub: ov.querySelector('#cgSub'),
      skip: ov.querySelector('#cgSkip')
    };
    return dom;
  }

  /* ── 播放状态 ─────────────────────────────────────────────────────────── */
  var st = null;

  function setBar(n, total) {
    if (!dom) return;
    var pc = total > 0 ? Math.round(n * 100 / total) : 100;
    try {
      dom.bar.style.width = pc + '%';
      dom.loadTxt.textContent = tx(UI, 'loading') + ' ' + pc + '%';
    } catch (e) {}
  }

  /* 预热：真实文件 fetch 成 Blob，读满再进（不变量 3）。
     任一件失败不算致命——res() 会回落到原路径，由 video 自己再试一次。 */
  function preload(keys, done) {
    var i = 0, total = keys.length;
    setBar(0, total);
    (function step() {
      if (!st || st.done) return;                       // 不变量 2：全局熔断
      if (i >= total) { setBar(total, total); done(); return; }
      var k = keys[i];
      i++;
      var url = MEDIA[k];
      if (!url) { setBar(i, total); step(); return; }
      var settled = false;
      var fin = function () { if (settled) return; settled = true; setBar(i, total); step(); };
      try {
        root.fetch(url).then(function (r) {
          if (!r || !r.ok) throw new Error('http ' + (r && r.status));
          return r.blob();
        }).then(function (b) {
          try { BLOB[k] = root.URL.createObjectURL(b); } catch (e) {}
          fin();
        })['catch'](function () { fin(); });   // 不变量 1：失败也要往下走
      } catch (e) { fin(); }
    })();
  }

  function stopBgm(fade) {
    if (!st || !st.bgm) return;
    var a = st.bgm;
    st.bgm = null;
    if (!fade) { try { a.pause(); } catch (e) {} return; }
    var v = a.volume, steps = 8, i = 0;
    var t = root.setInterval(function () {
      i++;
      try { a.volume = Math.max(0, v * (1 - i / steps)); } catch (e) {}
      if (i >= steps) { root.clearInterval(t); try { a.pause(); } catch (e) {} }
    }, 55);
  }

  function startBgm(seg) {
    if (!seg.m || !st || st.muted) return;
    try {
      var a = new root.Audio(res(seg.m));
      a.volume = 0.75;
      st.bgm = a;
      // BGM 不参与完成门（它是背景，不是内容）——出错静默，绝不阻塞 CG
      a.play()['catch'](function () { note('blocked'); });
    } catch (e) { note('error'); }
  }

  /* 收口：幂等（不变量 2）*/
  function end(reason) {
    if (!st || st.done) return;
    st.done = true;
    if (reason) note(reason);
    stopBgm(true);
    if (st.wd) { root.clearTimeout(st.wd); st.wd = null; }
    if (st.goT) { root.clearTimeout(st.goT); st.goT = null; }
    try {
      dom.vid.pause();
      dom.vid.removeAttribute('src');
      dom.vid.load();
    } catch (e) {}
    try { dom.vid.ontimeupdate = null; } catch (e) {}
    try {
      dom.ov.style.display = 'none';
      dom.sub.style.opacity = '0';
      dom.vid.style.visibility = 'hidden';
    } catch (e) {}
    markSeen(st.seg.id);
    var cb = st.done_cb;
    st = null;
    if (cb) { try { cb(); } catch (e) {} }
  }

  /* 双完成门：视频与音轨各自到齐才推进（这里单段 ⇒ 推进即收口）。
     单段也保留这道门 —— 以后加旁白/加分段时不必重写。 */
  function advance(which) {
    if (!st || st.done || !st.pend) return;
    st.pend[which] = true;
    if (st.pend.vid && st.pend.aud) { st.pend = null; end(null); }
  }

  function unmute() {
    if (!st || st.done) return false;
    if (!st.muted) return true;
    st.muted = false;
    try {
      dom.vid.muted = false;
      dom.vid.defaultMuted = false;
      dom.vid.volume = 1;
    } catch (e) {}
    startBgm(st.seg);   // 补上被静音策略挡掉的 BGM
    return true;
  }
  function unlock() {
    if (unmute()) {
      root.document.removeEventListener('pointerdown', unlock);
      root.document.removeEventListener('keydown', unlock);
    }
  }

  function play(seg, done) {
    var d = ensureDom();
    st = { seg: seg, done: false, done_cb: done, muted: true, pend: null, bgm: null, wd: null, goT: null };

    d.skip.textContent = tx(UI, 'skip');
    d.skip.onclick = function () { end('skip'); };
    var cues = (seg.cues && seg.cues.length) ? seg.cues : null;
    d.sub.textContent = cues ? '' : tx(SUBS, seg.k);
    d.sub.style.opacity = '0';
    d.ov.style.display = 'flex';
    d.load.style.display = 'flex';
    d.vid.style.visibility = 'hidden';

    root.document.addEventListener('pointerdown', unlock);
    root.document.addEventListener('keydown', unlock);

    var keys = [seg.v];
    if (seg.m) keys.push(seg.m);

    preload(keys, function () {
      if (!st || st.done) return;
      // 资源键缺失 ⇒ 静默跳过，不弹任何错误
      if (!MEDIA[seg.v]) { end('missing'); return; }

      st.pend = { vid: false, aud: false };
      // 无旁白 ⇒ 音轨门立即满足（保留门结构，见 advance 注释）
      advance('aud');

      var started = false;
      var go = function () {
        if (started || !st || st.done) return;
        started = true;
        try { d.load.style.display = 'none'; } catch (e) {}
        try { d.vid.style.visibility = 'visible'; } catch (e) {}   // playing 后再显示，消黑闪
        // 有 cues 时字幕由时间轴自己推；无 cues 才在这里整句亮出来
        if (!cues) { try { d.sub.style.opacity = '1'; } catch (e) {} }
        startBgm(seg);
      };

      /* 分句字幕时间轴：按 currentTime 找「最后一条已到点的 cue」。
         用 <= 扫描而不是逐条推进 —— seek/丢帧/首帧延迟都不会让字幕错位或卡住。 */
      var curCue = -1;
      var showCue = function (i) {
        if (i === curCue || !st || st.done) return;
        curCue = i;
        try { d.sub.style.opacity = '0'; } catch (e) {}
        root.setTimeout(function () {
          if (!st || st.done || curCue !== i) return;
          try {
            d.sub.textContent = tx(SUBS, cues[i].k);
            d.sub.style.opacity = '1';
          } catch (e) {}
        }, 180);
      };
      if (cues) {
        d.vid.ontimeupdate = function () {
          if (!st || st.done) return;
          var now = d.vid.currentTime, idx = -1, i;
          for (i = 0; i < cues.length; i++) { if (now >= cues[i].t) idx = i; }
          if (idx >= 0) showCue(idx);
        };
      }

      d.vid.onplaying = go;
      st.goT = root.setTimeout(go, GO_FALLBACK_MS);
      d.vid.onended = function () { advance('vid'); };
      d.vid.onerror = function () { end('error'); };   // 不变量 1

      // 看门狗：弱网/解码不动即无感放行
      st.wd = root.setTimeout(function () {
        if (st && !st.done && d.vid.readyState < 2) end('timeout');
      }, WATCHDOG_MS);

      try {
        d.vid.muted = true;          // 静音起播，绕开自动播放策略
        d.vid.src = res(seg.v);
        var p = d.vid.play();
        if (p && p['catch']) p['catch'](function () { end('blocked'); });
      } catch (e) { end('error'); }
    });
  }

  /* ── 对外 API ─────────────────────────────────────────────────────────── */
  var api = {
    telemetry: telemetry,
    CG: CG,
    MEDIA: MEDIA,
    SUBS: SUBS,
    /** 当前节奏（只读快照）。加关卡改这里，不改任何清单。 */
    plan: function () { return { cadence: plan.cadence, count: plan.count }; },
    /** 改节奏并重建整张表（加关卡 / 测试造规模都走这里）。 */
    setPlan: function (p) {
      if (p && p.cadence > 0) plan.cadence = Math.floor(p.cadence);
      if (p && p.count > 0) plan.count = Math.floor(p.count);
      rebuild();
      return { cadence: plan.cadence, count: plan.count };
    },
    setLang: function (l) { lang = (l === 'en') ? 'en' : 'zh'; },
    /** 已解锁（看过）的 CG，供首页「回忆」入口列出。 */
    unlocked: function () {
      var seen = seenList();
      return CG.filter(function (c) { return seen.indexOf(c.id) >= 0; });
    },
    /**
     * 剧情图鉴（首页🎬入口用）：一次列全部 CG + 解锁态，解锁判定的唯一权威。
     * level = 玩家当前关卡号（save.level）。
     * 解锁 = 看过（seen）**或**进度已越过触发点 —— 在设置里关掉「剧情动画」的玩家
     * 一路打过去也从没 seen 过任何一段，若只认 seen 他的图鉴会永远是一排锁，
     * 那正是「玩家已经通关却看不到」的坑。锁着的条目不返回 caption（不剧透）。
     */
    list: function (level) {
      var lv = (typeof level === 'number' && level > 0) ? level : 1;
      var seen = seenList();
      return CG.map(function (c) {
        // at===0 是开局那一段：开始第 1 关即触发，故越过它的判据是 lv>1
        var reached = c.at === 0 ? lv > 1 : lv > c.at;
        var open = seen.indexOf(c.id) >= 0 || reached;
        return { id: c.id, at: c.at, unlocked: open, caption: open ? tx(SUBS, c.k) : '' };
      });
    },
    /** 强制重播（回忆入口用），无视 seen。 */
    replay: function (id, done) {
      var seg = null;
      CG.forEach(function (c) { if (c.id === id) seg = c; });
      if (!seg) { if (done) done(); return; }
      play(seg, done);
    },
    /**
     * 触发判定（唯一权威）：at===0 首启；at>0 = 通关第 at 关结算后。
     * 无对应 CG / 已看过 / 取证 lane ⇒ 立刻 done()，调用方无需分支。
     */
    maybePlay: function (at, done) {
      var fin = done || function () {};
      try {
        // 截图/自检 lane 不挡取证画面
        if (/shot|selftest/.test(root.location.hash || '')) { note('skip'); fin(); return; }
        var seg = null;
        CG.forEach(function (c) { if (c.at === at) seg = c; });
        if (!seg) { fin(); return; }
        if (hasSeen(seg.id)) { note('seen'); fin(); return; }
        if (st) { fin(); return; }             // 已有 CG 在播，不叠加
        telemetry.played++;
        play(seg, fin);
      } catch (e) { note('error'); fin(); }
    }
  };

  rebuild();          // api 建好后生成第一版表（api.CG / api.MEDIA 由它填）
  root.MineStory = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof self !== 'undefined' ? self : this));
