'use strict';
/* core/identity.js 单测：单栏身份行的状态判定 + 改名跳转 URL 拼装（issue: 登录身份两栏合一）

   为什么这些断言这么细：首页原来「浏览器本机名字」和「run.ceo 账号」各占一栏，
   同一个人显示两个名字。合成一栏后，"名字听谁的 / 副标题说什么 / 右侧给哪个动作"
   必须是同一个纯函数算出来的唯一结论，否则又会各写一套漂开。
   改名一律跳平台（run.ceo 渲染改名页），所以 renameUrl 的参数名必须锁死契约。 */
const test = require('node:test');
const assert = require('node:assert');
const Id = require('./identity.js');

/* ---------------- resolve：9 种显示情况 ---------------- */

test('S1 平台连接中：名字先不显示，但要讲清进度存哪，且不给任何动作', () => {
  const v = Id.resolve({ mode: 'pending', tempName: '玩家3271' });
  assert.strictEqual(v.state, 'pending');
  assert.strictEqual(v.nameKind, 'none');
  assert.strictEqual(v.name, '');
  assert.strictEqual(v.sourceKey, null);
  assert.strictEqual(v.subKey, 'idSubPending');
  assert.strictEqual(v.badge, 'off');
  assert.deepStrictEqual(v.action, { kind: 'none', labelKey: null });
});

test('S2 未登录：显示不可编辑的临时名，唯一动作是登录', () => {
  const v = Id.resolve({ mode: 'online', user: null, tempName: '玩家3271' });
  assert.strictEqual(v.state, 'anon');
  assert.strictEqual(v.name, '玩家3271');
  assert.strictEqual(v.nameKind, 'temp');
  assert.strictEqual(v.sourceKey, 'idSrcTemp');
  assert.strictEqual(v.subKey, 'idSubAnon');
  assert.strictEqual(v.badge, 'off');
  assert.deepStrictEqual(v.action, { kind: 'login', labelKey: 'idActLogin' });
});

test('S3 已登录且平台给了名字：云端名说话，动作是进账号面板', () => {
  const v = Id.resolve({ mode: 'online', user: { id: 'u1', name: '朱克锋' }, tempName: '玩家3271' });
  assert.strictEqual(v.state, 'cloud');
  assert.strictEqual(v.name, '朱克锋');
  assert.strictEqual(v.nameKind, 'cloud');
  assert.strictEqual(v.sourceKey, 'idSrcCloud');
  assert.strictEqual(v.subKey, 'idSubCloud');
  assert.strictEqual(v.badge, 'ok');
  assert.deepStrictEqual(v.action, { kind: 'panel', labelKey: null });
});

test('S4 已登录但平台还没给名字：临时名顶着，动作是去平台改名', () => {
  const v = Id.resolve({ mode: 'online', user: { id: 'u1' }, tempName: '玩家3271' });
  assert.strictEqual(v.state, 'cloudTemp');
  assert.strictEqual(v.name, '玩家3271');
  assert.strictEqual(v.nameKind, 'temp');
  assert.strictEqual(v.sourceKey, 'idSrcTemp');
  assert.strictEqual(v.subKey, 'idSubCloudTemp');
  assert.strictEqual(v.badge, 'ok');
  assert.deepStrictEqual(v.action, { kind: 'rename', labelKey: 'idActRename' });
});

test('S4 变体：契约允许 name 缺失，空串/纯空格一律当没有名字（不是显示空白）', () => {
  for (const bad of ['', '   ', '\t']) {
    const v = Id.resolve({ mode: 'online', user: { id: 'u1', name: bad }, tempName: '玩家3271' });
    assert.strictEqual(v.state, 'cloudTemp', JSON.stringify(bad) + ' 应视为没有云端名');
    assert.strictEqual(v.name, '玩家3271');
  }
});

test('S5 登录过期：名字不跳回陌生名，转警示态并要求重新登录', () => {
  const v = Id.resolve({ mode: 'online', user: null, expired: true, lastName: '朱克锋', tempName: '玩家3271' });
  assert.strictEqual(v.state, 'expired');
  assert.strictEqual(v.name, '朱克锋', '过期不该把名字换成本机临时名，避免用户以为串号');
  assert.strictEqual(v.nameKind, 'stale');
  assert.strictEqual(v.subKey, 'idSubExpired');
  assert.strictEqual(v.badge, 'warn');
  assert.deepStrictEqual(v.action, { kind: 'relogin', labelKey: 'idActRelogin' });
});

test('S5 变体：过期但没有记住旧名时回落临时名，仍不显示空白', () => {
  const v = Id.resolve({ mode: 'online', user: null, expired: true, tempName: '玩家3271' });
  assert.strictEqual(v.state, 'expired');
  assert.strictEqual(v.name, '玩家3271');
  assert.strictEqual(v.sourceKey, 'idSrcTemp', '这时显示的确实是本机临时名');
});

