#!/usr/bin/env bash
# Copy fitment.json then gzip (avoids race with Wave B writers).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/data/fitment.json"
TMP="/tmp/fitment-stable-$$.json"
OUT="$ROOT/data/fitment.json.gz"
cp -f "$SRC" "$TMP"
python3 -c "import json,sys; json.load(open(sys.argv[1])); print('ok')" "$TMP"
gzip -c -9 "$TMP" > "$OUT"
cp -f "$OUT" /tmp/aa-gzip-data/fitment.json.gz 2>/dev/null || true
rm -f "$TMP"
ls -lh "$OUT"
