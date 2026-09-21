#!/usr/bin/env bash
# 실제 CLI 스트림(SDK와 같은 메시지 형식)을 녹화해 normalize 회귀 테스트 입력으로 쓴다.
# 임시 폴더에서 가장 가벼운 모델로, hook을 끄고 실행한다.
set -euo pipefail
out="$(cd "$(dirname "$0")/.." && pwd)/tests/fixtures"
mkdir -p "$out"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
echo "hello-fixture" > note.txt
claude -p "Read note.txt with the Read tool, then reply with its content in one short sentence." \
  --output-format stream-json --include-partial-messages --verbose --model haiku \
  --allowedTools Read --settings '{"disableAllHooks":true}' > "$out/read-and-reply.jsonl"
echo "wrote $out/read-and-reply.jsonl ($(wc -l < "$out/read-and-reply.jsonl") lines)"
