#!/usr/bin/env bash

pomi_load_local_environment() {
  local script_dir exports
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  exports="$(node "$script_dir/local-env.mjs" --shell-exports)" || return
  eval "$exports"
}
