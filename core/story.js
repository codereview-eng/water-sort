/* core/story.js —— 剧情 CG 通用层（2026-08-29 由彩雷的 mine-story.js 下沉）。

   一句话：**游戏侧只写配置**，播放机、已看记录、解锁判定、图鉴列表全在这里。
   彩雷之外的游戏想要自己的 CG，只需在 game.config.json 里加一段 story，
   页面上 `StoryCore.create(CFG.story)` 即可，一行代码都不用抄。

   播放机来源：作品广场《黎明崛起》线上产物的逐行移植（2026-08-27 拆解），
   设计与红线见 color-mines/STORY-FRAMEWORK.md §7.2。**禁止另造一套播 CG 的方式。**

   四条不变量（改这个文件前先读）：
     1. 任何异步分支最终必须走向 advance 或 end —— 不存在「什么都不做」的分支；
     2. end 幂等，st.done 是全局熔断，所有回调开头先查；
     3. 进度条读满再进 CG，绝不边播边解码；
     4. 资源用逻辑键标识，真实路径只存在于 MEDIA 映射表里 —— 换托管方式零改代码。

   降级可观测（AGENTS 纪律：静默降级必须能回答「为什么降级、降级了多少次」）：
     每次跳过都记 reason（timeout|blocked|missing|error|skip|seen），
     计数落 instance.telemetry，可被自检/埋点读走。

   配置形状（全部可选项都有缺省，最小配置只要 count）：
     {
       cadence: 100,          // 每多少关一段（首段固定挂在开局）
       count: 11,             // 段数（含开局段）；加 1000 关就是 count += 10
       volume: 10,            // 图鉴里每卷收多少段
       seenKey: '<游戏前缀>.story.seen',  // 已看记录的存档键（**每个游戏必须不同，否则串档**）
       media: { video: 'cg/cg{i}.mp4', bgm: 'cg/bgm{i}.opus' },  // {i} = 段序号
       overrides: { cg0: { cues: [...] } },   // 只有需要特殊待遇的段才写
       subs: { cg0: { zh: '…', en: '…' } },   // 字幕表（唯一合法的中文出现点）
       ui:   { skip: { zh, en }, loading: { zh, en } }
     } */
