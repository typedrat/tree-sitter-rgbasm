#!/usr/bin/env bash
set -euo pipefail
status=0
for f in test/highlight/*.asm; do
  if npx tree-sitter parse "$f" 2>/dev/null | grep -qE '\(ERROR|\(MISSING'; then
    echo "PARSE ERROR in $f"
    npx tree-sitter parse "$f" 2>/dev/null | grep -nE '\(ERROR|\(MISSING' || true
    status=1
  else
    echo "OK: $f"
  fi
done
exit $status
