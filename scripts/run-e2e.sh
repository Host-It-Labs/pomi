#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/local-env.sh"
pomi_load_local_environment

COMPOSE_FILE="$ROOT_DIR/packages/backend/docker-compose.dev.yml"
COMPOSE_PROJECT="${POMI_COMPOSE_PROJECT:-pomi}"
DEFAULT_DEV_PORTS_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/pomi/dev-ports.env"
WORKTREE_DEV_PORTS_FILE="$ROOT_DIR/.pomi/dev-ports.env"
DEV_PORTS_FILE="${POMI_DEV_PORTS_FILE:-}"
EXPLICIT_BACKEND_PORT="${POMI_BACKEND_PORT:-${NEST_PORT:-}}"
EXPLICIT_BACKEND_BASE_URL="${POMI_BACKEND_BASE_URL:-}"
EXPLICIT_FRONTEND_PORT="${POMI_FRONTEND_PORT:-}"
EXPLICIT_FRONTEND_BASE_URL="${POMI_FRONTEND_BASE_URL:-}"
EXPLICIT_DB_PORT="${POMI_DB_PORT:-}"
EXPLICIT_DATABASE_URL="${DATABASE_URL:-}"
EXPLICIT_REDIS_PORT="${POMI_REDIS_PORT:-}"
EXPLICIT_REDIS_URL="${REDIS_URL:-}"

if [[ -z "$DEV_PORTS_FILE" ]]; then
  if [[ -f "$WORKTREE_DEV_PORTS_FILE" ]]; then
    DEV_PORTS_FILE="$WORKTREE_DEV_PORTS_FILE"
  else
    DEV_PORTS_FILE="$DEFAULT_DEV_PORTS_FILE"
  fi
fi

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/dev-ports.sh"

export_numeric_env_file_value_if_unset() {
  local file_path="$1"
  local key="$2"

  if [[ -n "${!key:-}" ]]; then
    return 0
  fi

  pomi_export_numeric_env_file_value "$file_path" "$key"
}

if [[ -f "$DEV_PORTS_FILE" ]]; then
  export_numeric_env_file_value_if_unset "$DEV_PORTS_FILE" "POMI_BACKEND_PORT"
  export_numeric_env_file_value_if_unset "$DEV_PORTS_FILE" "POMI_DB_PORT"
  export_numeric_env_file_value_if_unset "$DEV_PORTS_FILE" "POMI_REDIS_PORT"
  export_numeric_env_file_value_if_unset "$DEV_PORTS_FILE" "POMI_FRONTEND_PORT"
fi

if [[ -n "${CI:-}" ]]; then
  if [[ -z "$EXPLICIT_BACKEND_PORT$EXPLICIT_BACKEND_BASE_URL" ]]; then
    export POMI_BACKEND_PORT="${NEST_PORT:-3000}"
  fi
  if [[ -z "$EXPLICIT_FRONTEND_PORT$EXPLICIT_FRONTEND_BASE_URL" ]]; then
    export POMI_FRONTEND_PORT="1420"
  fi
fi

export POMI_BACKEND_PORT="${POMI_BACKEND_PORT:-${NEST_PORT:-3000}}"
export POMI_DB_PORT="${POMI_DB_PORT:-5432}"
export POMI_REDIS_PORT="${POMI_REDIS_PORT:-6379}"
export POMI_BACKEND_BASE_URL="${POMI_BACKEND_BASE_URL:-http://localhost:${POMI_BACKEND_PORT}}"
export POMI_BACKEND_HEALTH_URL="${POMI_BACKEND_HEALTH_URL:-${POMI_BACKEND_BASE_URL}/health}"
export POMI_FRONTEND_PORT="${POMI_FRONTEND_PORT:-1420}"
export POMI_FRONTEND_BASE_URL="${POMI_FRONTEND_BASE_URL:-http://localhost:${POMI_FRONTEND_PORT}}"
export DATABASE_URL="${DATABASE_URL:-postgres://user:password@localhost:${POMI_DB_PORT}/pomodoro}"
export REDIS_URL="${REDIS_URL:-redis://localhost:${POMI_REDIS_PORT}}"
if [[ -z "${POMI_E2E_ADMIN_USERNAME_PATTERN:-}" ]]; then
  export POMI_E2E_ADMIN_USERNAME_PATTERN='testuser_e2e_admin_{repeatIndex}_{parallelIndex}'
