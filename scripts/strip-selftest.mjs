/* 发布产物剔除开发自检面板（#selftest / 充值 10000 金币按钮）。
   2026-08-31 定案：线上不能带这条充值通道。

   为什么必须「物理剔除」而不是「加个开关隐藏」：
     mine.html 的主脚本是顶层 classic <script>，顶层 `function grantCoins()` 会挂到 window。
     哪怕面板永远不显示，线上任何人打开控制台敲 grantCoins() 一样能给自己账号加币
     （coinsEarned 在云端是 merge:"max"，只增语义，加上去还降不回来）。
     所以唯一有效的做法是：发布产物里根本没有这段代码。

   实现：mine.html 里三处（CSS / DOM / JS）用 `selftest:begin` … `selftest:end` 成对标记，
   这里按行整段删除，与注释语法无关（CSS 注释、HTML 注释、JS 注释三种都能吃）。

   fail-close：源码里标记数量对不上（漏删一半、复制粘贴弄丢一个 end）直接抛错，
   宁可构建失败也不出一份「以为剔干净了其实没有」的产物。 */

/** mine.html 里成对标记的块数（CSS 样式 / DOM 面板 / JS 逻辑各一块）。 */
export const SELFTEST_BLOCKS = 3;

/* 剔除后不允许再出现的记号。
   注意不要写成裸 /selftest/：core/story.js 里 `/shot|selftest/` 是「截图 lane 跳过剧情 CG」的判断，
   与充值面板无关，内联后仍会留在产物里，一刀切会误伤。 */
export const SELFTEST_RESIDUE =
  /grantCoins|GRANT_AMOUNT|syncSelfTestEntry|stGrant|stOut|id="selftest"|class="selftest"|\.selftest\b/;

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
