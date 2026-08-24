#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
default_env_file="$script_dir/../config/pomi-automation.env"
env_file=${POMI_SENTRY_ENV_FILE:-$default_env_file}
loaded_from_file=false
carriage_return=$(printf '\r')

load_value() {
  key=$1
  value=$2

  case "$key" in
    SENTRY_AUTH_TOKEN|SENTRY_ORG|SENTRY_FRONTEND_PROJECT|SENTRY_BACKEND_PROJECT|SENTRY_ENVIRONMENT)
      export "$key=$value"
      ;;
  esac
}

if [ -f "$env_file" ]; then
  loaded_from_file=true
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%"$carriage_return"}
    case "$line" in
      ''|\#*) continue ;;
      export\ *) line=${line#export } ;;
    esac

    case "$line" in
      *=*) ;;
      *) continue ;;
    esac

    key=${line%%=*}
    value=${line#*=}
    key=$(printf '%s' "$key" | tr -d '[:space:]')

    case "$value" in
      \"*\") value=${value#\"}; value=${value%\"} ;;
      \'*\') value=${value#\'}; value=${value%\'} ;;
    esac

    case "$key" in
      SENTRY_AUTH_TOKEN|SENTRY_ORG|SENTRY_FRONTEND_PROJECT|SENTRY_BACKEND_PROJECT|SENTRY_ENVIRONMENT)
        load_value "$key" "$value"
        ;;
    esac
  done < "$env_file"
fi

export SENTRY_ENVIRONMENT="${SENTRY_ENVIRONMENT:-production}"

missing=''
for key in SENTRY_AUTH_TOKEN SENTRY_ORG SENTRY_FRONTEND_PROJECT SENTRY_BACKEND_PROJECT; do
  case "$key" in
    SENTRY_AUTH_TOKEN) value=${SENTRY_AUTH_TOKEN:-} ;;
    SENTRY_ORG) value=${SENTRY_ORG:-} ;;
    SENTRY_FRONTEND_PROJECT) value=${SENTRY_FRONTEND_PROJECT:-} ;;
    SENTRY_BACKEND_PROJECT) value=${SENTRY_BACKEND_PROJECT:-} ;;
  esac
  if [ -z "$value" ]; then
    missing="$missing $key"
  fi
done

if [ -n "$missing" ]; then
  echo "Sentry configuration incomplete; missing:$missing" >&2
  exit 2
fi

if [ "${1:-}" = '--check' ]; then
  if [ "$loaded_from_file" = true ]; then
    source_label="env-file-with-process-fallback"
  else
    source_label="process-environment"
  fi
  echo 'Sentry configuration: valid'
  echo 'SENTRY_AUTH_TOKEN=present'
  echo 'SENTRY_ORG=present'
  echo 'SENTRY_FRONTEND_PROJECT=present'
  echo 'SENTRY_BACKEND_PROJECT=present'
  echo "SENTRY_ENVIRONMENT=$SENTRY_ENVIRONMENT"
  echo "config_source=$source_label"
  exit 0
fi

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 --check | <command> [args...]" >&2
  exit 64
fi

exec "$@"
