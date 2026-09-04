#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
check_only=false
for arg in "$@"; do
  case "$arg" in
    --check-only)
      check_only=true
      ;;
    *)
      echo "[pomi] unsupported cleanup option: $arg" >&2
      exit 1
      ;;
  esac
done

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/worktree-lib.sh"

pomi_require_linked_worktree "$ROOT_DIR"
cd "$ROOT_DIR"

node "$ROOT_DIR/scripts/pr-readiness.mjs" check

if [[ "$check_only" == "true" ]]; then
  echo "[pomi] completion verified; no worktree files were removed."
  exit 0
fi

pomi_remove_worktree_node_dependencies "$ROOT_DIR"
echo "[pomi] removed worktree Node dependencies and the local pnpm store."
