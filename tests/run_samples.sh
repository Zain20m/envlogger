#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ENVLOGGER_LUAU="${ENVLOGGER_LUAU:-/tmp/luau}"
mkdir -p "$ROOT/out"
ok=0; fail=0
for f in "$ROOT"/samples/*.lua; do
  name=$(basename "$f" .lua)
  echo "=== $name ==="
  if node "$ROOT/src/run.js" "$f" -o "$ROOT/out/${name}.txt" --budget 25 --json > "$ROOT/out/${name}.json" 2>"$ROOT/out/${name}.err"; then
    echo "OK $(wc -c < "$ROOT/out/${name}.txt") bytes report"
    ok=$((ok+1))
  else
    echo "FAIL exit $?"
    fail=$((fail+1))
  fi
done
echo "done ok=$ok fail=$fail"
