/* 发布产物剔除自检面板里的【充值】部分（#selftest 面板本身保留上线）。
   2026-08-31 定案（两次拍板，别把它们混成一条）：
     ① 线上不能带充值通道 → grantCoins / GRANT_AMOUNT / stGrant 按钮与绑定，构建时剔除；
     ② 线上要保留 CG 自检 → 面板容器 + 「临时解锁全部 CG / 还原 / 打开图鉴」随产物上线，
        因为检查剧情 CG 必须在真机真环境做（本地没有 CG 素材，素材不进 git）。
   代价是知情玩家能提前看全部剧情——owner 明确接受，不要"顺手"把它也剔了。

   为什么必须「物理剔除」而不是「加个开关隐藏」：
     mine.html 的主脚本是顶层 classic <script>，顶层 `function grantCoins()` 会挂到 window。
     哪怕面板永远不显示，线上任何人打开控制台敲 grantCoins() 一样能给自己账号加币
     （coinsEarned 在云端是 merge:"max"，只增语义，加上去还降不回来）。
     所以唯一有效的做法是：发布产物里根本没有这段代码。

   实现：mine.html 里三处（CSS / DOM / JS）用 `selftest:begin` … `selftest:end` 成对标记，
   这里按行整段删除，与注释语法无关（CSS 注释、HTML 注释、JS 注释三种都能吃）。

   fail-close：源码里标记数量对不上（漏删一半、复制粘贴弄丢一个 end）直接抛错，
   宁可构建失败也不出一份「以为剔干净了其实没有」的产物。 */

/** mine.html 里成对标记的块数：grantCoins 整段 + 充值按钮那一行 + 它的事件绑定那一行。 */
export const SELFTEST_BLOCKS = 3;

/* 剔除后不允许再出现的记号 = 只有充值那三件套。
   **不要**把 stOut / stCg / id="selftest" 加回来：面板与 CG 自检是**故意保留上线**的。
   也不要写成裸 /selftest/：core/story.js 的 `/shot|selftest/` 是「截图 lane 跳过剧情 CG」，
   与充值无关，内联后仍在产物里，一刀切会误伤。 */
export const SELFTEST_RESIDUE = /grantCoins|GRANT_AMOUNT|stGrant/;

/**
 * 删除 html 中所有 `selftest:begin` … `selftest:end` 标记块（含标记所在行）。
 * @param {string} html 源文件文本
 * @returns {{ html: string, removed: number }} 剔除后的文本与删掉的块数
 */
export function stripSelfTest(html) {
  const begins = (html.match(/selftest:begin/g) || []).length;
  const ends = (html.match(/selftest:end/g) || []).length;
  if (begins !== ends) {
    throw new Error(`selftest 标记不成对：begin ${begins} 个 / end ${ends} 个`);
  }
  const out = html.replace(/^[^\n]*selftest:begin[\s\S]*?selftest:end[^\n]*\n?/gm, '');
  return { html: out, removed: begins };
}

/**
 * 对已剔除的产物做 fail-close 断言：还能搜到充值面板的任何记号就抛错。
 * @param {string} html 产物文本
 * @param {string} where 出错信息里标明的产物名
 */
export function assertNoSelfTest(html, where = '产物') {
  const hit = html.match(SELFTEST_RESIDUE);
  if (hit) {
    throw new Error(`${where}里仍残留自检面板记号「${hit[0]}」——剔除失败，禁止发布`);
  }
}
