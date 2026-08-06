#!/usr/bin/env node
/* S18 反例硬闸：新游戏接入的 diff 只允许落 games/<id>/（配置与资源）。
   机制（可测纯函数）+ CLI 包装：
     node scripts/diff-gate.mjs --game <id> [--base <ref>] [--head <ref>]
   规则：接入一款新游戏时，改动文件必须全部位于 games/<id>/ 下；
   触碰 core/、shell 页或其它游戏目录即违规退出（rc=1），并列出违规文件。 */
import { execFileSync } from 'node:child_process';

// 纯函数：给定改动路径列表与游戏 id，返回违规文件列表（空 = 通过）
export function violations(paths, gameId) {
  if (!Array.isArray(paths)) throw new Error('diff-gate: paths 必须是数组');
  if (typeof gameId !== 'string' || !/^[a-z0-9-]+$/.test(gameId)) throw new Error('diff-gate: 非法游戏 id "' + gameId + '"');
  const allow = 'games/' + gameId + '/';
  return paths.filter((p) => !String(p).startsWith(allow));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name, dft) => {
    const i = args.indexOf('--' + name);
    return i === -1 ? dft : args[i + 1];
  };
  const game = opt('game', null);
  if (!game) {
    console.error('用法：node scripts/diff-gate.mjs --game <id> [--base <ref>] [--head <ref>]');
    process.exit(2);
  }
  const base = opt('base', 'main');
  const head = opt('head', 'HEAD');
  const out = execFileSync('git', ['diff', '--name-only', base + '...' + head], { encoding: 'utf8' });
  const paths = out.split('\n').filter(Boolean);
  const bad = violations(paths, game);
  if (bad.length) {
    console.error('❌ diff 闸违规：接入游戏 "' + game + '" 只允许改 games/' + game + '/，以下文件越界：');
    for (const p of bad) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('✅ diff 闸通过：' + paths.length + ' 个文件全部落在 games/' + game + '/ 内');
}
