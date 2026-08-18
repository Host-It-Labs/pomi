#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_BASE_URL="${POMI_FRONTEND_BASE_URL:-http://localhost:${POMI_FRONTEND_PORT:-1420}}"
vite_pid=""

cleanup() {
  if [[ -n "$vite_pid" ]] && kill -0 "$vite_pid" >/dev/null 2>&1; then
    kill "$vite_pid" >/dev/null 2>&1 || true
    wait "$vite_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR"

echo "[pomi] starting Vite frontend at $FRONTEND_BASE_URL"
pnpm --filter @pomi/frontend dev &
vite_pid="$!"

for attempt in $(seq 1 60); do
  if curl --silent --fail --max-time 2 "$FRONTEND_BASE_URL" >/dev/null 2>&1; then
    break
  fi

  if ! kill -0 "$vite_pid" >/dev/null 2>&1; then
    wait "$vite_pid"
  fi

  if [[ "$attempt" -eq 60 ]]; then
    echo "[pomi] frontend did not start at $FRONTEND_BASE_URL." >&2
    exit 1
  fi

  sleep 1
done

echo "[pomi] starting native app against existing Vite server"
node ./scripts/dev-frontend.mjs desktop --use-existing-vite --no-watch
