#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/packages/frontend/src-tauri/gen/android"
adb_command="${ANDROID_HOME:+$ANDROID_HOME/platform-tools/}adb"

if [[ "$("$adb_command" shell getprop ro.kernel.qemu | tr -d '\r')" != "1" ]]; then
  echo 'Android session tests require one running emulator (or ANDROID_SERIAL selecting it).' >&2
  exit 1
fi

boot_deadline=$((SECONDS + 120))
while [[ "$("$adb_command" shell getprop sys.boot_completed | tr -d '\r')" != "1" ]]; do
  if (( SECONDS >= boot_deadline )); then
    echo 'Android emulator did not finish booting within 120 seconds.' >&2
    exit 1
  fi
  sleep 1
done

abi="$("$adb_command" shell getprop ro.product.cpu.abi | tr -d '\r')"
case "$abi" in
  arm64-v8a) flavor=arm64; gradle_flavor=Arm64 ;;
  x86_64) flavor=x86_64; gradle_flavor=X86_64 ;;
  *) echo "Unsupported emulator ABI: $abi" >&2; exit 1 ;;
esac

if [[ ! -f "$ANDROID_DIR/app/src/main/jniLibs/$abi/libpomi_lib.so" ]]; then
  echo "Build the Tauri release library for $abi before running session tests." >&2
  exit 1
fi

# Reuse the release library built by Tauri; instrumentation exercises the real
# Android Keystore without needing a second Rust build for the debug test APK.
cd "$ANDROID_DIR"
./gradlew ":app:assemble${gradle_flavor}Debug" ":app:assemble${gradle_flavor}DebugAndroidTest" \
  -x ":app:rustBuild${gradle_flavor}Debug" --console=plain
"$adb_command" install -r "app/build/outputs/apk/$flavor/debug/app-$flavor-debug.apk"
"$adb_command" install -r "app/build/outputs/apk/androidTest/$flavor/debug/app-$flavor-debug-androidTest.apk"

result_file="$(mktemp)"
trap 'rm -f "$result_file"' EXIT

run_test() {
  local method="$1"
  shift
  "$adb_command" shell am instrument -w \
    -e class "app.pomi.community.AndroidRefreshTokenVaultTest#$method" \
    "$@" app.pomi.community.test/androidx.test.runner.AndroidJUnitRunner | tee "$result_file"
  # am instrument may exit zero even when an assertion or runner fails.
  if ! grep -q '^OK (1 test)' "$result_file"; then
    echo "Android session test failed: $method" >&2
    exit 1
  fi
}

run_test restoresRotatesAndDeletesCredentialsAcrossVaultInstances
run_test survivesProcessRestart -e restartPhase write
"$adb_command" shell am force-stop app.pomi.community
run_test survivesProcessRestart -e restartPhase read
