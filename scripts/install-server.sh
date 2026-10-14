#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "用法：bash scripts/install-server.sh /实际的SillyTavern根目录" >&2
  exit 2
fi
project_root="$(cd "$(dirname "$0")/.." && pwd)"
st_root="$(cd "$1" && pwd)"
if [[ ! -f "$st_root/package.json" || ! -d "$st_root/plugins" ]]; then
  echo "目标不是完整的SillyTavern安装目录，未作修改" >&2
  exit 1
fi
target="$st_root/plugins/sillytavern-image-server"
if [[ -e "$target" ]]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  cp -a "$target" "$target.backup-$stamp"
  echo "原插件已备份为：$target.backup-$stamp"
fi
mkdir -p "$target"
cp -a "$project_root/server-plugin/." "$target/"
echo "服务器插件已复制到：$target"
echo "没有自动重启酒馆，也没有修改小白 X。"
