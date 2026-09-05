#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/local-env.sh"
pomi_load_local_environment

COMPOSE_FILE="$ROOT_DIR/packages/backend/docker-compose.dev.yml"
COMPOSE_PROJECT="${POMI_COMPOSE_PROJECT:-pomi}"
DEFAULT_DEV_PORTS_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/pomi/dev-ports.env"
DEV_PORTS_FILE="${POMI_DEV_PORTS_FILE:-$DEFAULT_DEV_PORTS_FILE}"
INITIAL_DEV_PORTS_FILE_MTIME=""

cd "$ROOT_DIR"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/dev-ports.sh"

if [[ -f "$DEV_PORTS_FILE" ]]; then
  INITIAL_DEV_PORTS_FILE_MTIME="$(
    stat -f '%m' "$DEV_PORTS_FILE" 2>/dev/null ||
      stat -c '%Y' "$DEV_PORTS_FILE" 2>/dev/null ||
      true
  )"
fi

dev_ports_file_changed() {
  local current_mtime

  [[ -f "$DEV_PORTS_FILE" ]] || return 1
  current_mtime="$(
    stat -f '%m' "$DEV_PORTS_FILE" 2>/dev/null ||
      stat -c '%Y' "$DEV_PORTS_FILE" 2>/dev/null ||
      true
  )"

  [[ -n "$current_mtime" && "$current_mtime" != "$INITIAL_DEV_PORTS_FILE_MTIME" ]]
}

POMI_BACKEND_PORT_EXPLICIT="${POMI_BACKEND_PORT+x}"
POMI_DB_PORT_EXPLICIT="${POMI_DB_PORT+x}"
POMI_REDIS_PORT_EXPLICIT="${POMI_REDIS_PORT+x}"

read_compose_port() {
  service="$1"
  container_port="$2"

  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" port "$service" "$container_port" 2>/dev/null |
    awk -F ':' 'NF > 1 { print $NF }' |
    tail -n 1
}

resolve_port() {
  local key="$1"
  local service="$2"
  local container_port="$3"
  local compose_port
  local explicit_key="${key}_EXPLICIT"

  if [[ -n "${!explicit_key:-}" && -n "${!key:-}" ]]; then
    return 0
  fi

  compose_port="$(read_compose_port "$service" "$container_port" || true)"
  if [[ -n "$compose_port" ]]; then
    export "${key}=${compose_port}"
    return 0
  fi

  unset "$key"
  if dev_ports_file_changed; then
    pomi_export_numeric_env_file_value "$DEV_PORTS_FILE" "$key"
  fi

  return 0
}

echo "[pomi] waiting for backend ports from env, $DEV_PORTS_FILE, or compose project $COMPOSE_PROJECT"

for attempt in $(seq 1 180); do
  resolve_port POMI_BACKEND_PORT backend 3000
  resolve_port POMI_DB_PORT db 5432
  resolve_port POMI_REDIS_PORT redis 6379

  if [[ -n "${POMI_BACKEND_PORT:-}" && -n "${POMI_DB_PORT:-}" && -n "${POMI_REDIS_PORT:-}" ]]; then
    break
  fi

  if [[ "$attempt" -eq 180 ]]; then
    echo "[pomi] compose ports were not resolved for project $COMPOSE_PROJECT." >&2
    exit 1
  fi

  if [[ "$attempt" -eq 1 || "$((attempt % 10))" -eq 0 ]]; then
    echo "[pomi] backend ports not ready yet; retrying..."
  fi

  sleep 1
done

export POMI_BACKEND_PORT
export POMI_DB_PORT
export POMI_REDIS_PORT="${POMI_REDIS_PORT:-6379}"
export POMI_BACKEND_BASE_URL="http://localhost:${POMI_BACKEND_PORT}"
export DATABASE_URL="postgres://user:password@localhost:${POMI_DB_PORT}/pomodoro"
export REDIS_URL="redis://localhost:${POMI_REDIS_PORT}"
echo "[pomi] backend ports: backend=$POMI_BACKEND_PORT db=$POMI_DB_PORT redis=$POMI_REDIS_PORT"
copyme_username="${VITE_DEV_AUTO_LOGIN_USERNAME:-${POMI_COPYME_USERNAME:-copyme}}"
copyme_password="${VITE_DEV_AUTO_LOGIN_PASSWORD:-${POMI_COPYME_PASSWORD:-$copyme_username}}"

docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" stop backend >/dev/null 2>&1 || true
"$ROOT_DIR/scripts/run-dev-migrations.sh"

POMI_COPYME_USERNAME="$copyme_username" \
  POMI_COPYME_PASSWORD="$copyme_password" \
  pnpm --filter @pomi/backend ensure:copyme

docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d --build --renew-anon-volumes backend >/dev/null

for attempt in $(seq 1 60); do
  if curl --silent --fail --max-time 5 "$POMI_BACKEND_BASE_URL/health" >/dev/null 2>&1; then
    break
  fi

  if [[ "$attempt" -eq 60 ]]; then
    echo "[pomi] backend did not become healthy at $POMI_BACKEND_BASE_URL/health." >&2
    exit 1
  fi

  sleep 1
done

echo "[pomi] copyme fixture is seeded and auto-login is enabled"

work_context_slug="${VITE_TEST_CONTEXT_SLUG:-${POMI_CURRENT_WORK_SLUG:-$(git branch --show-current)}}"
work_context_slug="${work_context_slug:-local-development}"

VITE_DEV_AUTO_LOGIN_USERNAME="$copyme_username" \
  VITE_DEV_AUTO_LOGIN_PASSWORD="$copyme_password" \
  VITE_TEST_CONTEXT_SLUG="$work_context_slug" \
  pnpm run dev:frontend
