#!/usr/bin/env bash

pomi_load_dev_runtime_environment() {
  local root_dir="$1"
  local database_url_explicit="${DATABASE_URL+x}"
  local redis_url_explicit="${REDIS_URL+x}"
  local db_port_explicit="${POMI_DB_PORT+x}"
  local redis_port_explicit="${POMI_REDIS_PORT+x}"
  local default_state_file="${XDG_STATE_HOME:-$HOME/.local/state}/pomi/dev-ports.env"
  local worktree_state_file="$root_dir/.pomi/dev-ports.env"
  local state_file="${POMI_DEV_PORTS_FILE:-}"

  # shellcheck disable=SC1091
  . "$root_dir/scripts/local-env.sh"
  pomi_load_local_environment
  # shellcheck disable=SC1091
  . "$root_dir/scripts/dev-ports.sh"

  if [[ -z "$state_file" ]]; then
    if [[ -f "$worktree_state_file" ]]; then
      state_file="$worktree_state_file"
    else
      state_file="$default_state_file"
    fi
  fi
  export POMI_DEV_PORTS_FILE="$state_file"

  if [[ -z "$db_port_explicit" ]]; then
    unset POMI_DB_PORT
    pomi_export_numeric_env_file_value "$state_file" POMI_DB_PORT
  fi
  if [[ -z "$redis_port_explicit" ]]; then
    unset POMI_REDIS_PORT
    pomi_export_numeric_env_file_value "$state_file" POMI_REDIS_PORT
  fi

  export POMI_DB_PORT="${POMI_DB_PORT:-5432}"
  export POMI_REDIS_PORT="${POMI_REDIS_PORT:-6379}"
  if [[ -z "$database_url_explicit" ]]; then
    export DATABASE_URL="postgres://user:password@localhost:${POMI_DB_PORT}/pomodoro"
  fi
  if [[ -z "$redis_url_explicit" ]]; then
    export REDIS_URL="redis://localhost:${POMI_REDIS_PORT}"
  fi
}
