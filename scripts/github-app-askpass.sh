#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "${POMI_GITHUB_APP_TOKEN:?Missing App token}" ;;
  *) exit 1 ;;
esac