fi
export POMI_E2E_ADMIN_PASSWORD="${POMI_E2E_ADMIN_PASSWORD:-testpass123}"
E2E_EXPLICIT_WORKERS=""
for ((E2E_ARGUMENT_INDEX = 1; E2E_ARGUMENT_INDEX <= $#; E2E_ARGUMENT_INDEX++)); do
  E2E_ARGUMENT="${!E2E_ARGUMENT_INDEX}"
  case "$E2E_ARGUMENT" in
    --workers=*)
      E2E_EXPLICIT_WORKERS="${E2E_ARGUMENT#--workers=}"
      ;;
    --workers)
      ((++E2E_ARGUMENT_INDEX))
      E2E_EXPLICIT_WORKERS="${!E2E_ARGUMENT_INDEX:-}"
      ;;
  esac
done
if [[ ! "$E2E_EXPLICIT_WORKERS" =~ ^[1-9][0-9]*$ ]]; then
  E2E_EXPLICIT_WORKERS=""
fi
export POMI_E2E_ADMIN_PARALLEL_COUNT="${POMI_E2E_ADMIN_PARALLEL_COUNT:-${E2E_EXPLICIT_WORKERS:-${PLAYWRIGHT_CI_WORKERS:-${PLAYWRIGHT_LOCAL_WORKERS:-7}}}}"
if [[ -z "${POMI_E2E_ADMIN_REPEAT_COUNT:-}" ]]; then
  E2E_REPEAT_COUNT=1
  for E2E_ARGUMENT in "$@"; do
    if [[ "$E2E_ARGUMENT" == --repeat-each=* ]]; then
      E2E_REPEAT_COUNT="${E2E_ARGUMENT#--repeat-each=}"
    fi
  done
  export POMI_E2E_ADMIN_REPEAT_COUNT="$E2E_REPEAT_COUNT"
fi

BACKEND_HEALTH_URL="$POMI_BACKEND_HEALTH_URL"
FRONTEND_BASE_URL="$POMI_FRONTEND_BASE_URL"
PLAYWRIGHT_LOCAL_WORKERS="${PLAYWRIGHT_LOCAL_WORKERS:-7}"

cleanup() {
  rm -rf "${ROOT_DIR}/test-results" \
    "${ROOT_DIR}/playwright-report" \
    "${ROOT_DIR}/playwright/.cache" \
    "${ROOT_DIR}/.playwright"
  rm -rf "${ROOT_DIR}/.playwright-mcp"*
}

is_backend_healthy() {
  curl --silent --fail \
    --max-time 5 \
    "$BACKEND_HEALTH_URL" >/dev/null 2>&1
}

wait_for_backend_health() {
  local attempts="$1"
  local delay_seconds="$2"
  local attempt=1

  while (( attempt <= attempts )); do
    if is_backend_healthy; then
      return 0
    fi
    sleep "$delay_seconds"
    ((attempt++))
  done

  return 1
}

is_frontend_running() {
  curl --silent --fail \
    --max-time 5 \
    "$FRONTEND_BASE_URL" >/dev/null 2>&1
}

is_url_running() {
  local url="$1"

  curl --silent --fail \
    --max-time 5 \
    "$url" >/dev/null 2>&1
}

read_compose_port() {
  local service="$1"
  local container_port="$2"

  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" port "$service" "$container_port" 2>/dev/null |
    awk -F ':' 'NF > 1 { print $NF }' |
    tail -n 1
}

