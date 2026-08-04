// 局间插屏纯函数测试(issue #22)
const { test } = require('node:test');
const assert = require('node:assert');
const { DELAYS, pickInterstitialDelay } = require('./idlead.js');

test('idlead: 四态映射正确', () => {
  assert.strictEqual(pickInterstitialDelay(0), null);
  assert.strictEqual(pickInterstitialDelay(0.1), null);
  assert.strictEqual(pickInterstitialDelay(0.25), 5000);
  assert.strictEqual(pickInterstitialDelay(0.4), 5000);
  assert.strictEqual(pickInterstitialDelay(0.5), 10000);
  assert.strictEqual(pickInterstitialDelay(0.74), 10000);
  assert.strictEqual(pickInterstitialDelay(0.75), 20000);
  assert.strictEqual(pickInterstitialDelay(0.999), 20000);
});

test('idlead: 边界与非法输入回退 null', () => {
  assert.strictEqual(pickInterstitialDelay(0.2499999), null);
  assert.strictEqual(pickInterstitialDelay(0.4999999), 5000);
  assert.strictEqual(pickInterstitialDelay(0.7499999), 10000);
  assert.strictEqual(pickInterstitialDelay(0.9999999), 20000);
  // 越界/非法:安全不弹
  assert.strictEqual(pickInterstitialDelay(1), null);
  assert.strictEqual(pickInterstitialDelay(-0.1), null);
  assert.strictEqual(pickInterstitialDelay(NaN), null);
  assert.strictEqual(pickInterstitialDelay(Infinity), null);
  assert.strictEqual(pickInterstitialDelay('0.5'), null);
  assert.strictEqual(pickInterstitialDelay(undefined), null);
  assert.strictEqual(pickInterstitialDelay(null), null);
});

test('idlead: 均匀性抽样(LCG 10000 次,每态约 25%)', () => {
  // 确定性 LCG,避免测试抖动
  let seed = 123456789;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const counts = new Map(DELAYS.map((d) => [d, 0]));
  const N = 10000;
  for (let i = 0; i < N; i++) {
    const d = pickInterstitialDelay(rand());
    assert.ok(counts.has(d), 'result must be one of DELAYS');
    counts.set(d, counts.get(d) + 1);
  }
  for (const [d, c] of counts) {
    assert.ok(c > N * 0.2 && c < N * 0.3, `bucket ${d} ratio off: ${c}/${N}`);
  }
});
