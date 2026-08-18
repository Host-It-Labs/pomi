#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/worktree-lib.sh"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/node-env.sh"

cd "$ROOT_DIR"
pomi_use_node_version "$ROOT_DIR"

if pomi_is_linked_worktree; then
  worktree_id="$(pomi_worktree_id "$ROOT_DIR")"
  export POMI_COMPOSE_PROJECT="${POMI_COMPOSE_PROJECT:-pomi-wt-${worktree_id}}"
  export POMI_DEV_PORTS_FILE="${POMI_DEV_PORTS_FILE:-$ROOT_DIR/.pomi/dev-ports.env}"
fi

exec node "$ROOT_DIR/scripts/reset-dev-db-fixtures.mjs" "$@"
