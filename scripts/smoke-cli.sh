#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

PACKAGE="$(npm pack --silent --pack-destination "$TEMP_ROOT" | tail -n 1)"
mkdir -p "$TEMP_ROOT/install"
npm install --silent --prefix "$TEMP_ROOT/install" "$TEMP_ROOT/$PACKAGE"
CLI="$TEMP_ROOT/install/node_modules/.bin/openclaw-atif"
"$CLI" --help >/dev/null
"$CLI" --version >/dev/null
"$CLI" convert \
  --graph "$ROOT/fixtures/bundles/legacy-jsonl/graph.json" \
  --bundle-root "$ROOT/fixtures/bundles/legacy-jsonl" \
  --output "$TEMP_ROOT/output" \
  --json >/dev/null
test -f "$TEMP_ROOT/output/trajectory.json"
test -f "$TEMP_ROOT/output/receipt.json"
test "$(stat -c '%a' "$TEMP_ROOT/output")" = "700"
test "$(stat -c '%a' "$TEMP_ROOT/output/trajectory.json")" = "600"
