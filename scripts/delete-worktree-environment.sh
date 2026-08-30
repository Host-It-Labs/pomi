#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/packages/backend/docker-compose.dev.yml"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/worktree-lib.sh"

cd "$ROOT_DIR"
pomi_require_linked_worktree "$ROOT_DIR"

worktree_id="$(pomi_worktree_id "$ROOT_DIR")"
legacy_worktree_id="$(pomi_legacy_worktree_id "$ROOT_DIR")"
branch_worktree_id="$(pomi_branch_worktree_id "$ROOT_DIR")"
POMI_COMPOSE_PROJECT="pomi-wt-${worktree_id}"
POMI_TMUX_SESSION="${POMI_TMUX_SESSION:-pomi-wt-${worktree_id}}"
POMI_DEV_PORTS_FILE="${POMI_DEV_PORTS_FILE:-$ROOT_DIR/.pomi/dev-ports.env}"
docker_cleanup_failed=false

echo "[pomi] deleting worktree dev environment for: $ROOT_DIR"
echo "[pomi] compose project: $POMI_COMPOSE_PROJECT"
echo "[pomi] tmux session: $POMI_TMUX_SESSION"
printf '[pomi] Type y to delete this worktree dev environment: '
read -r confirmation

if [[ "$confirmation" != "y" ]]; then
  echo "[pomi] delete cancelled."
  exit 0
fi

tmux kill-session -t "$POMI_TMUX_SESSION" >/dev/null 2>&1 || true
if [[ -n "$branch_worktree_id" && "$branch_worktree_id" != "$worktree_id" ]]; then
  tmux kill-session -t "pomi-wt-${branch_worktree_id}" >/dev/null 2>&1 || true
fi

if command -v docker >/dev/null 2>&1; then
  if ! docker compose \
    -f "$COMPOSE_FILE" \
    -p "$POMI_COMPOSE_PROJECT" \
    down \
    --volumes \
    --rmi local \
    --remove-orphans; then
    docker_cleanup_failed=true
  fi
  if [[ "$legacy_worktree_id" != "$worktree_id" ]]; then
    docker compose \
      -f "$COMPOSE_FILE" \
      -p "pomi-wt-${legacy_worktree_id}" \
      down \
      --volumes \
      --rmi local \
      --remove-orphans || true
  fi
  if [[ -n "$branch_worktree_id" && "$branch_worktree_id" != "$worktree_id" ]]; then
    docker compose \
      -f "$COMPOSE_FILE" \
      -p "pomi-wt-${branch_worktree_id}" \
      down \
      --volumes \
      --rmi local \
      --remove-orphans || true
  fi
else
  echo "[pomi] docker not found; skipped compose cleanup."
fi

pomi_remove_worktree_node_dependencies "$ROOT_DIR"

rm -rf \
  "$ROOT_DIR/.pomi" \
  "$ROOT_DIR/packages/backend/pgdata" \
  "$ROOT_DIR/packages/backend/pgdata18" \
  "$ROOT_DIR/packages/frontend/src-tauri/target"

if [[ -f "$POMI_DEV_PORTS_FILE" ]]; then
  rm -f "$POMI_DEV_PORTS_FILE"
fi

if [[ "$docker_cleanup_failed" == "true" ]]; then
  echo "[pomi] local worktree files were deleted, but Docker cleanup failed." >&2
  exit 1
fi

echo "[pomi] worktree dev environment deleted, including Node and Cargo build artifacts."
