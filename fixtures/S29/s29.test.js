/* S29 广告位声明差异（issue #1 场景清单 · L 广告位泛化）
   验收：A 关前插屏；B 连胜领奖激励视频；C 皮肤解锁激励视频；D 恢复失败
   视频——placement 全部 config 声明；ads core 只有一条通用「播放+成功/
   失败回调」链，各 placement 无专属代码。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PL = require('../../core/placements.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs.json'), 'utf8'));
const gameCfg = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'games', id, 'game.config.json'), 'utf8'));

test('S29: 四类 placement 同一条播放链——无专属代码，只有声明差异', () => {
  const okProvider = () => true;
  const w = PL.create(FIX.water, okProvider);
  const s = PL.create(FIX.sudoku, okProvider);
  assert.equal(w.show('pre-level-interstitial', {}, 0).granted, false, 'A 插屏不发奖');
  assert.equal(w.show('streak-claim', {}, 0).granted, true, 'B 领奖视频成功即发');
  assert.equal(s.show('cosmetic-unlock', {}, 0).granted, true, 'C 解锁视频');
  assert.equal(s.show('fail-revive', {}, 0).granted, true, 'D 恢复失败视频');
});

test('S29: mock 游戏 C fake provider 两档（秒成/必败）验收全部 onFail 分支', () => {
  const grantOnFail = PL.create({ x: { format: 'rewarded', onFail: 'grant' } }, () => false);
  assert.equal(grantOnFail.show('x', {}, 0).granted, true, '必败 + onFail:grant → 兜底发放（发奖校验不信任客户端网络）');
  const deny = PL.create(FIX.mockc, () => false);
  assert.equal(deny.show('streak-revive', {}, 0).granted, false, '必败 + onFail:deny → 不发');
  const retry = PL.create({ x: { format: 'rewarded', onFail: 'retry' } }, () => false);
  assert.equal(retry.show('x', {}, 0).retry, true, '必败 + onFail:retry → 提示重试');
  const instant = PL.create(FIX.mockc, () => true);
  assert.equal(instant.show('streak-revive', {}, 0).granted, true, '秒成即发');
});

test('S29: J/K 组按 id 引用——引用不存在 placement 一律拒绝', () => {
  const pl = PL.create(FIX.water, () => true);
  assert.throws(() => pl.assertId('cosmetic-unlock'), /引用不存在 placement/, 'water 没声明皮肤解锁位');
  assert.throws(() => pl.show('ghost', {}, 0), /引用不存在 placement/);
});

test('S29: 真实游戏 config placements 落地且组合互不相同', () => {
  const ids = {};
  for (const id of ['water', 'sudoku', 'mockc']) {
    ids[id] = PL.create(gameCfg(id).ads.placements, () => true).ids().sort();
  }
  assert.ok(ids.water.includes('pre-level-interstitial'));
  assert.ok(ids.mockc.length < ids.water.length, 'mockc 声明最少');
  assert.notDeepEqual(ids.water, ids.sudoku);
});
