#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_ENV_FILE="$ROOT_DIR/packages/frontend/.env"
ANDROID_DIR="$ROOT_DIR/packages/frontend/src-tauri/gen/android"
WATCH_APK="$ANDROID_DIR/wear/build/outputs/apk/debug/wear-debug.apk"

warn() {
  echo "[pomi] watch deployment warning: $*" >&2
}

save_watch_address() {
  local address="$1"
  local source_file="/dev/null"
  local temp_file

  if ! temp_file="$(mktemp "${FRONTEND_ENV_FILE}.tmp.XXXXXX")"; then
    warn "could not create a temporary file for $FRONTEND_ENV_FILE."
    return 1
  fi

  if [[ -f "$FRONTEND_ENV_FILE" ]]; then
    if ! cp -p "$FRONTEND_ENV_FILE" "$temp_file"; then
      rm -f "$temp_file"
      warn "could not prepare $FRONTEND_ENV_FILE for update."
      return 1
    fi
    source_file="$FRONTEND_ENV_FILE"
  fi

  if ! awk -v address="$address" '
    BEGIN { updated = 0 }
    /^POMI_WATCH_ADB_ADDRESS=/ {
      if (!updated) {
        print "POMI_WATCH_ADB_ADDRESS=" address
        updated = 1
      }
      next
    }
    { print }
    END {
      if (!updated) {
        print "POMI_WATCH_ADB_ADDRESS=" address
      }
    }
  ' "$source_file" > "$temp_file"; then
    rm -f "$temp_file"
    warn "could not update $FRONTEND_ENV_FILE."
    return 1
  fi

  if ! mv "$temp_file" "$FRONTEND_ENV_FILE"; then
    rm -f "$temp_file"
    warn "could not replace $FRONTEND_ENV_FILE."
    return 1
  fi
}

read_saved_watch_address() {
  local value

  if [[ -f "$FRONTEND_ENV_FILE" ]]; then
    value="$(sed -n 's/^POMI_WATCH_ADB_ADDRESS=//p' "$FRONTEND_ENV_FILE" | tail -n 1)"
    value="${value%$'\r'}"
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
  else
    value=""
  fi

  printf '%s' "$value"
}

read_watch_address() {
  if [[ -n "${POMI_WATCH_ADB_ADDRESS+x}" ]]; then
    printf '%s' "$POMI_WATCH_ADB_ADDRESS"
  else
    read_saved_watch_address
  fi
}