test('S5 来源标签照实说：过期显示的是过期前的云端名，不能标成「临时名」误导用户', () => {
  const v = Id.resolve({ mode: 'online', user: null, expired: true, lastName: '朱克锋', tempName: '玩家3271' });
  assert.strictEqual(v.sourceKey, 'idSrcCloud');
});

test('S6 环境不支持云存档：既不给登录也不给改名（点了没反应最伤）', () => {
  const v = Id.resolve({ mode: 'local', reason: 'SDK_UNAVAILABLE', tempName: '玩家3271' });
  assert.strictEqual(v.state, 'unsupported');
  assert.strictEqual(v.name, '玩家3271');
  assert.strictEqual(v.nameKind, 'temp');
  assert.strictEqual(v.subKey, 'idSubUnsupported');
  assert.strictEqual(v.badge, 'off');
  assert.deepStrictEqual(v.action, { kind: 'none', labelKey: null });
});

test('名字一个都没有时兜底默认名，永不渲染空名字', () => {
  const v = Id.resolve({ mode: 'online', user: null, tempName: '', defaultKey: 'me' });
  assert.strictEqual(v.nameKind, 'fallback');
  assert.strictEqual(v.nameKey, 'me');
  assert.strictEqual(v.name, '');
});

test('resolve fail-fast：mode 必须是已知取值', () => {
  assert.throws(() => Id.resolve({ mode: 'weird' }), /mode/);
  assert.throws(() => Id.resolve(null), /必须是对象/);
});

test('头像首字：按码点取，emoji 名字不被截成半个字符', () => {
  assert.strictEqual(Id.avatarChar('朱克锋'), '朱');
  assert.strictEqual(Id.avatarChar('🎮player'), '🎮');
  assert.strictEqual(Id.avatarChar(''), '');
});

/* ---------------- renameUrl：参数名锁死平台契约 ---------------- */

test('renameUrl：按契约拼 /coder/play/nickname?slug&scope&return_to', () => {
  const url = Id.renameUrl({
    apex: 'https://run.ceo',
    slug: 'water-sort',
    returnTo: 'https://play-water-sort.run.ceo/'
  });
  const u = new URL(url);
  assert.strictEqual(u.origin + u.pathname, 'https://run.ceo/coder/play/nickname');
  assert.strictEqual(u.searchParams.get('slug'), 'water-sort');
  assert.strictEqual(u.searchParams.get('scope'), 'perGame', '默认只改本游戏的名称');
  assert.strictEqual(u.searchParams.get('return_to'), 'https://play-water-sort.run.ceo/');
  assert.strictEqual(u.searchParams.get('global_opt_in'), null, 'perGame 不该带全局同意参数');
});

test('renameUrl：global 改名必须显式带 global_opt_in=1（契约要求显式同意）', () => {
  const u = new URL(Id.renameUrl({
    apex: 'https://run.ceo', slug: 'water-sort',
    returnTo: 'https://play-water-sort.run.ceo/', scope: 'global'
  }));
  assert.strictEqual(u.searchParams.get('scope'), 'global');
  assert.strictEqual(u.searchParams.get('global_opt_in'), '1');
});

test('renameUrl fail-fast：scope 闭集、必填项、returnTo 必须是绝对 http(s)', () => {
  const base = { apex: 'https://run.ceo', slug: 'water-sort', returnTo: 'https://play-water-sort.run.ceo/' };
  assert.throws(() => Id.renameUrl(Object.assign({}, base, { scope: 'perAccount' })), /scope/);
  assert.throws(() => Id.renameUrl(Object.assign({}, base, { apex: '' })), /apex/);
  assert.throws(() => Id.renameUrl(Object.assign({}, base, { slug: '' })), /slug/);
  assert.throws(() => Id.renameUrl(Object.assign({}, base, { returnTo: '/home' })), /returnTo/);
  assert.throws(() => Id.renameUrl(Object.assign({}, base, { returnTo: 'javascript:alert(1)' })), /returnTo/);
});

/* ---------------- 回跳标记：改完名字回到游戏要能认出来 ---------------- */

test('markReturn：给回跳地址打自有标记，且不重复叠加', () => {
  const once = Id.markReturn('https://play-water-sort.run.ceo/');
  assert.strictEqual(new URL(once).searchParams.get('renamed'), '1');
  assert.strictEqual(Id.markReturn(once), once, '重复调用不该叠出两个 renamed 参数');
  const keep = Id.markReturn('https://play-water-sort.run.ceo/?autostart=3');
  assert.strictEqual(new URL(keep).searchParams.get('autostart'), '3', '不能吃掉原有参数');
});

