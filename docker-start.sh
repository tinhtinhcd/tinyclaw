#!/usr/bin/env bash
set -euo pipefail

API_PORT="${TINYCLAW_API_PORT:-3777}"
UI_PORT="${UI_PORT:-3000}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:${API_PORT}}"

echo "[docker-start] starting backend on port ${API_PORT}"
npm run queue &
BACKEND_PID=$!

echo "[docker-start] starting tinyoffice UI on port ${UI_PORT}"
(
  cd tinyoffice
  npm run dev -- --hostname 0.0.0.0 --port "${UI_PORT}"
) &
UI_PID=$!

cleanup() {
  echo "[docker-start] stopping processes..."
  kill "${BACKEND_PID}" "${UI_PID}" 2>/dev/null || true
}

trap cleanup SIGINT SIGTERM EXIT

# If either process exits, fail container and stop the sibling process.
set +e
wait -n "${BACKEND_PID}" "${UI_PID}"
EXIT_CODE=$?
set -e

echo "[docker-start] one process exited (code=${EXIT_CODE}); shutting down"
kill "${BACKEND_PID}" "${UI_PID}" 2>/dev/null || true
wait "${BACKEND_PID}" "${UI_PID}" 2>/dev/null || true
exit "${EXIT_CODE}"
