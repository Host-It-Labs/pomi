#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runner="$script_dir/run-pomi-sentry.sh"
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/pomi-sentry-env.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT INT TERM

assert_contains() {
  haystack=$1
  needle=$2
  case "$haystack" in
    *"$needle"*) ;;
    *)
      echo "Expected output to contain: $needle" >&2
      exit 1
      ;;
  esac
}

assert_not_contains() {
  haystack=$1
  needle=$2
  case "$haystack" in
    *"$needle"*)
      echo "Expected output not to contain secret sentinel." >&2
      exit 1
      ;;
    *) ;;
  esac
}

assert_command_env() {
  env_file=$1
  expected_org=$2
  expected_environment=$3
  shift 3

  env -i PATH="$PATH" "$@" POMI_SENTRY_ENV_FILE="$env_file" "$runner" sh -c '
    [ "$SENTRY_AUTH_TOKEN" = "file-token" ]
    [ "$SENTRY_ORG" = "$0" ]
    [ "$SENTRY_FRONTEND_PROJECT" = "frontend-project" ]
    [ "$SENTRY_BACKEND_PROJECT" = "backend-project" ]
    [ "$SENTRY_ENVIRONMENT" = "$1" ]
    [ -z "${POMI_RADAR_GITHUB_APP_PRIVATE_KEY:-}" ]
    [ -z "${POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH:-}" ]
  ' "$expected_org" "$expected_environment"
}

quoted_file="$test_dir/quoted.env"
printf '%s\n' \
  'SENTRY_AUTH_TOKEN="file-token"' \
  "SENTRY_ORG='file-org'" \
  'SENTRY_FRONTEND_PROJECT=frontend-project' \
  'SENTRY_BACKEND_PROJECT=backend-project' \
  'POMI_RADAR_GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----' \
  'sentinel-private-key-material' \
  '-----END PRIVATE KEY-----"' \
  'POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH=sentinel-private-key-path' \
  '# SENTRY_ENVIRONMENT intentionally omitted' > "$quoted_file"

output=$(env -i PATH="$PATH" POMI_SENTRY_ENV_FILE="$quoted_file" "$runner" --check)
assert_contains "$output" 'Sentry configuration: valid'
assert_contains "$output" 'SENTRY_ENVIRONMENT=production'
assert_not_contains "$output" 'sentinel-private-key'
assert_command_env "$quoted_file" 'file-org' 'production'

crlf_file="$test_dir/crlf.env"
printf 'SENTRY_AUTH_TOKEN=file-token\r\nSENTRY_ORG=crlf-org\r\nSENTRY_FRONTEND_PROJECT=frontend-project\r\nSENTRY_BACKEND_PROJECT=backend-project\r\nSENTRY_ENVIRONMENT=production\r\n' > "$crlf_file"
assert_command_env "$crlf_file" 'crlf-org' 'production'

assert_command_env "$crlf_file" 'crlf-org' 'production' env \
  SENTRY_AUTH_TOKEN=stale-token \
  SENTRY_ORG=stale-org \
  SENTRY_FRONTEND_PROJECT=stale-frontend \
  SENTRY_BACKEND_PROJECT=stale-backend \
  SENTRY_ENVIRONMENT=stale-environment

assert_command_env "$quoted_file" 'file-org' 'staging' env \
  SENTRY_ORG=stale-org \
  SENTRY_ENVIRONMENT=staging

missing_file="$test_dir/missing.env"
printf '%s\n' \
  'SENTRY_AUTH_TOKEN=file-token' \
  'SENTRY_ORG=file-org' \
  'SENTRY_FRONTEND_PROJECT=frontend-project' > "$missing_file"
assert_command_env "$missing_file" 'file-org' 'production' env \
  SENTRY_BACKEND_PROJECT=backend-project
if env -i PATH="$PATH" POMI_SENTRY_ENV_FILE="$missing_file" "$runner" --check > "$test_dir/missing.out" 2>&1; then
  echo 'Expected missing configuration to fail.' >&2
  exit 1
fi
assert_contains "$(cat "$test_dir/missing.out")" 'SENTRY_BACKEND_PROJECT'

echo 'Pomi Sentry environment tests passed.'