test('takeRenameFlag：认出改名回跳并给出抹掉标记后的地址', () => {
  const hit = Id.takeRenameFlag('https://play-water-sort.run.ceo/?renamed=1&autostart=3');
  assert.strictEqual(hit.renamed, true);
  assert.strictEqual(new URL(hit.cleanUrl).searchParams.get('renamed'), null, '标记要抹掉，避免刷新页面重复提示');
  assert.strictEqual(new URL(hit.cleanUrl).searchParams.get('autostart'), '3');

  const miss = Id.takeRenameFlag('https://play-water-sort.run.ceo/');
  assert.strictEqual(miss.renamed, false);
  assert.strictEqual(miss.cleanUrl, 'https://play-water-sort.run.ceo/');
});

/* ---------------- 改名回来后名字到底变了没：必须能判定，不能静默 ---------------- */

test('renameOutcome：名字确实变了 → applied', () => {
  const r = Id.renameOutcome({ before: '玩家3271', after: '朱克锋' });
  assert.strictEqual(r.status, 'applied');
  assert.strictEqual(r.msgKey, 'idRenameApplied');
});

test('renameOutcome：回来了但名字没变 → 明确 stale 态，用户可分辨、日志可查', () => {
  const r = Id.renameOutcome({ before: '玩家3271', after: '玩家3271' });
  assert.strictEqual(r.status, 'stale');
  assert.strictEqual(r.msgKey, 'idRenameStale', '不能装作成功，要告诉用户新名字何时生效');
  assert.strictEqual(r.warn, true, '这条要能被日志/计数捕获，不是静默降级');
});

/* ---------------- 降级可观测性：不能只记一行日志，要能看出「是不是常态化了」 ---------------- */

test('trackRenameDegrade：首次降级 → streak/total 起步，未到阈值不告警', () => {
  const r = Id.trackRenameDegrade({ prev: null, outcome: { status: 'stale', warn: true }, at: 1000 });
  assert.strictEqual(r.streak, 1);
  assert.strictEqual(r.total, 1);
  assert.strictEqual(r.alert, false);
  assert.strictEqual(r.firstAt, 1000, '要记住第一次降级时间，才能算频率');
  assert.strictEqual(r.lastStatus, 'stale');
});

test('trackRenameDegrade：连续降级到阈值 → 反向告警（降级常态化本身就是故障）', () => {
  let s = null;
  for (const at of [1000, 2000]) s = Id.trackRenameDegrade({ prev: s, outcome: { status: 'stale', warn: true }, at });
  assert.strictEqual(s.alert, false, '第 2 次还不该告警');
  s = Id.trackRenameDegrade({ prev: s, outcome: { status: 'unknown', warn: true }, at: 3000 });
  assert.strictEqual(s.streak, 3);
  assert.strictEqual(s.alert, true, '连续 3 次降级必须告警，否则 100% 失败会被当正常降级');
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.firstAt, 1000, '首次时间不能被后续覆盖');
});

test('trackRenameDegrade：阈值可调（1 次即告警）', () => {
  const r = Id.trackRenameDegrade({ prev: null, outcome: { status: 'unknown', warn: true }, at: 5, threshold: 1 });
  assert.strictEqual(r.alert, true);
});

test('trackRenameDegrade：成功一次清零连续计数，但保留累计数（防偶尔成功洗白常态降级）', () => {
  let s = null;
  for (const at of [1, 2, 3]) s = Id.trackRenameDegrade({ prev: s, outcome: { status: 'stale', warn: true }, at });
  assert.strictEqual(s.alert, true);
  s = Id.trackRenameDegrade({ prev: s, outcome: { status: 'applied', warn: false, name: '朱克锋' }, at: 4 });
  assert.strictEqual(s.streak, 0, '成功后连续计数归零');
  assert.strictEqual(s.alert, false);
  assert.strictEqual(s.total, 3, '累计降级次数必须保留，否则看不出历史上出过问题');
  assert.strictEqual(s.lastStatus, 'applied');
});

test('renameOutcome 的成功结果字段叫 name（页面接线必须读这个，不是 after）', () => {
  const r = Id.renameOutcome({ before: '玩家3271', after: '朱克锋' });
  assert.strictEqual(r.name, '朱克锋');
  assert.strictEqual(r.after, undefined, '不存在 after 字段：接线读 after 会 toast 出 undefined');
});

test('renameOutcome：拿不到新名字（未登录/读取失败）→ unknown，不谎报成功', () => {
  const r = Id.renameOutcome({ before: '玩家3271', after: null });
  assert.strictEqual(r.status, 'unknown');
  assert.strictEqual(r.warn, true);
});