is_valid_watch_address() {
  local address="$1"
  local host port octet

  [[ "$address" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}:([0-9]{1,5})$ ]] || return 1

  host="${address%:*}"
  port="${address##*:}"
  ((10#$port >= 1 && 10#$port <= 65535)) || return 1

  IFS='.' read -r -a octets <<< "$host"
  for octet in "${octets[@]}"; do
    ((10#$octet >= 0 && 10#$octet <= 255)) || return 1
  done
}

resolve_adb() {
  local candidate

  if command -v adb >/dev/null 2>&1; then
    command -v adb
    return 0
  fi

  for candidate in \
    "${ANDROID_HOME:-}/platform-tools/adb" \
    "${ANDROID_SDK_ROOT:-}/platform-tools/adb" \
    "$HOME/Library/Android/sdk/platform-tools/adb"; do
    if [[ -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  return 1
}

is_watch_connected() {
  local adb_bin="$1"
  local watch_address="$2"

  [[ "$("$adb_bin" -s "$watch_address" get-state 2>/dev/null)" == "device" ]]
}

connect_watch() {
  local adb_bin="$1"
  local watch_address="$2"

  "$adb_bin" connect "$watch_address" || true
  is_watch_connected "$adb_bin" "$watch_address"
}

repair_watch_connection() {
  local adb_bin="$1"
  local watch_address="$2"

  echo "[pomi] connection failed; restarting ADB and retrying..."
  "$adb_bin" disconnect "$watch_address" >/dev/null 2>&1 || true
  "$adb_bin" kill-server >/dev/null 2>&1 || true
  "$adb_bin" start-server >/dev/null 2>&1 || true
  connect_watch "$adb_bin" "$watch_address" || return 1
  wait_for_watch "$adb_bin" "$watch_address"
}

wait_for_watch() {
  local adb_bin="$1"
  local watch_address="$2"
  local attempt

  for attempt in {1..10}; do
    if is_watch_connected "$adb_bin" "$watch_address"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

verify_watch_target() {
  local adb_bin="$1"
  local watch_address="$2"
  local state model

  state="$("$adb_bin" -s "$watch_address" get-state 2>/dev/null || true)"
  model="$("$adb_bin" -s "$watch_address" shell getprop ro.product.model 2>/dev/null || true)"
  if [[ "$state" != "device" || -z "$model" ]]; then
    return 1
  fi
  echo "[pomi] verified Wear OS target: $model at $watch_address."
}

print_recovery_guide() {
  local watch_address="$1"
  local watch_host="${watch_address%:*}"

  echo "[pomi] Wear OS recovery guide:"
  echo "  1. Open the watch's main Wireless debugging screen."
  echo "  2. Verify its current IP:MAIN_PORT. The attempted main address was $watch_address."
  echo "  3. Rerun: pnpm release:wear WATCH_IP:MAIN_PORT"
  echo "  4. Only if that verified main address still fails, open Pair new device."
  echo "  5. Run: adb pair $watch_host:PAIRING_PORT (use the separate pairing port and code)."
  echo "  6. Then reconnect with the main port: adb connect $watch_host:MAIN_PORT"
}

print_watch_diagnostics() {
  local adb_bin="$1"
  local watch_address="$2"
  local failed_command="$3"

  echo "[pomi] Wear OS diagnostics:"
  echo "  failed command: $failed_command"
  "$adb_bin" devices -l || true
  echo "  target state: $("$adb_bin" -s "$watch_address" get-state 2>&1 || true)"
  echo "  target model: $("$adb_bin" -s "$watch_address" shell getprop ro.product.model 2>&1 || true)"
}

main() {
  local adb_bin
  local saved_watch_address
  local watch_address

  if [[ "${1:-}" == "--" ]]; then
    shift
  fi

  if (( $# > 1 )); then
    warn "usage: pnpm release:wear [IP:PORT]"
    return 0
  fi

  watch_address="${1:-$(read_watch_address)}"

  if [[ -z "$watch_address" ]]; then
    echo "[pomi] watch deployment skipped: POMI_WATCH_ADB_ADDRESS is not set."
    return 0
  fi

  if ! is_valid_watch_address "$watch_address"; then
    warn "POMI_WATCH_ADB_ADDRESS must use IPv4:PORT format (received '$watch_address')."
    return 0
  fi

  if (( $# == 1 )); then
    saved_watch_address="$(read_saved_watch_address)"
    if [[ "$saved_watch_address" != "$watch_address" ]]; then
      if ! save_watch_address "$watch_address"; then
        return 0
      fi
      echo "[pomi] saved POMI_WATCH_ADB_ADDRESS=$watch_address to $FRONTEND_ENV_FILE."
    fi
  fi

  if ! adb_bin="$(resolve_adb)"; then
    warn "adb was not found in PATH, ANDROID_HOME, or ANDROID_SDK_ROOT."
    return 0
  fi

  echo "[pomi] connecting to Wear OS device at $watch_address..."
  if ! connect_watch "$adb_bin" "$watch_address" && ! repair_watch_connection "$adb_bin" "$watch_address"; then
    warn "$watch_address is not available as an ADB device after connecting."
    print_watch_diagnostics "$adb_bin" "$watch_address" "adb connect $watch_address"
    print_recovery_guide "$watch_address"
    return 0
  fi

  if ! wait_for_watch "$adb_bin" "$watch_address" || ! verify_watch_target "$adb_bin" "$watch_address"; then
    warn "$watch_address did not become a verified Wear OS target."
    print_watch_diagnostics "$adb_bin" "$watch_address" "adb -s $watch_address shell getprop ro.product.model"
    print_recovery_guide "$watch_address"
    return 0
  fi

  echo "[pomi] building Wear OS debug APK..."
  if ! (cd "$ANDROID_DIR" && ./gradlew :wear:assembleDebug); then
    warn "Wear OS APK build failed."
    return 0
  fi

  if [[ ! -f "$WATCH_APK" ]]; then
    warn "Wear OS APK was not created at $WATCH_APK."
    return 0
  fi

  echo "[pomi] installing Wear OS app on $watch_address..."
  if ! "$adb_bin" -s "$watch_address" install -r "$WATCH_APK"; then
    warn "normal Wear OS installation failed; refreshing the target transport."
    if repair_watch_connection "$adb_bin" "$watch_address" &&
      verify_watch_target "$adb_bin" "$watch_address" &&
      "$adb_bin" -s "$watch_address" install -r "$WATCH_APK"; then
      echo "[pomi] Wear OS app installed on $watch_address after transport recovery."
      return 0
    fi

    echo "[pomi] retrying Wear OS install without streaming..."
    if "$adb_bin" -s "$watch_address" install --no-streaming -r "$WATCH_APK"; then
      echo "[pomi] Wear OS app installed on $watch_address without streaming."
      return 0
    fi

    warn "Wear OS app installation failed after bounded recovery."
    print_watch_diagnostics "$adb_bin" "$watch_address" "adb -s $watch_address install --no-streaming -r $WATCH_APK"
    print_recovery_guide "$watch_address"
    return 0
  fi

  echo "[pomi] Wear OS app installed on $watch_address."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
