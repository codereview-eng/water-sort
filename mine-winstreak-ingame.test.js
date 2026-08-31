'use strict';
/* 门禁：局内（超时/踩雷）不许判连胜、不许弹连胜窗（用户拍板 2026-08-31）。

   首坏现场（2026-08-31 真页面复现，独立 headless + CDP）：
   倒计时归零弹的是「⏰ 时间到 / 看广告 +60s / 重开本关」——这一步是对的；
   但点「重开本关」立刻被 wsGate 拽进「🔥 3 连胜断了!」，玩家想的是把这关过掉，
   却被要求再看一段广告保连胜 = 双重打扰。连胜的断裂只该在【开局门】问一次。

   断言策略：先剥掉注释再取函数体，否则「注释里写了 wsKeepDialog」会把门禁自己
   误报成违规（教训见 repo memory「HTML 门禁 regex 会自我误报」）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = __dirname;
const mineRaw = readFileSync(join(ROOT, 'mine.html'), 'utf8');

/* 只剥块注释与「整行以 // 开头」的行注释：不碰字符串里的 https:// */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}
const mine = stripComments(mineRaw);

/* 按大括号配平取具名函数体（注释已剥，括号不会被注释里的字符干扰） */
function fnBody(src, name) {
  const head = src.indexOf('function ' + name + '(');
  assert.ok(head !== -1, `找不到函数 ${name}`);
  const open = src.indexOf('{', head);
  assert.ok(open !== -1, `${name} 没有函数体`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error(`${name} 大括号不配平`);
}

for (const fn of ['onTimeUp', 'onDead']) {
  test(`${fn}：局内失败出口不得弹连胜窗`, () => {
    const body = fnBody(mine, fn);
    assert.ok(!body.includes('wsKeepDialog'), `${fn} 里不许弹连胜断链窗（连胜只在开局门判）`);
    assert.ok(!body.includes('wsGate'), `${fn} 里不许走连胜开局门`);
    // 记账仍要保留：重开与关窗两条出口各记一次，断链留给开局门去问
    assert.equal((body.match(/wsOnLose\(\)/g) || []).length, 2,
      `${fn} 的重开与关窗两条出口仍必须各记一次断链`);
  });
}

test('onTimeUp：超时的主按钮就是「看广告 +60 秒」，不是连胜相关', () => {
  const body = fnBody(mine, 'onTimeUp');
  assert.ok(body.includes("watchAdFor('time-bonus'"), '超时必须走 time-bonus 广告位加时');
  assert.ok(body.includes('AD_TIME_BONUS'), '超时必须按 AD_TIME_BONUS 加时');
  assert.ok(/timeUpTitle/.test(body), '超时弹窗标题必须是「时间到」那条文案');
  assert.ok(!/wsKeep|wsDrop/.test(body), '超时弹窗不得出现任何连胜文案');
});

test('wsGate 这道多余的门已删除，全文只剩一处开局门', () => {
  assert.ok(!/function wsGate\s*\(/.test(mine), 'wsGate 应已删除（它唯一的调用点是局内出口）');
  assert.ok(!/wsGate\s*\(/.test(mine), '不许再有 wsGate 调用');
  assert.equal((mine.match(/wsKeepDialog\(/g) || []).length, 2,
    '连胜断链窗应只有「定义 + 开局门调用」两处');
});

test('开局门仍在 startGame 首部：pend 未决时先问，再放行开局', () => {
  const body = fnBody(mine, 'startGame');
  assert.ok(body.includes('.pend'), '开局门必须判 pend');
  assert.ok(body.includes('wsKeepDialog('), '开局门必须先弹保持窗');
  // 必须在扣体力之前问，否则玩家答完窗口体力已经扣掉了
  assert.ok(body.indexOf('wsKeepDialog(') < body.indexOf('save.energy -='),
    '开局门必须早于扣体力');
});

test('wsOnWin：带着未决断链通关 = 赢回来，先 keep 再 win（不许把 pend 丢给内核抛错）', () => {
  const body = fnBody(mine, 'wsOnWin');
  assert.ok(body.includes('.pend'), 'wsOnWin 必须判 pend');
  const iKeep = body.indexOf('WinStreak.keep(');
  const iWin = body.indexOf('WinStreak.win(');
  assert.ok(iKeep !== -1, 'wsOnWin 必须先 keep 掉未决断链');
  assert.ok(iKeep < iWin, 'keep 必须在 win 之前（内核对 pend 是 fail-close 抛错）');
});

test('core 语义验证：pend 状态下 keep→win 让连胜续上而不是清零', () => {
  const WinStreakCore = require('./core/winstreak.js');
  const ws = WinStreakCore.create({ enabled: true, keepMinPrompt: 3, every: 10,
    rewards: { energy: 60, coins: 10, frags: 10 } });
  // 3 连胜后失败 → 挂 pend（大连胜不静默清零）
  const lost = ws.lose(ws.from({ cur: 3, pend: false, cyc: 3, earned: 0, claimed: 0 })).state;
  assert.equal(lost.pend, true);
  assert.equal(lost.cur, 3, '挂 pend 时连胜数先保留');
  // 重开本关并通关：宿主先 keep 再 win
  const kept = ws.keep(ws.from(lost));
  const won = ws.win(ws.from(kept)).state;
  assert.equal(won.pend, false);
  assert.equal(won.cur, 4, '赢回来应该续上连胜（3 → 4），不是从 1 重新数');
  // 反面：带着 pend 直接 win 必须抛错（这就是必须先 keep 的原因）
  assert.throws(() => ws.win(ws.from(lost)), /未决的断链/);
});
