#!/usr/bin/env bash
# 사용법: scripts/link-vault.sh <vault 경로>
# 빌드 결과물만 vault 플러그인 폴더에 심볼릭 링크한다 (node_modules는 vault에 들어가지 않음).
set -euo pipefail
vault="${1:?vault 경로를 지정하세요}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$vault/.obsidian/plugins/claude-panel"
mkdir -p "$dest"
for f in main.js manifest.json styles.css; do
  ln -sfn "$root/$f" "$dest/$f"
done
echo "linked into $dest"
