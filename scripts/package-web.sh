#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ZIP_PATH="${REPO_ROOT}/clawpanel.zip"

cd "${REPO_ROOT}"

echo "==> 构建 Web 产物"
npm run build

if ! command -v zip >/dev/null 2>&1; then
  echo "错误：未找到 zip 命令，请先安装 zip 后再运行 npm run package:web。" >&2
  exit 1
fi

rm -f "${ZIP_PATH}"

echo "==> 打包最小运行包"
zip -r "${ZIP_PATH}" dist package.json scripts/serve.js scripts/dev-api.js >/dev/null

echo "已生成：${ZIP_PATH}"
echo "上传示例："
echo "  scp ${ZIP_PATH} user@server:/opt/clawpanel/"
echo "启动示例："
echo "  cd /opt/clawpanel"
echo "  unzip -o clawpanel.zip"
echo "  pm2 start scripts/serve.js --interpreter node --name clawpanel -- --port 1420"
