#!/usr/bin/env bash
set -euo pipefail

attach=false

for arg in "$@"; do
  case "$arg" in
    --attach)
      attach=true
      ;;
    *)
      echo "[pomi] unsupported worktree environment option: $arg" >&2
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/packages/backend/docker-compose.dev.yml"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/worktree-lib.sh"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/dev-ports.sh"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/node-env.sh"

cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/config/current-work.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/config/current-work.env"
  set +a
fi
export POMI_CURRENT_WORK_SLUG="${POMI_CURRENT_WORK_SLUG:-test-context-slug}"
POMI_COPYME_USERNAME="${POMI_COPYME_USERNAME:-copyme}"
POMI_COPYME_PASSWORD="${POMI_COPYME_PASSWORD:-$POMI_COPYME_USERNAME}"

pomi_use_node_version "$ROOT_DIR"
pomi_require_linked_worktree "$ROOT_DIR"

worktree_id="$(pomi_worktree_id "$ROOT_DIR")"
legacy_worktree_id="$(pomi_legacy_worktree_id "$ROOT_DIR")"
branch_worktree_id="$(pomi_branch_worktree_id "$ROOT_DIR")"
custom_compose_project="${POMI_COMPOSE_PROJECT:-}"
export POMI_COMPOSE_PROJECT="${POMI_COMPOSE_PROJECT:-pomi-wt-${worktree_id}}"
export POMI_DEV_PORTS_FILE="${POMI_DEV_PORTS_FILE:-$ROOT_DIR/.pomi/dev-ports.env}"
export POMI_TMUX_SESSION="${POMI_TMUX_SESSION:-pomi-wt-${worktree_id}}"

mkdir -p "$(dirname "$POMI_DEV_PORTS_FILE")"

"$ROOT_DIR/scripts/setup-development-environment.sh" --require-worktree
main_worktree="$(pomi_main_worktree)"
pomi_seed_worktree_cargo_cache "$ROOT_DIR" "$main_worktree"

if [[ ! -f "$ROOT_DIR/packages/backend/.env" ]]; then
  cp "$ROOT_DIR/packages/backend/.env.example" "$ROOT_DIR/packages/backend/.env"
  echo "[pomi] copied packages/backend/.env.example to packages/backend/.env"
fi

docker compose -f "$COMPOSE_FILE" -p "$POMI_COMPOSE_PROJECT" down --remove-orphans >/dev/null 2>&1 || true
if [[ "$legacy_worktree_id" != "$worktree_id" && -z "$custom_compose_project" ]]; then
  docker compose -f "$COMPOSE_FILE" -p "pomi-wt-${legacy_worktree_id}" down --remove-orphans >/dev/null 2>&1 || true
fi
if [[ -n "$branch_worktree_id" && "$branch_worktree_id" != "$worktree_id" && -z "$custom_compose_project" ]]; then
  docker compose -f "$COMPOSE_FILE" -p "pomi-wt-${branch_worktree_id}" down --remove-orphans >/dev/null 2>&1 || true
fi

POMI_COMPOSE_PROJECT="$POMI_COMPOSE_PROJECT" \
POMI_DEV_PORTS_FILE="$POMI_DEV_PORTS_FILE" \
  pnpm run docker:dev:detached

pomi_export_numeric_env_file_value "$POMI_DEV_PORTS_FILE" "POMI_BACKEND_PORT"
pomi_export_numeric_env_file_value "$POMI_DEV_PORTS_FILE" "POMI_DB_PORT"
pomi_export_numeric_env_file_value "$POMI_DEV_PORTS_FILE" "POMI_REDIS_PORT"

export POMI_BACKEND_PORT="${POMI_BACKEND_PORT:-3000}"
export POMI_DB_PORT="${POMI_DB_PORT:-5432}"
export POMI_REDIS_PORT="${POMI_REDIS_PORT:-6379}"
export POMI_BACKEND_BASE_URL="http://localhost:${POMI_BACKEND_PORT}"
export DATABASE_URL="postgres://user:password@localhost:${POMI_DB_PORT}/pomodoro"
export REDIS_URL="redis://localhost:${POMI_REDIS_PORT}"

pnpm --filter @pomi/shared build

if ! "$ROOT_DIR/scripts/run-dev-migrations.sh"; then
  docker compose -f "$COMPOSE_FILE" -p "$POMI_COMPOSE_PROJECT" logs db --tail 40 || true
  exit 1
fi

POMI_COPYME_USERNAME="$POMI_COPYME_USERNAME" \
  POMI_COPYME_PASSWORD="$POMI_COPYME_PASSWORD" \
  pnpm --filter @pomi/backend ensure:copyme

docker compose -f "$COMPOSE_FILE" -p "$POMI_COMPOSE_PROJECT" restart backend >/dev/null

