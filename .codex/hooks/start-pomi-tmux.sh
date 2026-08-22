#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"

if [[ ! -d "${repo_root}/.git" ]]; then
  exit 0
fi

session_name="pomi-dev"

if tmux has-session -t "${session_name}" 2>/dev/null; then
  exit 0
fi

exec "${repo_root}/scripts/start-tmux-session.sh"
