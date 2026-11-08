#!/usr/bin/env bash
# 三方验证门禁 + 构建 + 打包。任何一段失败即停止（set -e）。
# 用法：bash verify.sh
set -e

echo "== 环境自证 =="
echo "bash : $BASH_VERSION"
echo "node : $(node -v)"
echo "npm  : $(npm -v)"
echo "tsc  : $(npx tsc -v)"
echo ""

echo "== 1/5 静态检查 =="
npx tsc --noEmit
npx eslint . --max-warnings=0
echo "  -> 0 error 0 warning"
echo ""

echo "== 2/5 单元测试 =="
npx vitest run
echo ""

echo "== 3/5 架构与文档约束 =="
node test/arch.js
python test/doc_check.py
echo ""

echo "== 4/5 构建 =="
node esbuild.js
echo ""

echo "== 5/5 打包 =="
npx vsce package --allow-missing-repository -o dist/verikit.vsix
node -e "const s=require('fs').statSync('dist/verikit.vsix').size;console.log('  vsix: '+(s/1024).toFixed(1)+' KB')"

# 打包内容白名单：fail-closed。新增要打包的目录时必须显式加进白名单，
# 否则 .vscodeignore 漏配会静默把 docs/、.workbuddy/ 之类塞进安装包。
# 注意：不能用中间文件收集清单——那会把清单本身也打进包里（踩过一次）。
LEAK=$(npx vsce ls | grep -Ev '^(README\.md|LICENSE|LICENSE\.md|package\.json|dist/extension\.js$|grammars/|snippets/|language-configuration\.json)' || true)
if [ -n "$LEAK" ]; then
  echo "  -> FAIL: 打包内容含白名单之外的路径（检查 .vscodeignore）:"
  echo "$LEAK" | sed 's/^/     /'
  exit 1
fi
echo "  -> 打包内容白名单检查通过"
echo ""

echo "ALL GREEN"
