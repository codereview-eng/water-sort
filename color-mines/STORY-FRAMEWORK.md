# 彩色扫雷 · 剧情框架 v1（第 1–300 关）

> 代号：**灯落镇 / Lumen Hollow**
> 适用范围：色彩扫雷（仓内代码 `mine.html` / `mine-engine.js` / `mine-levels.js` / `games/mine/`，发布 slug `color-mines`）。
> 本版只负责 **第 1–300 关**；301 关之后按 §8「续写协议」同模板往后长，本文件不重写。
> 状态：**已拍板 v1（2026-08-27）**，可进入 CG 素材生产与代码接线。
> 在线版（随框架迭代原地重发，URL 不变）：<https://a-color-mines-story-t5xh4sfrctw9f.run.ceo/>

---

## 0. 一页速览

| 项 | 定案 |
|---|---|
| 题材 | 「光被偷走的矿镇」重建记 —— 三消《家园/Homescapes》那一路：**明确的家园目标 + 一个话痨陪伴 NPC + 每章肉眼可见的改造进度** |
| 主角 | **你**，矿灯师的孙辈，回到断电十年的灯落镇 |
| 陪伴 NPC | **豆丁 / Pip** —— 一盏会说话的旧矿灯，教学、吐槽、给提示（复用现有 `clueBar`） |
| 反派 | **锈铁商会 / Rustiron & Co.** —— 十年前用「抽光机」抽走矿脉的光去卖，副产物就是哑火 |
| 悬念钩子 | 祖父 **奥兰 / Orin** 十年前下矿未归，他的灯至今还亮着一丝微光 |
| 章节 | 3 章 × 100 关 |
| CG | **4 段**：首启 1 段 + 第 100/200/300 关各 1 段；每段 **3–5 秒**（3 个镜头 × 约 1.5 秒） |
| 章内叙事 | 不靠 CG，靠 **Pip 台词 + 镇子画面演进 + 里程碑弹窗**，每 10–20 关一个 beat |
| 硬约束 | 所有可见文案 **zh/en 成对进 i18n 字典**，渲染层不得写死中文（仓内 `i18n-no-cjk-leak.test.js` 是机械门禁） |

---

## 1. 世界观圣经

世界的光不在天上，在地下。地脉里长着 **彩晶（Prism）**，七种颜色各司一种光：有的暖手，有的让人记起旧事，有的让庄稼抬头。矿灯师把彩晶封进灯里，光就上了地面 —— 灯落镇因此得名，也因此富过。

十年前的某个早晨，镇上的灯一盏接一盏灭了。

**哑火（Cinder）** 是彩晶熄灭后留下的影子：一颗死掉的晶石，摸到它，周围一整片光会被吞掉。矿灯师世代传下的第一条守则，恰好就是这个游戏的规则 ——

> **「一色一影，一行一影，一列一影。」**
> 每种颜色的晶区里恰好一颗哑火；每一行、每一列也各只有一颗。
> 光是有秩序的，所以熄灭也有秩序 —— 这就是矿灯师能靠推理走出矿洞的原因。

*（设计意图：这句话把现有玩法规则「每种颜色 · 每行每列，恰好一颗雷」原样翻译成世界观法则。玩家学规则 = 学设定，零额外记忆负担。）*

### 1.1 七色语义（对应盘面配色，可直接用于文案与关卡命名）

| 色 | 名 | 司掌 | 出现章节 |
|---|---|---|---|
| 红 | 心火 Emberlight | 勇气、体温 | 第 1 章起 |
| 橙 | 炉光 Forgelight | 手艺、修补 | 第 1 章起 |
| 黄 | 晨光 Dawnlight | 希望、开门营业 | 第 1 章起 |
| 绿 | 苔光 Mosslight | 生长、庄稼 | 第 1 章起 |
| 青 | 泉光 Springlight | 清醒、水源 | 第 2 章起 |
| 蓝 | 夜光 Nightlight | 记忆、睡眠 | 第 2 章起 |
| 紫 | 梦光 Dreamlight | 预感、直觉 | 第 3 章起 |
| 混色（品红/柠檬/靛…） | **杂光 Braidlight** | 两种光被压在一起的产物 | 第 3 章起，暗示矿脉在自我修复 |

> 大盘面（9×9 / 11×11）颜色数更多，正好落在「越深的矿脉颜色越杂」这一叙事上：**盘面越大 = 下得越深**，难度爬坡与剧情推进天然同向。

### 1.2 道具与资源的叙事化命名（只改文案，不改逻辑）

| 现有 id | 叙事名 | 一句话 |
|---|---|---|
| `toolMine` | **封影钉 Shadow Pin** | 祖父留下的钉子，钉住一颗哑火让它不再扩散 |
| `toolSafe` | **验光镜 Lumen Lens** | 对着一格照一照，确认那儿的光还活着 |
| `hearts`（生命） | **灯芯 Wicks** | 灯芯烧完就得回地面换新的 |
| 体力 `energy` | **灯油 Lamp Oil** | 随时间自己渗回来 |
| 周常 `weekly` | **矿灯师协会委托** | 每周从协会接一张单子 |
| 皮肤 `cosmetics` | **灯罩 Lampshades** | 镇民送的谢礼 |

---

## 2. 人物表

| 角色 | 定位 | 首次出场 | 声音/性格备忘 |
|---|---|---|---|
| **你**（无名，玩家） | 沉默主角，不说话 | L1 | 全程不给台词，避免和玩家自我投射打架 |
| **豆丁 Pip** | 陪伴 NPC / 教学 / 提示 | L1 | 旧矿灯，嘴碎、护短、怕黑但嘴硬；所有提示文案由它说 |
| **奥兰 Orin** | 祖父，失踪者 | 只在 CG 与信件里 | 从不正面出场；靠留字、旧灯、笔记推进 |
| **玛塔婆婆 Marta** | 镇上唯一没走的人，面包房主 | L40 | 负责「家园有人味」这一层，给玩家做面包 |
| **铁勺 Tinny** | 锈铁商会的低级收账员，后期倒戈 | L65 | 反派的人脸，不是怪物；负责让反派可恨又可笑 |
| **锈铁商会** | 幕后反派 | L65 线索 / L270 正面 | 不是恶魔，是生意 —— 它把光当商品 |