(function (root) {
  'use strict';

  var DEFAULTS = {
    cadence: 100,
    volume: 10,
    seenKey: 'story.seen',
    media: { video: 'cg/cg{i}.mp4', bgm: 'cg/bgm{i}.opus' },
    ui: {
      skip: { zh: '跳过 ▶', en: 'Skip ▶' },
      loading: { zh: '加载中', en: 'Loading' }
    }
  };
  var WATCHDOG_MS = 4000;    // 设计定案：4 秒内 readyState<2 即无感放行
  var GO_FALLBACK_MS = 2500; // playing 事件没来也要收 loading 层

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function create(cfg, win) {
    var conf = cfg || {};
    var rootWin = win || root;
    var plan = {
      cadence: conf.cadence > 0 ? Math.floor(conf.cadence) : DEFAULTS.cadence,
      count: conf.count > 0 ? Math.floor(conf.count) : 0
    };
    var volSize = conf.volume > 0 ? Math.floor(conf.volume) : DEFAULTS.volume;
    var SEEN_KEY = conf.seenKey || DEFAULTS.seenKey;
    var mediaTpl = conf.media || DEFAULTS.media;
    var OVERRIDES = conf.overrides || {};
    var SUBS = conf.subs || {};
    var UI = conf.ui || DEFAULTS.ui;

    /* ── 剧情表由规则生成：加关卡只改 count，不必手写 id / 路径 / 映射 ──────
       段 i：id=cgN，at = i===0 ? 0 : i*cadence；素材路径按 media 模板展开。
       字幕 key 同 id；subs 里没写的段自动没有字幕（章节名照常显示，不阻塞加关卡）。 */
    var MEDIA = {}, CG = [];
    function pathOf(tpl, i) { return String(tpl).replace(/\{i\}/g, String(i)); }
    function rebuild() {
      MEDIA = {}; CG = [];
      for (var i = 0; i < plan.count; i++) {
        var v = pathOf(mediaTpl.video, i);
        var m = mediaTpl.bgm ? pathOf(mediaTpl.bgm, i) : '';
        MEDIA[v] = v;
        if (m) MEDIA[m] = m;
        var seg = { id: 'cg' + i, at: i === 0 ? 0 : i * plan.cadence, v: v, m: m, k: 'cg' + i };
        var ov = OVERRIDES[seg.id];
        if (ov) { for (var key in ov) { if (Object.prototype.hasOwnProperty.call(ov, key)) seg[key] = ov[key]; } }
        CG.push(seg);
      }
      if (api) { api.CG = CG; api.MEDIA = MEDIA; }
    }

    var telemetry = { played: 0, skipped: 0, reasons: {} };
    function note(reason) {
      telemetry.reasons[reason] = (telemetry.reasons[reason] || 0) + 1;
      if (reason !== 'seen') {
        telemetry.skipped++;
        // 只看日志就能判断「为什么降级」——禁止裸跳过
        try { console.warn('[story] cg degraded reason=' + reason); } catch (e) {}
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
        var raw = rootWin.localStorage.getItem(SEEN_KEY);
        var arr = raw ? JSON.parse(raw) : [];
        return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
      } catch (e) { return []; }
    }
    function markSeen(id) {
      sessionPlayed[id] = true;
      try {
        var arr = seenList();
        if (arr.indexOf(id) < 0) { arr.push(id); rootWin.localStorage.setItem(SEEN_KEY, JSON.stringify(arr)); }
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
      var ov = rootWin.document.createElement('div');
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
        // 跳过键贴在右上角：页面开了 viewport-fit=cover 后那里正是刘海/挖孔与圆角，
        // 必须按安全区让位，否则在部分手机上被切掉一半（没开 cover 的页 env() 为 0，位置不变）。
        + '<button id="cgSkip" type="button" style="position:absolute;'
        + 'right:calc(14px + env(safe-area-inset-right, 0px));top:calc(14px + env(safe-area-inset-top, 0px));z-index:2;'
        + 'font-size:12px;padding:6px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.35);'
        + 'background:rgba(0,0,0,.45);color:#f0e6d2;cursor:pointer"></button>';
      rootWin.document.body.appendChild(ov);
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
          rootWin.fetch(url).then(function (r) {
            if (!r || !r.ok) throw new Error('http ' + (r && r.status));
            return r.blob();
          }).then(function (b) {
            try { BLOB[k] = rootWin.URL.createObjectURL(b); } catch (e) {}
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
      var t = rootWin.setInterval(function () {
        i++;
        try { a.volume = Math.max(0, v * (1 - i / steps)); } catch (e) {}
        if (i >= steps) { rootWin.clearInterval(t); try { a.pause(); } catch (e) {} }
      }, 55);
    }

    /* 起播 BGM。幂等：已经在播就直接返回，可被 go() / 每次手势重复调用。
       被自动播放策略挡掉时**必须把 st.bgm 清回 null** —— 否则「挡掉过一次」
       会被后面的幂等判定当成「已经在播」，玩家再怎么点也补不回声音。 */
    function startBgm(seg) {
      if (!seg || !seg.m || !st || st.muted || st.bgm) return;
      try {
        var a = new rootWin.Audio(res(seg.m));
        a.volume = 0.75;
        st.bgm = a;
        // BGM 不参与完成门（它是背景，不是内容）——出错不阻塞 CG，但要留下降级原因
        a.play()['catch'](function (err) {
          if (st && st.bgm === a) st.bgm = null;   // 让下一次手势能再试一次
          note('blocked');
          try {
            console.warn('[story] bgm blocked err_name=' + ((err && err.name) || 'unknown')
              + ' err_msg=' + String((err && err.message) || err).slice(0, 200));
          } catch (e2) {}
        });
      } catch (e) {
        if (st) st.bgm = null;
        note('error');
      }
    }

    /* 收口：幂等（不变量 2）*/
    function end(reason) {
      if (!st || st.done) return;
      st.done = true;
      if (reason) note(reason);
      stopBgm(true);
      if (st.wd) { rootWin.clearTimeout(st.wd); st.wd = null; }
      if (st.goT) { rootWin.clearTimeout(st.goT); st.goT = null; }
      unbindUnlock();
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

    /* 双完成门：视频与音轨各自到齐才推进（这里单段 ⇒ 推进即收口）。 */
    function advance(which) {
      if (!st || st.done || !st.pend) return;
      st.pend[which] = true;
      if (st.pend.vid && st.pend.aud) { st.pend = null; end(null); }
    }

    function unmute() {
      if (!st || st.done) return false;
      if (st.muted) {
        st.muted = false;
        try {
          dom.vid.muted = false;
          dom.vid.defaultMuted = false;
          dom.vid.volume = 1;
        } catch (e) {}
      }
      startBgm(st.seg);   // 补上被静音策略挡掉的 BGM（幂等，可重复调）
      return true;
    }
    /* 手势兜底：整段 CG 期间一直挂着，不因为「已经解过一次静音」就摘掉 ——
       BGM 起播可能被策略挡掉（异步 reject），摘早了玩家就再也补不回声音。
       监听器统一由 end() 摘除（曾经只在这里摘 ⇒ 未触发手势的 CG 会留下泄漏）。 */
    function unlock() { unmute(); }
    function bindUnlock() {
      rootWin.document.addEventListener('pointerdown', unlock);
      rootWin.document.addEventListener('keydown', unlock);
    }
    function unbindUnlock() {
      try {
        rootWin.document.removeEventListener('pointerdown', unlock);
        rootWin.document.removeEventListener('keydown', unlock);
      } catch (e) {}
    }
    /* 页面是否已经拿到过用户激活（sticky activation）。拿到过就可以直接有声起播：
       重播/通关触发都发生在一次真实点击之后，再等「下一次手势」等于永远静音。 */
    function hasUserActivation() {
      try {
        var ua = rootWin.navigator && rootWin.navigator.userActivation;
        return !!(ua && ua.hasBeenActive);
      } catch (e) { return false; }
    }

    function play(seg, done, opt) {
      var d = ensureDom();
      /* 有声起播的条件：调用方明确说「这次由用户手势直接触发」（图鉴重播），
         或页面已经拿到过用户激活。被策略挡掉也不丢 CG —— 下面会退回静音起播。 */
      var canSound = !!(opt && opt.gesture) || hasUserActivation();
      st = { seg: seg, done: false, done_cb: done, muted: !canSound, pend: null, bgm: null, wd: null, goT: null };

      d.skip.textContent = tx(UI, 'skip');
      d.skip.onclick = function () { end('skip'); };
      var cues = (seg.cues && seg.cues.length) ? seg.cues : null;
      d.sub.textContent = cues ? '' : tx(SUBS, seg.k);
      d.sub.style.opacity = '0';
      d.ov.style.display = 'flex';
      d.load.style.display = 'flex';
      d.vid.style.visibility = 'hidden';

      bindUnlock();

      var keys = [seg.v];
      if (seg.m) keys.push(seg.m);

      preload(keys, function () {
        if (!st || st.done) return;
        // 资源键缺失 ⇒ 静默跳过，不弹任何错误
        if (!MEDIA[seg.v]) { end('missing'); return; }

        st.pend = { vid: false, aud: false };
        advance('aud');            // 无旁白 ⇒ 音轨门立即满足

        var started = false;
        var go = function () {
          if (started || !st || st.done) return;
          started = true;
          try { d.load.style.display = 'none'; } catch (e) {}
          try { d.vid.style.visibility = 'visible'; } catch (e) {}   // playing 后再显示，消黑闪
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
          rootWin.setTimeout(function () {
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
        st.goT = rootWin.setTimeout(go, GO_FALLBACK_MS);
        d.vid.onended = function () { advance('vid'); };
        d.vid.onerror = function () { end('error'); };   // 不变量 1

        // 看门狗：弱网/解码不动即无感放行
        st.wd = rootWin.setTimeout(function () {
          if (st && !st.done && d.vid.readyState < 2) end('timeout');
        }, WATCHDOG_MS);

        try {
          // 有用户激活就直接有声起播；没有才静音起播绕开自动播放策略
          d.vid.muted = st.muted;
          d.vid.defaultMuted = st.muted;
          if (!st.muted) { try { d.vid.volume = 1; } catch (e2) {} }
          d.vid.src = res(seg.v);
          var p = d.vid.play();
          if (p && p['catch']) p['catch'](function (err) {
            if (!st || st.done) return;
            if (!st.muted) {
              // 有声起播被策略挡掉 ⇒ 退回静音起播 + 留着手势兜底，别丢整段 CG
              st.muted = true;
              note('blocked');
              try {
                console.warn('[story] unmuted start blocked err_name=' + ((err && err.name) || 'unknown')
                  + ' err_msg=' + String((err && err.message) || err).slice(0, 200));
              } catch (e3) {}
              try { d.vid.muted = true; d.vid.defaultMuted = true; } catch (e4) {}
              var p2 = d.vid.play();
              if (p2 && p2['catch']) p2['catch'](function () { end('blocked'); });
              return;
            }
            end('blocked');
          });
        } catch (e) { end('error'); }
      });
    }

    /* ── 图鉴视图模型：分卷 + 连续锁段合并（列表行数 O(卷数 + 一卷段数)）──
       平铺是 O(段数)：1 万关 101 段 ≈ 8.6 屏；分卷后约 20 行。 */
    function listOf(level) {
      var lv = (typeof level === 'number' && level > 0) ? level : 1;
      var seen = seenList();
      return CG.map(function (c, i) {
        // 解锁 = 看过 或 进度已越过触发点。只认「看过」的话，关掉剧情动画的玩家
        // 一路打过去图鉴永远是一排锁（「已通关却看不到」）。
        var reached = c.at === 0 ? lv > 1 : lv > c.at;
        var open = seen.indexOf(c.id) >= 0 || reached;
        return { id: c.id, at: c.at, i: i, unlocked: open, caption: open ? tx(SUBS, c.k) : '' };
      });
    }

    function gallery(level) {
      var rows = listOf(level);
      var span = plan.cadence * volSize;      // 一卷覆盖多少关
      var vols = [], byG = {};
      rows.forEach(function (r) {
        var g = r.at === 0 ? 1 : Math.ceil(r.at / span);
        if (!byG[g]) { byG[g] = { g: g, from: (g - 1) * span + 1, to: g * span, items: [], unlocked: 0 }; vols.push(byG[g]); }
        byG[g].items.push(r);
        if (r.unlocked) byG[g].unlocked++;
      });
      /* 当前卷 = 含第一个还没解锁的段那一卷；全通则最后一卷。
         打开图鉴永远直接看到「我在哪」，不用先滚过前面所有卷。 */
      var current = vols.length ? vols[vols.length - 1].g : 1;
      for (var i = 0; i < vols.length; i++) {
        var anyLocked = false;
        for (var j = 0; j < vols[i].items.length; j++) { if (!vols[i].items[j].unlocked) anyLocked = true; }
        if (anyLocked) { current = vols[i].g; break; }
      }
      return { vols: vols, current: current, total: rows.length };
    }

    /* 图鉴 markup：文案由宿主的 t() 提供（键名见下），样式由 StoryCore.styles() 提供。
       宿主只要把返回的 html 塞进容器 + 委托点击即可，别的游戏零抄代码。
       用到的翻译键：storyPrologue / storyChapter{n} / storyChapterRange{from,to} /
       storyLockedStart / storyLockedAt{n} / storyLockedFrom{n} / storyReplay /
       storyVolume{n} / storyVolumeRange{from,to} / storyVolumeProgress{n,total} / storyEmpty */
    function galleryHtml(opt) {
      var o = opt || {};
      var t = o.t || function (k) { return k; };
      var model = gallery(o.level);
      var open = o.open;
      if (!open) { open = {}; open[model.current] = true; }
      if (!model.total) return { html: '<p class="bagempty">' + esc(t('storyEmpty')) + '</p>', open: open, current: model.current };

      function nameOf(x) { return x.at === 0 ? t('storyPrologue') : t('storyChapter', { n: x.i }); }
      function lockedRow(x) {
        var lock = x.at === 0 ? t('storyLockedStart') : t('storyLockedAt', { n: x.at });
        return '<div class="bagrow cgrow locked">'
          + '<span class="bagicon" aria-hidden="true">🔒</span>'
          + '<span class="baginfo"><b>' + esc(nameOf(x)) + '</b><span>' + esc(lock) + '</span></span></div>';
      }
      /* 连续锁着的段合并成一行：锁着的段没有信息量，逐行铺开只是让玩家白滚，
         一行既省地方，又把「下一段从哪开始解锁」说清楚。 */
      function lockedRangeRow(run) {
        return '<div class="bagrow cgrow locked">'
          + '<span class="bagicon" aria-hidden="true">🔒</span>'
          + '<span class="baginfo"><b>'
          + esc(t('storyChapterRange', { from: run[0].i, to: run[run.length - 1].i })) + '</b><span>'
          + esc(t('storyLockedFrom', { n: run[0].at })) + '</span></span></div>';
      }
      function playRow(x) {
        return '<button type="button" class="bagrow cgrow" data-cg="' + esc(x.id) + '">'
          + '<span class="bagicon" aria-hidden="true">▶</span>'
          + '<span class="baginfo"><b>' + esc(nameOf(x)) + '</b><span>' + esc(x.caption) + '</span></span>'
          + '<span class="cgplay">' + esc(t('storyReplay')) + '</span></button>';
      }
      function volRow(v) {
        return '<button type="button" class="bagrow volrow" data-vol="' + v.g + '" aria-expanded="'
          + (open[v.g] ? 'true' : 'false') + '">'
          + '<span class="baginfo"><b>' + esc(t('storyVolume', { n: v.g })) + '</b><span>'
          + esc(t('storyVolumeRange', { from: v.from, to: v.to })) + ' · '
          + esc(t('storyVolumeProgress', { n: v.unlocked, total: v.items.length })) + '</span>'
          + '<span class="volbar"><i style="width:' + Math.round(v.unlocked * 100 / v.items.length) + '%"></i></span></span>'
          + '<span class="volcar" aria-hidden="true">' + (open[v.g] ? '▾' : '▸') + '</span></button>';
      }
      function segRows(items) {
        var out = [], run = [];
        var flush = function () {
          if (!run.length) return;
          out.push(run.length === 1 ? lockedRow(run[0]) : lockedRangeRow(run));
          run = [];
        };
        for (var q = 0; q < items.length; q++) {
          var it = items[q];
          if (it.unlocked) { flush(); out.push(playRow(it)); }
          else if (it.at === 0) { flush(); out.push(lockedRow(it)); }   // 序章不并进「第 N–M 章」
          else run.push(it);
        }
        flush();
        return out.join('');
      }

      var html = '';
      for (var k = 0; k < model.vols.length; k++) {
        // 只有一卷时不画卷头：段数还少的时候不该多出一层没必要的壳
        if (model.vols.length > 1) html += volRow(model.vols[k]);
        if (model.vols.length === 1 || open[model.vols[k].g]) html += segRows(model.vols[k].items);
      }
      return { html: html, open: open, current: model.current };
    }

    var api = {
      telemetry: telemetry,
      CG: CG,
      MEDIA: MEDIA,
      SUBS: SUBS,
      seenKey: SEEN_KEY,
      setLang: function (l) { lang = (l === 'en') ? 'en' : 'zh'; },
      plan: function () { return { cadence: plan.cadence, count: plan.count, volume: volSize }; },
      setPlan: function (p) {
        if (p && p.cadence > 0) plan.cadence = Math.floor(p.cadence);
        if (p && p.count > 0) plan.count = Math.floor(p.count);
        if (p && p.volume > 0) volSize = Math.floor(p.volume);
        rebuild();
        return { cadence: plan.cadence, count: plan.count, volume: volSize };
      },
      /** 图鉴：全部段 + 解锁态（锁着的不返回字幕，不剧透） */
      list: listOf,
      /** 图鉴分卷视图模型（宿主想自己画就用它） */
      gallery: gallery,
      /** 图鉴 markup（宿主直接塞进容器；样式见 StoryCore.styles()） */
      galleryHtml: galleryHtml,
      /** 已解锁（看过）的段 */
      unlocked: function () {
        var seen = seenList();
        return CG.filter(function (c) { return seen.indexOf(c.id) >= 0; });
      },
      /** 强制重播（图鉴用），无视 seen。
          图鉴重播必然由玩家点击触发 ⇒ gesture:true 直接有声起播。
          （历史坑：点击的 pointerdown 早于播放机注册的手势监听器，
            再等「下一次手势」等于整段重播全程静音。） */
      replay: function (id, done) {
        var seg = null;
        CG.forEach(function (c) { if (c.id === id) seg = c; });
        if (!seg) { if (done) done(); return; }
        play(seg, done, { gesture: true });
      },
      /**
       * 触发判定（唯一权威）：at===0 首启；at>0 = 通关第 at 关结算后。
       * 无对应 CG / 已看过 / 取证 lane ⇒ 立刻 done()，调用方无需分支。
       */
      maybePlay: function (at, done) {
        var fin = done || function () {};
        try {
          // 截图/自检 lane 不挡取证画面
          if (/shot|selftest/.test((rootWin.location && rootWin.location.hash) || '')) { note('skip'); fin(); return; }
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
    rebuild();
    return api;
  }

  /* 图鉴样式：跟着模块一起放在 core —— 不搬进来，别的游戏还得各抄一份 CSS。
     行的底样式（.bagrow）沿用宿主的列表行样式，这里只加图鉴特有的三块。 */
  function styles() {
    return [
      '.cgrow{width:100%; font:inherit; margin:0;}',
      'button.cgrow{cursor:pointer;}',
      'button.cgrow:hover{border-color:var(--accent);}',
      '.cgrow.locked{cursor:default;}',
      '.cgrow.locked .baginfo b{color:var(--ink-3);}',
      '.cgrow .cgplay{flex:0 0 auto; font-size:12px; font-weight:700; color:var(--accent);}',
      '.volrow{width:100%; font:inherit; margin:6px 0 0; cursor:pointer; border-color:var(--edge);}',
      '.volrow:hover{border-color:var(--accent);}',
      '.volrow .volcar{flex:0 0 auto; font-size:12px; color:var(--ink-3);}',
      '.volrow .volbar{display:block; height:4px; border-radius:3px; margin-top:5px;',
      '  background:rgba(127,127,127,.22); overflow:hidden;}',
      '.volrow .volbar i{display:block; height:100%; background:var(--accent);}'
    ].join('\n');
  }

  var StoryCore = { create: create, styles: styles };
  root.StoryCore = StoryCore;
  if (typeof module === 'object' && module.exports) module.exports = StoryCore;
}(typeof self !== 'undefined' ? self : this));
