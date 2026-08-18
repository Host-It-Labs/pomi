#!/usr/bin/env bash
set -euo pipefail

run_with_retry() {
  local label="$1"
  local attempt status
  shift

  for attempt in $(seq 1 15); do
    if "$@"; then
      return 0
    else
      status="$?"
    fi

    if [[ "$status" -eq 2 ]]; then
      return "$status"
    fi

    if [[ "$attempt" -eq 15 ]]; then
      echo "[pomi] $label failed after 15 attempts." >&2
      return "$status"
    fi

    echo "[pomi] $label attempt $attempt failed; retrying in 3s."
    sleep 3
  done
}

run_with_retry \
  "migration history verification" \
  pnpm --filter @pomi/backend migration:verify-history
run_with_retry \
  "migrations" \
  pnpm --filter @pomi/backend migration:run