---

## 3. 三幕结构（1–300 关）

```
第 1 章  L1–100   《回到灯落镇》   地表 · 把镇子一盏盏点亮      情绪：孤寂 → 有人味
第 2 章  L101–200 《旧矿道》       地下 · 顺着轨道往深处走      情绪：好奇 → 不安
第 3 章  L201–300 《矿心》         真相 · 光是被谁拿走的        情绪：愤怒 → 释然 + 新钩子
```

| 章 | 主目标（玩家看得见的） | 转折点 | 章末状态 |
|---|---|---|---|
| 1 | 修好镇灯塔，让镇子重新亮灯 | L65：在邮局翻出锈铁商会十年前的收货单 —— 原来灯不是自己灭的 | 灯塔重燃，散走的镇民开始回来 |
| 2 | 找到祖父下矿的那条路 | L150：在坍塌的岔道里捡到祖父的灯，**它还亮着** | 抵达矿心大门，门上有七个空灯位 |
| 3 | 点亮矿心七色灯环 | L250：哑火不是灾害，是矿脉被抽干后**自己结的痂** | 灯环亮起，矿脉苏醒；祖父不在这里，但留下第一封信 |

### 3.1 情绪曲线设计原则

- **每章开头给一个"看得见的空位"**（黑着的灯塔 / 关着的矿心大门 / 七个空灯位），玩家一眼知道自己在往哪儿走。
- **每章中段安排一次反转**，不是加难度，是改变玩家对"雷"的理解：
  第 1 章雷 = 危险 → 第 2 章雷 = 有人为痕迹 → 第 3 章雷 = 受害者。
- **每章结尾给回报再给钩子**：先让玩家看到自己修好的东西亮起来（爽），最后一镜留问题（勾）。

---

## 4. 关卡里程碑表（每个 beat 一个可见变化）

> 规则：**beat ≠ CG**。beat 是 2–4 句 Pip 台词 + 一张镇子/矿道底图变化 + 里程碑弹窗，成本极低，用来把 100 关的空档填满。
> 底图建议每章 5–6 张演进图（assetgen `kind:image`，AVIF，≤120KB/张），复用现有 `overlay` 弹窗层。

### 第 1 章 · 回到灯落镇（L1–100）

| 关 | Beat | 可见变化 | Pip 台词（zh / en） |
|---|---|---|---|
| 1 | 教学：一色一影 | 镇口，只有你手里一盏灯 | 「十年没人擦我了。往前走，别碰黑的。」/ "Ten years, no one polished me. Walk on — don't touch the dark ones." |
| 10 | 学会封影钉 | 镇口路灯底座露出来 | 「钉住它。死掉的光会传染。」/ "Pin it down. Dead light spreads." |
| 20 | **镇口路灯亮** | 第一盏灯亮 | 「一盏。就一盏，也算数。」/ "One lamp. Just one — still counts." |
| 40 | **面包房复工** | 玛塔婆婆出场，烟囱冒烟 | 「玛塔还在？她居然还在。」/ "Marta stayed? She actually stayed." |
| 55 | 邮局清理 | 邮局门开，满地未送的信 | 「这些信一封都没送出去。」/ "Not one of these letters was ever delivered." |
| 65 | **转折：收货单** | 弹窗展示一张十年前的锈铁商会收货单 | 「'彩晶 · 整镇 · 已付讫'。……付给谁了？」/ "'Prism — whole town — paid in full.' …Paid to whom?" |
| 80 | **钟楼走字** | 钟楼指针重新转动 | 「时间也是光的一种。」/ "Time is a kind of light too." |
| 95 | 灯塔底层通电 | 灯塔亮起底部一圈 | 「上面还有一百级台阶。」/ "A hundred steps left to climb." |
| **100** | **CG 1 · 镇灯重燃** | 见 §5 | — |

### 第 2 章 · 旧矿道（L101–200）

| 关 | Beat | 可见变化 | Pip 台词 |
|---|---|---|---|
| 110 | 矿道口开封 | 木板被撬开，冷风灌出来 | 「下面的风是甜的。那不正常。」/ "The draft down there is sweet. That's not normal." |
| 125 | 轨道车修复 | 矿车能推动了 | 「抓紧我，别把我摔了。」/ "Hold me tight. Don't drop me." |
| 140 | 青光泉眼 | 新颜色（青）首次进盘面 | 「泉光。这条脉还活着一点。」/ "Springlight. This vein's still a little alive." |
| **150** | **转折：祖父的灯** | 岔道尽头一盏旧灯，微光未熄 | 「……这是奥兰的灯。它还在亮。」/ "…That's Orin's lamp. It's still lit." |
| 165 | 活的哑火 | 哑火第一次"动了一下" | 「刚才它是不是……躲了一下？」/ "Did that thing just… flinch?" |
| 180 | 矿脉图 | 墙上刻着七色脉络图 | 「七条脉，七种光。少一条都点不亮。」/ "Seven veins, seven lights. Miss one and nothing lights." |
| 195 | 铁勺撞见你 | 收账员堵路，被你绕过 | 「他怕的不是我们，是下面。」/ "He's not afraid of us. He's afraid of what's below." |
| **200** | **CG 2 · 矿心之下** | 见 §5 | — |

### 第 3 章 · 矿心（L201–300）

