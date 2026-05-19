#!/usr/bin/env bash
# aisd Agent — start server (3001) + web (4000) in one shot.
#
# Required env:
#   OPENAI_API_KEY            (mandatory for /skills/:id/run)
#
# Optional env:
#   REPO_ROOT                 default = repo root (derived from this script's path)
#   WORKSPACE_PATH            default $REPO_ROOT/workspace
#   OPENAI_MODEL              default gpt-4o
#   OPENAI_BASE_URL           default https://api.openai.com/v1
#   AGENT_SERVER_URL          default http://localhost:3001  (consumed by web)
#
# Logs are tailed to /tmp/aisd-agent-{server,web}.log

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$ROOT/server"
WEB_DIR="$ROOT/web"
SERVER_LOG="/tmp/aisd-agent-server.log"
WEB_LOG="/tmp/aisd-agent-web.log"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "WARNING: OPENAI_API_KEY is not set — POST /skills/:id/run will return 503."
fi

if ! command -v pnpm >/dev/null; then
  echo "pnpm not installed. brew install pnpm  or  npm i -g pnpm" >&2
  exit 1
fi

cleanup() {
  echo
  echo "Shutting down…"
  kill "${SERVER_PID:-0}" "${WEB_PID:-0}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "== installing server deps =="
(cd "$SERVER_DIR" && pnpm install --silent)
echo "== installing web deps =="
(cd "$WEB_DIR" && pnpm install --silent)

echo "== starting server (logs: $SERVER_LOG) =="
(cd "$SERVER_DIR" && pnpm dev) > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

echo "== starting web (logs: $WEB_LOG) =="
(cd "$WEB_DIR" && pnpm dev) > "$WEB_LOG" 2>&1 &
WEB_PID=$!

# wait briefly for boot
sleep 3
echo
echo "Agent server: http://localhost:${PORT:-3001}"
echo "Web UI:       http://localhost:4000/pipeline"
echo "Workspace:    ${WORKSPACE_PATH:-$ROOT/../workspace}"
echo
echo "Tail logs:    tail -f $SERVER_LOG $WEB_LOG"
echo "Press Ctrl-C to stop both."

wait