use_default_app_ports_if_running() {
  if [[ -n "${CI:-}" ]]; then
    return 0
  fi

  if [[ -n "$EXPLICIT_BACKEND_PORT$EXPLICIT_BACKEND_BASE_URL$EXPLICIT_FRONTEND_PORT$EXPLICIT_FRONTEND_BASE_URL" ]]; then
    return 0
  fi

  if is_backend_healthy && is_frontend_running; then
    return 0
  fi

  local default_backend_port="${NEST_PORT:-3000}"
  local default_frontend_port="1420"
  local default_db_port
  local default_redis_port
  local default_backend_base_url="http://localhost:${default_backend_port}"
  local default_backend_health_url="${default_backend_base_url}/health"
  local default_frontend_base_url="http://localhost:${default_frontend_port}"

  if is_url_running "$default_backend_health_url" && is_url_running "$default_frontend_base_url"; then
    default_db_port="$(read_compose_port db 5432 || true)"
    default_redis_port="$(read_compose_port redis 6379 || true)"
    default_db_port="${default_db_port:-5432}"
    default_redis_port="${default_redis_port:-6379}"
    export POMI_BACKEND_PORT="$default_backend_port"
    export POMI_BACKEND_BASE_URL="$default_backend_base_url"
    export POMI_BACKEND_HEALTH_URL="$default_backend_health_url"
    export POMI_FRONTEND_PORT="$default_frontend_port"
    export POMI_FRONTEND_BASE_URL="$default_frontend_base_url"
    if [[ -z "$EXPLICIT_DB_PORT$EXPLICIT_DATABASE_URL" ]]; then
      export POMI_DB_PORT="$default_db_port"
      export DATABASE_URL="postgres://user:password@localhost:${POMI_DB_PORT}/pomodoro"
    fi
    if [[ -z "$EXPLICIT_REDIS_PORT$EXPLICIT_REDIS_URL" ]]; then
      export POMI_REDIS_PORT="$default_redis_port"
      export REDIS_URL="redis://localhost:${POMI_REDIS_PORT}"
    fi
    BACKEND_HEALTH_URL="$POMI_BACKEND_HEALTH_URL"
    FRONTEND_BASE_URL="$POMI_FRONTEND_BASE_URL"
    echo "Resolved stale E2E app endpoints from ${DEV_PORTS_FILE}; using running default backend/frontend ports."
  fi
}

restart_backend_container_if_running() {
  if command -v docker >/dev/null 2>&1 && docker ps -q -f name=pomi-backend-1 -f status=running | grep -q .; then
    echo "Restarting pomi-backend-1 container..."
    docker restart pomi-backend-1 >/dev/null
  fi
}

use_default_app_ports_if_running

echo "E2E endpoints: backend=${POMI_BACKEND_BASE_URL}, frontend=${POMI_FRONTEND_BASE_URL}, db=localhost:${POMI_DB_PORT}, redis=localhost:${POMI_REDIS_PORT}"

cleanup
cd "$ROOT_DIR"
pnpm --filter @pomi/backend db:clear

if ! wait_for_backend_health 3 1; then
  echo "Backend health check failed at ${BACKEND_HEALTH_URL}. Attempting one restart..."
  restart_backend_container_if_running
  if ! wait_for_backend_health 30 1; then
    echo "Backend is unhealthy after one restart attempt. Aborting E2E run early."
    exit 1
  fi
fi

pnpm --filter @pomi/backend seed:e2e-admins

HAS_EXPLICIT_SPEC=0
for argument in "$@"; do
  if [[ "$argument" == *.spec.ts ]]; then
    HAS_EXPLICIT_SPEC=1
    break
  fi
done

PLAYWRIGHT_ARGS=(--reporter=list)
if [[ "$HAS_EXPLICIT_SPEC" == "0" ]]; then
  PLAYWRIGHT_ARGS+=(e2e/journeys.spec.ts)
fi
PLAYWRIGHT_ARGS+=("$@")

if [ -n "${CI:-}" ]; then
  PLAYWRIGHT_ARGS+=(--fail-on-flaky-tests)
  # If the frontend dev server is already running, allow Playwright to reuse it
  if is_frontend_running; then
    export PLAYWRIGHT_REUSE_SERVER=1
  fi
else
  if [[ -z "$E2E_EXPLICIT_WORKERS" ]]; then
    PLAYWRIGHT_ARGS+=(--workers="${PLAYWRIGHT_LOCAL_WORKERS}")
  fi
fi

PLAYWRIGHT_EXIT_CODE=0
pnpm exec playwright test "${PLAYWRIGHT_ARGS[@]}" || PLAYWRIGHT_EXIT_CODE=$?

if [[ -z "${CI:-}" && "${POMI_E2E_SKIP_FINAL_CLEANUP:-}" == "1" ]]; then
  echo "Skipping final E2E test data cleanup; the next wrapper run will still clear test data before it starts."
else
  pnpm --filter @pomi/backend db:clear
fi

restart_backend_container_if_running

exit $PLAYWRIGHT_EXIT_CODE