| 关 | Beat | 可见变化 | Pip 台词 |
|---|---|---|---|
| 210 | 矿心大厅 | 七个空灯位，全黑 | 「七个位置。我们只有一盏灯。」/ "Seven sockets. We have one lamp." |
| 225 | 紫光 / 梦光 | 紫色进盘面 | 「梦光。它会让你看见还没发生的事。」/ "Dreamlight. It shows you what hasn't happened yet." |
| 240 | 抽光机残骸 | 巨大机器锈死在矿壁上 | 「这不是矿难。这是设备。」/ "This wasn't a cave-in. This was machinery." |
| **250** | **转折：哑火是痂** | 哑火在灯光下缓缓张开，里面是空的 | 「它不是杀人的东西。它是伤口结的痂。」/ "It doesn't kill. It's a scab over a wound." |
| 270 | 锈铁商会正面 | 商会代表现身，开价收购矿心 | 「他们想再抽一次。」/ "They want to drain it again." |
| 285 | 铁勺倒戈 | 铁勺递来最后一块彩晶 | 「他把自己那份还回来了。」/ "He gave his own share back." |
| 295 | 六灯已亮 | 灯环差最后一位 | 「差一盏。差的那盏是奥兰带走的。」/ "One short. Orin took that one with him." |
| **300** | **CG 3 · 第一封信** | 见 §5，留钩子 | — |

---

## 5. CG 分镜脚本（4 段，每段 3–5 秒）

**通用规格**（对齐仓内 `color-mines` 单文件发布形态与体积预算）：

| 项 | 定案 |
|---|---|
| 时长 | 每段 3 个镜头 × 1.2–1.8 秒 = **总长 3.6–5.0 秒** |
| 画幅/帧率 | 竖屏 **1080×1920** 优先（游戏是竖屏），24fps |
| 编码 | H.264 + AAC，**540p/crf28**，单段 ≤ **250KB**，4 段合计 ≤ **1MB** |
| 托管 | 独立 `assets/*.mp4`，**不 base64 内嵌**（当前整包仅 347KB，内嵌会毁首屏） |
| 音 | 旁白省略（休闲品类不适合念白）；每段配一条 assetgen `kind:music` 4–6 秒（Opus 64k 立体声 ≤80KB）+ 2 个 sfx |
| 字幕 | 每段 **一句**，zh/en 双行，落 i18n 字典 |
| 生成 | 画面走 assetgen `kind:video`；风格锁定见 §5.0 |

### 5.0 视觉风格锁（4 段必须一致，写进每条 prompt 的前缀）

> `hand-painted storybook illustration, warm gouache texture, thick soft outlines, limited palette of glowing jewel tones against deep blue-black darkness, cozy but melancholic, no text, no watermark, vertical 9:16`

美术锚：**黑暗里的一小团暖光**。全程画面主体不超过 3 个，避免小屏看不清。

---

### CG 0 ·《回到灯落镇》（首次启动，进第 1 关前）

| 镜 | 时长 | 画面 | 音 |
|---|---|---|---|
| 1 | 1.5s | 夜色里的山谷小镇，**一盏灯都没亮**，只有月光勾出屋顶轮廓 | 风声，远处犬吠 |
| 2 | 1.5s | 一双手划亮火柴，点着一盏旧矿灯 —— 灯罩上刻着一个歪扭的「O」 | 火柴擦响，玻璃罩轻响 |
| 3 | 1.5s | 灯举起来，暖光推开黑暗，露出镇口路牌：**灯落镇** | 音乐进，一个上扬和弦 |

**（2026-08-28 修订：原版只有一句「十年前，这里的光被人带走了」——只有气氛、没有目标，玩家不知道自己是谁、要去干什么。
改为 10 秒双镜头 + 四句递进字幕，把「处境 → 代价 → 身份 → 目标」讲完整。）**

**时长与镜头**：镜 A（点灯，5s）+ 镜 B（举灯走向漆黑山谷、镜头拉远露出整片熄灭的镇子与灯塔，5s），合计约 10 秒。

**四句递进字幕**（`cues` 时间轴，见 §7.2.6）：

| 时间 | 作用 | zh | en |
|---|---|---|---|
| 0.4s | 处境 | 十年前，锈铁商会抽干了这里的矿脉。 | Ten years ago, Rustiron drained the veins beneath this town. |
| 2.6s | 代价 | 灯落镇的光被一车车运走，家家户户从此黑着。 | They carted the light away. Every window has been dark since. |
| 5.0s | 身份 | 祖父提着这盏灯下矿去追，再没上来。你是最后一个矿灯师。 | Grandfather took this lamp down after them, and never came back up. You are the last lampwright. |
| 7.2s | **目标** | 把七种光一盏一盏找回来——让灯落镇重新亮起来。 | Bring the seven lights home, one lamp at a time. Make Lumen Hollow shine again. |

> **尺度是「重建家园」，不是「拯救世界」**（拍板 2026-08-28）。休闲消除品类的代入感来自
> 「这是**我的**镇子、我认识这里的人」，而不是宏大存亡叙事；《家园》系列全程也只是修一栋房子。
> 设定里留了向上扩的口子（光是这个世界的根本、锈铁商会把光卖去了别处），
> 真要拉到「世界」尺度，留给第 6 章《锈铁的账本》之后。

assetgen prompt 草稿：
```
[风格锁] Shot 1: a small mountain town at night, every window dark, moonlit rooftops, wide vertical shot.
Shot 2: close-up of two hands striking a match and lighting an old brass miner's lamp, engraved letter O on the glass.
Shot 3: the lamp raised high, warm golden light pushing back the darkness, revealing a weathered wooden town sign.
Slow push-in, 3 shots, 1.5s each, seamless cuts.
```

---

### CG 1 ·《镇灯重燃》（通过第 100 关）

| 镜 | 时长 | 画面 | 音 |
|---|---|---|---|
| 1 | 1.5s | 你站在灯塔顶端，把最后一颗彩晶按进灯座 | 咔哒一声嵌合 |
| 2 | 1.5s | 光束扫过山谷，**一整条街的灯依次亮起来**（多米诺式） | 音乐推进，一串上行音 |
| 3 | 1.5s | 山路上远远出现几个提着行李的人影，朝镇子走来 | 脚步声，人声笑语 |

字幕：
- zh：`光回来了，人也就回来了。`
- en：`The light came back. So did the people.`

---

### CG 2 ·《矿心之下》（通过第 200 关）

