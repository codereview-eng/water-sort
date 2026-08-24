#!/usr/bin/env bash
# 本仓 CI 入口（本地与 GitHub Actions 跑同一份，避免「本地绿、CI 红」）。
# 纪律（2026-08-21 定案）：每次改动后跑 ./scripts/ci.sh，全绿才算改完。
#
#   门禁 1  单元/契约测试：根目录与 core/ 下所有 *.test.js（node --test）
#   门禁 2  多语言静态 gate：i18n-parity.test.js（含在门禁 1 内，这里再单独报一次结论）
#   门禁 3  多语言运行时 gate：scripts/i18n-cjk-scan.mjs
#           把游戏切英文逐屏扫残留中文。需要一个开着 --remote-debugging-port 的 Chrome。
#           没有可用端口时它退 2 = SKIP：默认放行但会大声打印（CI 环境无浏览器）；
#           传 --require-runtime 则把 SKIP 也算失败（本机改 i18n 后应该用它）。
set -uo pipefail
cd "$(dirname "$0")/.."

REQUIRE_RUNTIME=0
for a in "$@"; do [ "$a" = "--require-runtime" ] && REQUIRE_RUNTIME=1; done

fail=0
line() { printf '\n=== %s ===\n' "$1"; }

line "门禁 1/3 · 单元与契约测试（node --test）"
if node --test ./*.test.js ./core/*.test.js; then
  echo "OK 全部测试通过"
else
  echo "FAIL 有测试未通过"; fail=1
fi

line "门禁 2/3 · 多语言静态 gate（字典对等 / en 无中文 / 占位符一致 / 内嵌副本同步）"
if node --test i18n-parity.test.js i18n-no-cjk-leak.test.js > /tmp/ci-i18n-static.log 2>&1; then
  grep -E '^ℹ (tests|pass|fail)' /tmp/ci-i18n-static.log || true
  echo "OK 多语言静态 gate 通过"
else
  cat /tmp/ci-i18n-static.log; echo "FAIL 多语言静态 gate 未通过"; fail=1
fi

line "门禁 3/3 · 多语言运行时 gate（英文模式逐屏扫残留中文）"
node scripts/i18n-cjk-scan.mjs
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "OK 运行时 gate 通过"
elif [ "$rc" -eq 2 ]; then
  if [ "$REQUIRE_RUNTIME" -eq 1 ]; then
    echo "FAIL 运行时 gate 被要求执行但没有可用的 Chrome 调试端口"; fail=1
  else
    echo "SKIP 运行时 gate 未执行（无 Chrome 调试端口）——注意：这不是通过"
  fi
else
  echo "FAIL 运行时 gate 发现残留中文"; fail=1
fi

line "结论"
if [ "$fail" -eq 0 ]; then echo "CI GREEN"; else echo "CI RED"; fi
exit "$fail"
