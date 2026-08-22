#!/usr/bin/env bash
set -uo pipefail

mode="${1:-}"
case "$mode" in
  all)
    commands=("release:docker" "release:apps")
    ;;
  apps)
    commands=("release:android" "release:macos")
    ;;
  *)
    echo "Usage: scripts/run-parallel-releases.sh all|apps" >&2
    exit 2
    ;;
esac

pids=()
for command in "${commands[@]}"; do
  pnpm run "$command" &
  pids+=("$!")
done

status=0
for index in "${!pids[@]}"; do
  if ! wait "${pids[$index]}"; then
    echo "[pomi] ${commands[$index]} failed." >&2
    status=1
  fi
done

exit "$status"