| 镜 | 时长 | 画面 | 音 |
|---|---|---|---|
| 1 | 1.5s | 矿车俯冲进深不见底的竖井，灯光在岩壁上拉出条纹 | 铁轮尖啸 |
| 2 | 1.5s | 车停。前方是一扇巨大石门，门上 **七个空灯位** 全黑 | 回声，滴水 |
| 3 | 1.5s | 镜头拉近其中一个空灯位 —— 里面卡着半枚熟悉的灯罩碎片，刻着「O」 | 一记低音，戛然而止 |

字幕：
- zh：`他到过这里，然后再没上去。`
- en：`He made it this far. He never went back up.`

---

### CG 3 ·《第一封信》（通过第 300 关）

| 镜 | 时长 | 画面 | 音 |
|---|---|---|---|
| 1 | 1.5s | 七色灯环逐一点亮，整座矿心被彩光充满 | 音乐高潮 |
| 2 | 1.5s | 光柱冲出竖井，从地面看去，整个山谷被七彩照亮 | 光涌声 |
| 3 | 1.5s | 灯环中央的石台上，压着一封没拆的信，落款一个「O」；镜头停住 | 音乐收，只剩纸张翻动 |

字幕：
- zh：`第一封信。他还在往更深的地方走。`
- en：`The first letter. He's still heading deeper.`

> **钩子设计**：第 300 关不给结局，给一封信。信 = 第 4 章的入口，也是「以后不停往后写」的天然容器 —— 每 100 关拆开一封新的信。

---

## 6. 与玩法的绑定（叙事不许拖玩法后腿）

| 原则 | 具体做法 |
|---|---|
| **不改任何数值** | 剧情层只消费 `level` 数字，绝不改难度曲线、时限、雷数 |
| **不阻塞玩家** | CG 与 beat 弹窗均可 1 秒内跳过；跳过状态持久化，不再二次弹 |
| **首启不劝退** | CG 0 在**第 1 关之前**播，但**必须先能跳过**；4 秒内未就绪自动跳过（见 §7 兜底） |
| **难度即深度** | 盘面尺寸爬坡（5×5→7×7→9×9→11×11）叙事化为「越挖越深」，颜色变多 = 矿脉变杂 |
| **提示条即角色** | 现有 `clueBar` 的提示文案统一换成 Pip 的口吻，零新增 UI |
| **失败也有戏** | 灯芯耗尽 = 回地面换灯芯，Pip 说一句安慰台词（3 条轮播），不写"你输了" |

---

## 7. 技术契约（拍板后按此接线，实现前不得自造名字）

### 7.1 剧情数据结构（新增文件 `mine-story.js`，UMD，与 `mine-levels.js` 同风格）

```js
// 每段 CG 一条；v/a 走 CG_MEDIA 映射，字幕走 i18n key，不写死文案
window.MineStory = {
  CG: [
    { id:'cg0', at:0,   v:'cg/cg0.mp4', m:'cg/bgm0.opus', k:'story.cg0.sub' },
    { id:'cg1', at:100, v:'cg/cg1.mp4', m:'cg/bgm1.opus', k:'story.cg1.sub' },
    { id:'cg2', at:200, v:'cg/cg2.mp4', m:'cg/bgm2.opus', k:'story.cg2.sub' },
    { id:'cg3', at:300, v:'cg/cg3.mp4', m:'cg/bgm3.opus', k:'story.cg3.sub' }
  ],
  BEATS: [
    { at:20,  img:'story/ch1-lamp.avif',  k:'story.b20'  },
    // …§4 表逐条落地
  ]
};
```

- **触发判据（唯一权威）**：`at === 0` → **玩家点「开始第 1 关」那一下**（`save.level === 1` 时）；
  `at > 0` → **通关第 `at` 关的结算之后**。
  > 修订（用户拍板 2026-08-28）：首启 CG **不再挂在首页装配之后**。挂那里等于玩家还什么都没点
  > 就被一段全屏动画盖住，而且它会**抢走首次点击**（那一下被拿去解除静音），观感变成
  > 「点开始就进全屏」。现在唯一入口是 `maybeStory(at, done)`，触发点写在 `startGame()` 里。
- **总开关**：设置里的「剧情动画」= `save.cg`（默认 `true`）。关掉 ⇒ 整条不播。
  这一层判断只在 `maybeStory()` 里做一次，其余判据全在 `mine-story.js`，不加第二份。
- **已看记录**：`localStorage['cm.story.seen']` 存 id 数组 JSON；读失败按「全没看过」处理，但**同一次会话内不重播**。
- **重看入口**：首页新增「回忆 / Recall」按钮，列出已解锁的 CG 与 beat，可重播。

### 7.2 CG 播放机标准件（**唯一指定实现，禁止另造**）

来源：作品广场《黎明崛起》线上产物 `play-rising-dawn.run.ceo` 的逐行拆解（2026-08-27 拉取），
已在真实用户量下跑过多个版本。**此后本仓所有 CG 需求一律复用这套流程，不得自己再发明一种播 CG 的方式。**

它的价值不在「能播视频」，在于**每一条异步分支都有出口** —— 弱网、缺资源、自动播放被浏览器拦、
旁白比视频长，四种情况玩家都感觉不到异常。

#### 7.2.1 四条不变量（违反任一条即视为没接对，不许合入）

1. 任何异步分支**最终必须走向 `cgAdvance` 或 `cgEnd`**；不存在「什么都不做」的分支。
2. `cgEnd` **幂等**；`cgState.done` 是全局熔断，所有回调开头先查它。
3. **进度条读满再进 CG**，绝不边播边解码（最常见的卡顿源）。
4. 资源用**逻辑键**（`'cg/cg1.mp4'`）标识，真实路径只存在于 `CG_MEDIA` 映射表里 —— 换托管方式零改代码。

#### 7.2.2 主流程

