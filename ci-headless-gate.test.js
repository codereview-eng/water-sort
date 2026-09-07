'use strict';
/* 门禁：「没有现成的 Chrome 调试端口」不许再当作跳过运行时 gate 的理由，
   而「这台机器没装 Chrome」也不许被误报成「多语言有问题」。

   首坏现场（2026-09-07）：scripts/ci.sh 的门禁 3（英文模式逐屏扫残留中文）依赖
   一个开着 --remote-debugging-port 的 Chrome。本机 chrome-cu-1/2/3 不一定开着，
   于是这道门禁长期打印 SKIP —— 而 SKIP 不是通过，等于多语言运行时面根本没被守住。
   接上 with-headless-chrome.mjs 之后又发现第二个坑：包装器在 CHROME_BIN 写错时
   让 node 以**退出码 1** 崩掉，而 ci.sh 把 1 读作「门禁发现了残留中文」——
   一句「没装浏览器」被报成「多语言有问题」，是最难查的那种假红。

   所以这里锁三件事（都是纯静态检查，不需要真起浏览器）：
     ① ci.sh 在 rc=2 时会自己起一个独立 headless Chrome 再真跑一次；
     ② 包装器把「起不了浏览器」归一化成退出码 2（= SKIP 的约定），并记异常本体；
     ③ 包装器把「子命令起不来」归一化成退出码 1（真失败），两者不许混为一谈。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ci = readFileSync(join(__dirname, 'scripts/ci.sh'), 'utf8');
const wrap = readFileSync(join(__dirname, 'scripts/with-headless-chrome.mjs'), 'utf8');

test('ci.sh：没有现成端口时自己起 headless Chrome 再真跑一次', () => {
  assert.match(ci, /rc" -eq 2 \]; then[\s\S]{0,300}?with-headless-chrome\.mjs node scripts\/i18n-cjk-scan\.mjs/,
    'rc=2 之后必须用独立 headless Chrome 重跑一次，否则 SKIP 就成了常态放行');
  assert.match(ci, /with-headless-chrome\.mjs node scripts\/i18n-cjk-scan\.mjs\s*\n\s*rc=\$\?/,
    '重跑的退出码必须回写 rc，否则后面的判断读的是上一次的结果');
});

test('包装器：起不了浏览器 = 退 2（SKIP 约定），且必须说出为什么', () => {
  assert.match(wrap, /chrome\.on\('error'/, 'spawn 失败必须捕获，不能让 node 崩掉');
  assert.match(wrap, /err_name[\s\S]{0,120}?err_msg/,
    '降级分支要记异常本体（本机纪律第 5 条）：只看日志就能判断为什么没起来');
  assert.match(wrap, /spawnErr[\s\S]{0,400}?process\.exit\(2\)/,
    '起不了浏览器必须退 2，退 1 会被 ci.sh 读成「发现了残留中文」');
});

test('包装器：子命令起不来 = 退 1（真失败），不许混进 SKIP', () => {
  assert.match(wrap, /child\.on\('error'[\s\S]{0,400}?process\.exit\(1\)/,
    '命令名写错是真失败，退 2 会被当作「没浏览器」而放行');
});