for attempt in $(seq 1 60); do
  if curl --silent --fail --max-time 5 "$POMI_BACKEND_BASE_URL/health" >/dev/null 2>&1; then
    break
  fi

  if [[ "$attempt" -eq 60 ]]; then
    echo "[pomi] backend did not become healthy at $POMI_BACKEND_BASE_URL/health." >&2
    docker compose -f "$COMPOSE_FILE" -p "$POMI_COMPOSE_PROJECT" logs backend --tail 60 || true
    exit 1
  fi

  sleep 1
done

POMI_DEV_PORTS_FILE="$POMI_DEV_PORTS_FILE" \
POMI_BACKEND_PORT="$POMI_BACKEND_PORT" \
  node ./scripts/prepare-frontend-dev.mjs

pomi_export_numeric_env_file_value "$POMI_DEV_PORTS_FILE" "POMI_FRONTEND_PORT"
pomi_export_numeric_env_file_value "$POMI_DEV_PORTS_FILE" "POMI_FRONTEND_HMR_PORT"

export POMI_FRONTEND_PORT="${POMI_FRONTEND_PORT:-1420}"
export POMI_FRONTEND_HMR_PORT="${POMI_FRONTEND_HMR_PORT:-1421}"
export POMI_FRONTEND_BASE_URL="http://localhost:${POMI_FRONTEND_PORT}"

printf -v compose_project_q '%q' "$POMI_COMPOSE_PROJECT"
printf -v dev_ports_file_q '%q' "$POMI_DEV_PORTS_FILE"
printf -v backend_port_q '%q' "$POMI_BACKEND_PORT"
printf -v backend_base_url_q '%q' "$POMI_BACKEND_BASE_URL"
printf -v db_port_q '%q' "$POMI_DB_PORT"
printf -v redis_port_q '%q' "$POMI_REDIS_PORT"
printf -v frontend_port_q '%q' "$POMI_FRONTEND_PORT"
printf -v frontend_hmr_port_q '%q' "$POMI_FRONTEND_HMR_PORT"
printf -v frontend_base_url_q '%q' "$POMI_FRONTEND_BASE_URL"
printf -v current_work_slug_q '%q' "$POMI_CURRENT_WORK_SLUG"
printf -v copyme_username_q '%q' "$POMI_COPYME_USERNAME"
printf -v copyme_password_q '%q' "$POMI_COPYME_PASSWORD"

export POMI_PROJECT_DIR="$ROOT_DIR"
export POMI_TMUX_SKIP_COMPOSE_STOP=true
export POMI_TMUX_BACKEND_COMMAND="POMI_COMPOSE_PROJECT=${compose_project_q} POMI_DEV_PORTS_FILE=${dev_ports_file_q} pnpm run docker:dev:logs -- backend"
export POMI_TMUX_FRONTEND_COMMAND="POMI_DEV_PORTS_FILE=${dev_ports_file_q} POMI_BACKEND_PORT=${backend_port_q} POMI_BACKEND_BASE_URL=${backend_base_url_q} POMI_FRONTEND_PORT=${frontend_port_q} POMI_FRONTEND_HMR_PORT=${frontend_hmr_port_q} POMI_FRONTEND_BASE_URL=${frontend_base_url_q} VITE_DEV_AUTO_LOGIN_USERNAME=${copyme_username_q} VITE_DEV_AUTO_LOGIN_PASSWORD=${copyme_password_q} VITE_TEST_CONTEXT_SLUG=${current_work_slug_q} ./scripts/start-worktree-frontend.sh"
export POMI_TMUX_SHELL_COMMAND="export POMI_COMPOSE_PROJECT=${compose_project_q} POMI_DEV_PORTS_FILE=${dev_ports_file_q} POMI_BACKEND_PORT=${backend_port_q} POMI_BACKEND_BASE_URL=${backend_base_url_q} POMI_DB_PORT=${db_port_q} POMI_REDIS_PORT=${redis_port_q} POMI_FRONTEND_PORT=${frontend_port_q} POMI_FRONTEND_HMR_PORT=${frontend_hmr_port_q} POMI_FRONTEND_BASE_URL=${frontend_base_url_q}; echo \"[pomi] backend: \$POMI_BACKEND_BASE_URL\"; echo \"[pomi] frontend: \$POMI_FRONTEND_BASE_URL\"; echo \"[pomi] ports: \$POMI_DEV_PORTS_FILE\"; echo \"[pomi] copyme fixture is seeded and auto-login is enabled\""

if [[ "$attach" == "true" ]]; then
  exec "$ROOT_DIR/scripts/start-tmux-session.sh" --attach
fi

exec "$ROOT_DIR/scripts/start-tmux-session.sh"