```
① 触发判定   at===0 首启 / at>0 通关结算后；查 seen 记录，同会话不重播
        ↓
② 媒体解析   cgFetchMedia：CG_MEDIA 在内存则直接过；否则拉媒体包，失败静默降级
        ↓
③ 预热       cgPreload → toBlob → setBar
             资源清单从 CG_SEGS 机械派生（封面 + 每段 v/a）
             逐个转 Blob URL，每 16ms 一步不阻塞主线程，进度条推到 100%
        ↓
④ 起播       cgStart：设 poster 首帧遮丑
             playing 事件 或 4 秒保险（取先到者）→ 收 loading 层 + 起 BGM
        ↓
⑤ 看门狗     8 秒仍 readyState<2  ⇒  cgEnd()，玩家无感进游戏   ← 弱网下最重要的一条
        ↓
⑥ 逐段播放   seg(i)：换字幕 → 置 pend={vid:false,vo:false}
             → 视频先 hidden，等 playing 再显示（消段间黑闪）
             → 播视频 + playVo(i)
        ↓
⑦ 双完成门   cgAdvance：视频 ended 与 旁白 ended 都到齐才切下一段
             （缺了它，长旁白会被短视频硬切掉半句）
        ↓
⑧ 收口       cgEnd：置 done → 停 BGM → 停旁白 → 隐藏遮罩 → 进游戏（幂等）
```

**横切分支**（与主流程并行，随时可触发）：

| 分支 | 行为 |
|---|---|
| 跳过按钮 | 全程可见，点击立刻 `cgEnd()` |
| 自动播放被拦 | 静音起播；首次 `pointerdown`/`keydown` 触发 `cgUnmute` 恢复声音并**补播当前段旁白**，随后自摘监听 |
| 旁白缺失或报错 | 立即 `cgAdvance('vo')` —— 不等、不卡、不报错 |
| 资源键缺失 | 该段静默跳过，不弹任何错误 |
| 截图/自检 lane | URL hash 含 `shot` 或 `selftest` 时整段跳过 CG |

#### 7.2.3 关键函数职责

| 函数 | 职责 |
|---|---|
| `cgRes(k)` | 逻辑键 → 可播 URL：Blob 优先 → `CG_MEDIA` → 原键兜底 |
| `toBlob(u)` | data URI 解成 Blob URL；解析失败原样返回，绝不抛 |
| `ASSETS` | 从 `CG_SEGS` **机械派生**资源清单，不手工维护（手工维护必漏） |
| `cgPreload(done)` | 逐个转 Blob + 推进度条，16ms 一步 |
| `cgStart()` | 显示遮罩 → 预热 → 设 poster → 装 4s 保险与 8s 看门狗 → `seg(0)` |
| `seg(i)` | 换字幕、重置双完成门、防黑闪、起视频与旁白 |
| `playVo(i)` | 静音 / 无旁白 / 出错 一律立即 advance —— 永不卡死 |
| `cgAdvance(k)` | 双完成门；两边齐了才 `seg(i+1)` |
| `cgEnd()` | 幂等收口 |
| `cgUnmute()` | 恢复 AudioContext + 取消静音 + 补播当前段旁白 |
| `cgFetchMedia(cb)` | 媒体包懒加载；失败静默 `false` |

#### 7.2.4 参考实现（原样取自线上产物，可直接移植）

```js
// —— 逻辑键解析：Blob > 映射表 > 原键 ——
function cgRes(k){
  if(window.CG_BLOB[k]) return window.CG_BLOB[k];
  if(window.CG_MEDIA && window.CG_MEDIA[k]) return window.CG_MEDIA[k];
  return k;
}
function toBlob(u){
  try{
    var m = u.match(/^data:([^;]+);base64,(.*)$/); if(!m) return u;
    var bin = atob(m[2]), n = bin.length, buf = new Uint8Array(n), i;
    for(i=0;i<n;i++){ buf[i] = bin.charCodeAt(i); }
    return URL.createObjectURL(new Blob([buf], {type:m[1]}));
  }catch(e){ return u; }
}

// —— 资源清单机械派生，不手工维护 ——
var ASSETS = (function(){
  var a = ['cg/cover1.jpg'], i;
  for(i=0;i<CG_SEGS.length;i++){
    a.push(CG_SEGS[i].v);
    if(CG_SEGS[i].a){ a.push(CG_SEGS[i].a); }
  }
  return a;
})();

// —— 预热：读满再进，不阻塞主线程 ——
window.cgPreload = function(done){
  var i = 0, total = ASSETS.length; setBar(0,total);
  (function step(){
    if(cgState.done) return;                       // 全局熔断
    if(i >= total){ cgState.loaded = true; setBar(total,total); done(); return; }
    var k = ASSETS[i];
    if(window.CG_MEDIA && window.CG_MEDIA[k]){ window.CG_BLOB[k] = toBlob(window.CG_MEDIA[k]); }
    i++; setBar(i,total); setTimeout(step,16);
  })();
};

// —— 起播 + 4 秒保险 + 8 秒看门狗 ——
function cgStart(){
  cgState.loading = true;
  ov.style.display = 'flex'; $g('cgLoad').style.display = 'flex';
  window.cgPreload(function(){
    vid.poster = cgRes('cg/cover1.jpg');
    var started = false, go = function(){
      if(started || cgState.done) return;
      started = true;
      $g('cgLoad').style.display = 'none';
      window.cgBgmStart();
    };
    vid.addEventListener('playing', go, {once:true});
    setTimeout(go, 4000);                          // playing 没来也要收 loading
    setTimeout(function(){                         // 看门狗：弱网直接放行
      if(!cgState.done && cgState.idx === 0 && vid.readyState < 2){ cgEnd(); }
    }, 8000);
    seg(0);
  });
}

// —— 双完成门 + 旁白永不卡死 ——
window.cgAdvance = function(k){
  if(cgState.done || !cgState.pend) return;
  cgState.pend[k] = true;
  if(cgState.pend.vid && cgState.pend.vo){         // 两边齐了才推进
    cgState.pend = null; seg(cgState.idx + 1);
  }
};
function playVo(i){
  stopVo(); if(!cgState.pend) return;
  var s = CG_SEGS[i];
  if(cgState.muted || !s.a){ window.cgAdvance('vo'); return; }  // 没旁白直接放行
  try{
    var a = new Audio(cgRes(s.a)); a.volume = 0.9; cgState.vo = a;
    a.onended = function(){ window.cgAdvance('vo'); };
    a.onerror = function(){ window.cgAdvance('vo'); };          // 出错也放行
    a.play().catch(function(){ window.cgAdvance('vo'); });      // 被拦也放行
  }catch(e){ window.cgAdvance('vo'); }
}

// —— 静音起播 → 首次交互恢复声音（自摘监听）——
function cgUnlock(){
  if(window.cgUnmute()){
    document.removeEventListener('pointerdown', cgUnlock);
    document.removeEventListener('keydown', cgUnlock);
  }
}
document.addEventListener('pointerdown', cgUnlock);
document.addEventListener('keydown', cgUnlock);
```

