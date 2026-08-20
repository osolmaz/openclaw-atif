#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"
ROOT="$(pwd)"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT
mkdir -p "$TEMP_ROOT/agents/main/sessions" "$TEMP_ROOT/workspace"
SESSION="$TEMP_ROOT/agents/main/sessions/synthetic-session.jsonl"
cat >"$SESSION" <<EOF
{"type":"session","version":3,"id":"synthetic-session","timestamp":"2026-08-20T00:00:00.000Z","cwd":"$TEMP_ROOT/workspace"}
{"type":"message","id":"u1","parentId":null,"timestamp":"2026-08-20T00:00:01.000Z","message":{"role":"user","content":"Hello","timestamp":1}}
{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-08-20T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Hi"}],"api":"openai-responses","provider":"openai","model":"gpt-test","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":2}}
EOF
printf '{"agent:main:main":{"sessionId":"synthetic-session","updatedAt":2,"sessionFile":"%s"}}\n' "$SESSION" >"$TEMP_ROOT/agents/main/sessions/sessions.json"
printf '{"agents":{"defaults":{"workspace":"%s"}}}\n' "$TEMP_ROOT/workspace" >"$TEMP_ROOT/openclaw.json"

npm run build >/dev/null
set +e
node "$ROOT/dist/cli-main.js" export \
  --openclaw "$OPENCLAW_BIN" \
  --state-dir "$TEMP_ROOT" \
  --session-key agent:main:main \
  --output "$TEMP_ROOT/atif" \
  --json >"$TEMP_ROOT/result.json"
CODE=$?
set -e
# No runtime event exists in this fixture, so a truthful export is partial.
test "$CODE" = 2
test -f "$TEMP_ROOT/atif/trajectory.json"
test -f "$TEMP_ROOT/atif/receipt.json"
node -e 'const fs=require("fs");const value=JSON.parse(fs.readFileSync(process.argv[1]));if(value.status!=="partial")process.exit(1)' "$TEMP_ROOT/atif/receipt.json"
