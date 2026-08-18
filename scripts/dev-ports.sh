#!/usr/bin/env sh

pomi_read_env_file_value() {
  file_path="$1"
  key="$2"

  [ -f "$file_path" ] || return 1

  value="$(awk -F '=' -v key="$key" '$1 == key { print substr($0, length($1) + 2) }' "$file_path" | tail -n 1 || true)"

  [ -n "$value" ] || return 1

  case "$value" in
    \"*\")
      value="${value#\"}"
      value="${value%\"}"
      ;;
    \'*\')
      value="${value#\'}"
      value="${value%\'}"
      ;;
  esac

  printf '%s\n' "$value"
}

pomi_read_numeric_env_file_value() {
  value="$(pomi_read_env_file_value "$1" "$2" || true)"

  case "$value" in
    ''|*[!0-9]*)
      return 1
      ;;
  esac

  if [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    return 1
  fi

  printf '%s\n' "$value"
}

pomi_export_numeric_env_file_value() {
  file_path="$1"
  key="$2"
  value="$(pomi_read_numeric_env_file_value "$file_path" "$key" || true)"

  [ -n "$value" ] || return 0

  export "${key}=${value}"
}