#### 7.2.5 移植到彩色扫雷要改的四处

| 改动 | 说明 |
|---|---|
| 单段而非多段 | 每次 `CG_SEGS` 只放一条；**双完成门保留**（无旁白时 vo 立即 advance），别图省事删掉 |
| 触发从「首启」扩为 `at` 判据 | `at===0` 首启；`at>0` 通关该关结算后 |
| 加 seen 记录 + 回忆入口 | `localStorage['cm.story.seen']` 存 id 数组；首页加「回忆 / Recall」可重播 |
| 兜底必须带埋点 | 每次静默跳过记一条原因：`timeout｜blocked｜missing｜error` |

> **为什么埋点是硬要求**：这套播放机的设计意图就是「出错时不要声张」。没有埋点，一旦资源路径写错，
> 表现是**所有玩家 100% 看不到 CG，而线上一条错误都不报** —— 这种故障能活很久。
> 降级分支必须能回答「最近多少次降级、为什么降级」。

> **不照抄的一处**：黎明崛起的 BGM 是 WebAudio 振荡器程序化合成，那是资产管线的**兜底档**而非推荐档；
> 彩色扫雷改用 `assetgen kind:music` 生成真实音乐（Opus 64k 立体声）。

### 7.3 i18n（机械门禁，会红）

- 所有故事文案走字典，key 命名：`story.<scene>.<slot>`，例 `story.cg1.sub`、`story.b65.pip`。
- **zh / en 必须成对**，缺一即 `i18n-parity.test.js` 红。
- 渲染层禁止出现中文字面量（`i18n-no-cjk-leak.test.js` 拦）。
- 英文不是机翻中文：Pip 的英文台词按英文口语重写，短、带停顿。

### 7.4 资源预算表（合计上限）

| 类别 | 数量 | 单件上限 | 合计 |
|---|---|---|---|
| CG 视频 | 4 | 250KB | ≤1.0MB |
| CG 音乐 | 4 | 80KB | ≤0.32MB |
| beat 底图 | ~18 | 120KB | ≤2.2MB（按章懒加载，首屏只拉第 1 章） |
| sfx | ~8 | 12KB | ≤0.1MB |

首屏（HTML + 第 1 章资源）目标 **≤1.2MB**；CG 与后续章节资源一律**按需拉取**。

---

## 8. 续写协议（301 关之后照抄本节，不重写框架）

每新增 100 关 = 新增 **1 章 + 1 段 CG + 6–8 个 beat**，且必须满足：

1. **拆一封信**：本章开头由祖父的一封信开启，信里给出本章的「看得见的空位」。
2. **改变玩家对某个机制的理解**：本章中段必须有一次认知反转（第 1–3 章分别是 危险→人为→受害者，后续可延伸：哑火会说话 / 哑火是矿脉的记忆 / 祖父自己变成了一颗哑火…）。
3. **章末给回报 + 留新钩子**：不给结局，给下一封信。
4. **新颜色 or 新地貌** 至少一样，配合盘面尺寸变化。
5. **CG 仍是 3 镜 × 1.5 秒**，风格锁不变（§5.0），字幕仍是一句。

---

# 第二部 · L301–1000（2026-08-29 扩写，共 7 章 / 7 段 CG）

**整部弧线**：家园 → 追查 → 走出去 → 道德反转 → 归来。
第一部（L1–300）把「我的镇子」立住；第二部才允许把尺度放大到镇子以外——
但**落点始终是回家点灯**，不是拯救世界。第 9 章那次反转是全作的重心：
玩家会发现自己正在变成锈铁商会。

| 章 | 关卡 | 标题 | 一句话 | 认知反转 |
|---|---|---|---|---|
| 4 | 301–400 | 《更深的一封信》 | 七条脉之外还有第八条 | 光不止七种，七色只是被分过色的光 |
| 5 | 401–500 | 《会说话的哑火》 | 哑火里封着被夺走那一刻 | 哑火不是废渣，是录音 |
| 6 | 501–600 | 《锈铁的账本》 | 光被装箱运去了别处 | 受害的不止灯落镇，是几十个镇子 |
| 7 | 601–700 | 《运光的列车》 | 扒上货车，第一次走出山谷 | 押运工也是被抽干的镇子出来的人 |
| 8 | 701–800 | 《点灯人的城》 | 炽都整夜不熄灯 | 祖父来过，而且亲手装过这些灯 |
| 9 | 801–900 | 《熄灯令》 | 要还光，这座城得先黑 | **你正在变成锈铁商会** |
| 10 | 901–1000 | 《归灯》 | 第八盏灯亮起 | 第八盏的燃料是奥兰自己 |

## 第 4 章 · 更深的一封信（L301–400）

**目标**：撬开被铁栅封死的第八条矿道。　**章末**：栅门打开，银白光道通向更深处。
**新颜色**：银白「**原光 Rawlight**」——未被分色的光，七色都是从它里分出来的。

