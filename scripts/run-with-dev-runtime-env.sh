#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/dev-runtime-env.sh"
pomi_load_dev_runtime_environment "$ROOT_DIR"

if [[ "${1:-}" == "--" ]]; then
  shift
fi
if [[ "$#" -eq 0 ]]; then
  echo "Usage: scripts/run-with-dev-runtime-env.sh -- <command> [args...]" >&2
  exit 2
fi
exec "$@"
