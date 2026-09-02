# color-mines 发布流程

一句话：**构建 → 发布 → 立刻验线上**。第三步不是可选的 —— #57 的整站白屏就是漏了它。

## 为什么第三步非做不可

2026-09-01 那次白屏，**发布出去的包本身是好的**（构建期自检全过）。坏是**发布之后**产物被一道「中文机翻成英文」的后处理改写出来的：英文缩写里的撇号（`can't` / `wasn't` / `language's`）落进单引号字符串、英文双引号（`"not a mine"`）落进 JSON，把 5 块 script 打断，`core/home.js` 一挂首页就渲染不出东西。

当时的复验是 `grep` 剧情段数 + 比对 CG 文件字节，**全绿** —— 因为坏的地方不在那几个字节里。

> **字节对得上 ≠ 页面能跑。** 只有真去解析、真去开一次页面，才看得出来。

## 三步

### 1. 构建

```bash
CM_DIST=/tmp/cm-dist-$$ node scripts/build-publish-mine.mjs
```

用**私有 DIST 路径**（`/tmp/cm-dist-$$`），不要用共享的默认路径 —— 曾经因为另一个会话同时重建共享路径，把别人的包发了出去。

构建自带 5 道 fail-close 门禁，任何一道红都不出产物：

| 门 | 拦什么 |
|---|---|
| 内联完整性 | 产物里还残留外链 script / 引用了二进制 assets |
| payload 上限 | 文本 payload 超 1 MiB |
| **产物语法** | 逐块 `JSON.parse` / `new Function`，有块解析不了就拒绝出包 |
| **素材身份** | 200 件 CG 与 `color-mines/cg-manifest.json` 逐件核对 sha256（缺 / 多 / 内容变） |
| 广场资产 | 封面缺席 / 超 300KiB / 非 16:9 / 非 WebP，meta 超上限 |

构建成功后会把**下一步该跑的命令连同本次 `data-build` 戳**直接打出来，照着贴即可。

### 2. 发布

用 `publish_game` 发第 1 步产出的那个私有 DIST 目录，slug `color-mines`。

发完**对账回执**：`entries` 与 `bytes` 要和构建打印的数字对得上；`previous` 应该是你上一次的 release id。对不上就说明发的不是你构建的那个包。

### 3. 验线上（必做）

```bash
node scripts/verify-live.mjs --url https://play-color-mines.run.ceo/ \
  --root '#home' --expect-build <构建打印的戳>
```

需要一个 headless Chrome 调试端口（默认 `127.0.0.1:19301`）：

```bash
google-chrome --headless=new --remote-debugging-port=19301 --no-sandbox about:blank
```

它验三件事：

1. 线上 HTML 逐块能不能解析（不需要浏览器，最便宜也最能定位到行）
2. 真开一次页面：首页根节点必须有子节点、必须零 `pageerror`
3. `--expect-build` 核对线上戳 —— **戳对不上就说明线上服的不是你刚发的那份**

退出码：`0` 通过 / `1` 线上坏了 / `2` 没有可用 Chrome（**不当成绿**）。

## 兜底：定时巡检

`.github/workflows/live-check.yml` 每 6 小时跑一次第 3 步（也可手动触发）。它只读、不碰生产状态。

意义在于：那道机翻**不是**发布链路常驻的处理，而是「有人拿产物加工后再发」这个动作带来的 —— 这种事没有开关可关，随时可能再来一次。定时巡检把「等用户来报」变成「小时级自动变红」。

## 改配置时注意

`games/mine/game.config.json` 是**唯一真相源**。`mine.html` 里的 `<script id="gameConfig">` 是运行时真正读的副本，改完 JSON 必须同步过去：

```bash
node scripts/sync-embedded-config.mjs mine.html games/mine/game.config.json
```

不要手工去改内联那一大行（很容易改出不合法 JSON）。`i18n-parity.test.js` 里有「内嵌副本逐键一致」的门禁会拦住忘同步的情况。

## 加 CG 素材时注意

素材放 `color-mines/cg/`（该目录**不进 git**，见 `.gitignore`），命名必须是 `cgN.mp4` / `bgmN.opus`；中间件（`*-raw.mp4`、拼接源）要移出该目录，否则会被打进产物。

放完更新清单，否则构建会因为「多了未登记的素材」而拒绝出包：

```bash
node scripts/cg-manifest.mjs --write
```

剧情段数 `story.count` 要同步加，构建会逐件核对「剧情表要求几件 / 实际有几件」。

> ⚠️ **已知缺口**：素材本身不在仓里，新 clone 或换机器会缺全部 200 件。清单能让这件事**明确报错**而不是静默少发，但取回素材仍需从归档处拷。彻底解决要上 Git LFS 或对象存储 —— 那是更大的决定，见 #57 的 seams 清单 S1。