| 关 | Beat | Pip 台词 |
|---|---|---|
| 310 | 拆开第一封信 | 「他知道你会来。信上只画了一堵墙。」/ "He knew you'd come. The letter is just a drawing of a wall." |
| 320 | 撬开石壁 | 「墙是后砌的。有人不想让人下去。」/ "This wall was built later. Someone didn't want anyone going down." |
| 335 | 冰封的矿道 | 「这么冷……光被抽干的地方会结冰。」/ "So cold. Ground goes to ice where the light's been drained." |
| 350 | **转折：原光** | 「这不是第八种颜色。这是**还没分色的光**。」/ "That's not an eighth colour. That's light before it was ever split." |
| 365 | 银白哑火 | 「连它的影子都是白的。我不喜欢。」/ "Even its shadow is white. I don't like it." |
| 380 | 通道贯通 | 「风又通了。下面有东西在呼吸。」/ "Air's moving again. Something down there is breathing." |
| 395 | 栅门前 | 「锁是从**里面**扣上的。」/ "This gate was barred from the inside." |

## 第 5 章 · 会说话的哑火（L401–500）

**目标**：学会读哑火里的记忆，问出祖父走的方向。　**章末**：一段完整记忆拼出——他跟着一列车走了。
**新地貌**：记忆回廊（光尘在空中拼出影像）。

| 关 | Beat | Pip 台词 |
|---|---|---|
| 410 | 第一次听见人声 | 「你听见了吗。石头在说话。」/ "Did you hear that. The stone is talking." |
| 425 | 记忆碎片 | 「一颗哑火 = 一个瞬间。碎的，得拼。」/ "One cinder, one moment. Broken. You have to piece it." |
| 440 | 玛塔的那颗 | 「这颗别听了……里面是她丈夫。」/ "Don't play this one. Her husband is inside it." |
| 450 | **转折：奥兰的声音** | 「是他。他在喊一个车次。」/ "That's him. He's shouting after a train." |
| 465 | 铁勺的忏悔 | 「他当年也在场。他一直没敢说。」/ "He was there that day. He never dared say so." |
| 480 | 记忆拼图 | 「碎片凑够了，画面就连起来了。」/ "Enough shards and the picture joins up." |
| 495 | 方向确定 | 「他没有被埋在这儿。他是**跟着走**的。」/ "He wasn't buried here. He followed them out." |

## 第 6 章 · 锈铁的账本（L501–600）

**目标**：找到商会账本，弄清光运去了哪。　**章末**：找到装货站与通往地表的巨型轨道。
**新地貌**：地下货运站、板条箱堆场。

| 关 | Beat | Pip 台词 |
|---|---|---|
| 510 | 地下办公室 | 「桌上的茶还在杯里。他们走得很急。」/ "Tea's still in the cup. They left in a hurry." |
| 525 | 空板条箱 | 「一箱装二十颗。这里堆过几千箱。」/ "Twenty to a crate. Thousands of crates stood here." |
| 540 | 编号与封条 | 「每一颗都编了号。他们把光当货。」/ "Every stone numbered. They treated light as freight." |
| 550 | **转折：几十个镇子** | 「翻页。全是镇名。**每一个都黑了。**」/ "Keep turning. All town names. Every one of them went dark." |
| 565 | 铁勺交出钥匙 | 「他攥了十年。手一直在抖。」/ "He's held this ten years. His hand won't stop shaking." |
| 580 | 装货站 | 「这么大的站，光靠矿车推不动。」/ "A yard this big. Carts never moved this." |
| 595 | 轨道尽头 | 「轨道朝上。通到地面去了。」/ "The rails climb. They run all the way to the surface." |

## 第 7 章 · 运光的列车（L601–700）

**目标**：扒上运光列车，跟到地表。　**章末**：列车出山口，地平线上一座通明的城。
**新地貌**：地表铁路、山口、隧道。

| 关 | Beat | Pip 台词 |
|---|---|---|
| 610 | 扒车 | 「跳。别看下面。」/ "Jump. Don't look down." |
| 625 | 车厢里的光 | 「一整节车厢的光。够点亮半个镇子。」/ "A whole car of it. Enough to light half a town." |
| 640 | 押运工 | 「他们领工钱，也不敢抬头。」/ "They take the wage and keep their eyes down." |
| 650 | **转折：他们也是** | 「他口音跟玛塔一样。**他也是被抽干的镇子出来的。**」/ "He talks like Marta. His town was drained too." |
| 665 | 过隧道 | 「屏住。这段没有风。」/ "Hold your breath. No air moves here." |
| 680 | 出山 | 「十年了……我第一次看见天。」/ "Ten years. First sky I've seen." |
| 695 | 望见炽都 | 「那不是日出。那是**灯**。」/ "That's not sunrise. Those are lamps." |

## 第 8 章 · 点灯人的城（L701–800）

**目标**：进入炽都，查祖父下落。　**章末**：找到他的住处，人去屋空，桌上的灯还亮着。
**新颜色**：**杂光 Braidlight** 大量出现——城市把七色混着烧，光谱糊成一片。

| 关 | Beat | Pip 台词 |
|---|---|---|
| 710 | 穹顶下的白昼 | 「这里没有夜。他们把夜买走了。」/ "There's no night here. They bought it out." |
| 725 | 不熄的街灯 | 「一盏都不关。哪怕没人走。」/ "Not one switched off. Even with no one on the street." |
| 740 | 灯匠铺 | 「手艺是我们的手艺。谁教的？」/ "That's our craft. Who taught them?" |
| 750 | **转折：熟悉的记号** | 「灯座上刻着灯落镇的印。**是他装的。**」/ "Our town's mark, cut into the base. He fitted these." |
| 765 | 邻居的证词 | 「他们说他天天来修灯，从不说自己从哪来。」/ "They say he came daily to mend lamps, never said where from." |
| 780 | 祖父的房间 | 「床铺得整整齐齐。他打算回来的。」/ "Bed made square. He meant to come back." |
| 795 | 桌上那盏灯 | 「点着。十年没灭过。」/ "Still lit. Ten years and never out." |

## 第 9 章 · 熄灯令（L801–900）

**目标**：把光还回去。　**转折**：办法只有让炽都先黑——而那一刻你和锈铁没有区别。
**章末**：找到第三条路——不是熄灯，是教炽都自己养脉。
**新机制感**：光可以**再生**。

