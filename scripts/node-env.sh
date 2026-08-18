#!/usr/bin/env bash

pomi_use_node_version() {
  local project_dir="${1:-}"
  local node_version="24"

  if [[ -z "$project_dir" ]]; then
    echo "[pomi] project dir is required for Node version setup." >&2
    return 1
  fi

  if [[ -f "$project_dir/.nvmrc" ]]; then
    node_version="$(tr -d '[:space:]' <"$project_dir/.nvmrc")"
  fi

  if [[ -z "${NVM_DIR:-}" ]]; then
    export NVM_DIR="$HOME/.nvm"
  fi

  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    if nvm use --silent "$node_version" >/dev/null; then
      return 0
    fi

    echo "[pomi] Node $node_version is required. Install it with: nvm install $node_version" >&2
    return 1
  fi

  if command -v node >/dev/null 2>&1 && node -v | grep -Eq "^v${node_version}(\\.|$)"; then
    return 0
  fi

  echo "[pomi] Node $node_version is required, but nvm is not available." >&2
  return 1
}