| 关 | Beat | Pip 台词 |
|---|---|---|
| 810 | 中央控制塔 | 「一根闸。整座城的灯都在它手里。」/ "One lever. Every lamp in the city hangs off it." |
| 825 | 市民的日常 | 「那家人在灯下吃饭。他们什么都不知道。」/ "That family's eating under the light. They know nothing." |
| 840 | 拉闸的代价 | 「拉下去，这里就变成十年前的灯落镇。」/ "Pull it, and this becomes Lumen Hollow, ten years ago." |
| 850 | **转折：我成了抽光的人** | 「等等……我们现在在干**他们**当年干的事。」/ "Wait. We're about to do exactly what they did." |
| 865 | 祖父的笔记 | 「他也停在这一步。整整十年没敢往下写。」/ "He stopped here too. Ten years and he never wrote the next line." |
| 880 | 养脉法 | 「光不是矿。**光是会长的。**」/ "Light isn't ore. Light grows back." |
| 895 | 第一盏自养的灯 | 「亮了。这一盏，谁都没被夺走。」/ "It's lit. And nobody lost anything for it." |

## 第 10 章 · 归灯（L901–1000）

**目标**：把八种光带回灯落镇，点亮第八盏。　**章末**：山谷全亮；地平线外仍有黑着的地方 + 最后一封信。

| 关 | Beat | Pip 台词 |
|---|---|---|
| 910 | 返程 | 「回家的路比来时短。一直都是这样。」/ "The way home is always shorter. It always is." |
| 925 | 沿途黑镇亮起 | 「一个镇，又一个镇。名单在变短。」/ "One town, then another. The list keeps getting shorter." |
| 940 | 回到灯落镇 | 「玛塔在门口。她烤了东西。」/ "Marta's at the door. She's been baking." |
| 950 | **转折：第八盏的燃料** | 「第八盏不需要晶石……**奥兰把自己留在脉里了。**」/ "The eighth needs no crystal. Orin left himself in the vein." |
| 965 | 镇民齐聚 | 「都回来了。一个不少。」/ "All of them came back. Not one missing." |
| 980 | 灯环合拢 | 「八盏。整整八盏。」/ "Eight. All eight of them." |
| 995 | 最后一封信 | 「还有一封……这次不是写给你的。」/ "One more letter. This one isn't addressed to you." |

## 章节 CG 分镜（CG 4–10）

规格同 §5：单镜 5 秒、单句字幕、竖屏 406×720、H.264 ≤250KB。

| CG | 关 | 画面 | 字幕 zh / en |
|---|---|---|---|
| cg4 | 400 | 七色灯环外，石壁被撬开，铁栅后的隧道深处透出**银白**微光 | 七条脉之外，还有第八条。他把路留给了你。<br>*Beyond the seven veins lies an eighth. He left the way open for you.* |
| cg5 | 500 | 灯照到哑火，表面裂开，光尘升起在空中拼成一个矿工的虚影 | 哑火不是死的。它记着被夺走的一切。<br>*A cinder isn't dead. It remembers everything that was taken.* |
| cg6 | 600 | 地下货运站，成排装满彩晶的板条箱被推上矿车，轨道向上通往地表 | 光没有消失——它被装箱、编号，运去了别处。<br>*The light never vanished. It was crated, tallied, and shipped away.* |
| cg7 | 700 | 夜色中满载发光板条箱的货车驶出山口，光从缝里漏出照亮铁轨，远处一片通明的城 | 顺着这条铁轨，你第一次走出了灯落镇。<br>*You follow the rails, and leave Lumen Hollow for the first time.* |
| cg8 | 800 | 玻璃穹顶下万灯齐明的城市，镜头下移到一盏街灯底座上的灯形刻记 | 这里的人整夜不熄灯。他们不知道光是从谁家偷来的。<br>*This city never turns its lights off. No one here knows whose light it is.* |
| cg9 | 900 | 中央控制塔里一只手握住巨大拉闸；窗外整座城市，灯一片片熄下去 | 要把光还回去，这座城得先黑下来。<br>*To give the light back, this city must go dark first.* |
| cg10 | 1000 | 灯落镇，第八盏银白灯亮起补齐灯环，整座山谷被彩光点亮；镜头升起，地平线外仍是一片黑 | 灯落镇亮了。可地平线那头，还有一片黑着的地方。<br>*Lumen Hollow shines. But out past the horizon, somewhere is still dark.* |

## 1000 关之后

第 10 章**不给终局，给一封不是写给你的信**——收信人是另一座黑着的镇子。
续写协议（下节）原样适用：每 100 关一章一 CG，拆一封信开头、中段一次认知反转、章末回报 + 新钩子。

---

## 续写协议 · 章节储备（L1001+，只留标题）

| 章 | 关卡 | 暂定标题 | 一句话 |
|---|---|---|---|
| 11 | 1001–1100 | 《不是写给你的信》 | 收信人是海那边另一座黑镇 |
| 12 | 1101–1200 | 《养脉人》 | 把「光会长」这件事教出去 |
| 13 | 1201–1300 | 《第一个学会的人》 | 徒弟比师父走得更远 |

---

## 9. 待拍板事项

| # | 问题 | 建议默认 |
|---|---|---|
| 1 | CG 时长 3–5 秒是否指**每段 CG 总长**？本稿按「总长 3–5 秒 = 3 镜 × 1.5s」设计 | 保持 3–5 秒。若要更完整叙事，可放宽到 8–10 秒（3 镜 × 3s），体积翻倍到 ≤2MB |
| 2 | 首启 CG 是否强制播一次（可跳过） | 强制播但可跳过；跳过后首页「回忆」入口可重看 |
| 3 | 是否要旁白配音 | 不要。休闲品类念白违和，且中英双语配音成本翻倍；靠字幕 + 音乐 |
| 4 | 镇名与人名是否沿用本稿 | 沿用「灯落镇 / 豆丁 / 奥兰 / 锈铁商会」 |

---

## 10. 变更记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-08-27 | v1 | 首版：世界观 + 三章 300 关 + 4 段 CG 分镜 + 技术契约 + 续写协议 |
