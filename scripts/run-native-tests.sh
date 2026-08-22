#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/local-env.sh"
pomi_load_local_environment

node --test "${ROOT_DIR}/scripts/watch-native-contract.test.mjs"

cd "${ROOT_DIR}/packages/frontend/src-tauri"
cargo fmt --check
cargo check
cargo test

cd "${ROOT_DIR}/packages/frontend/src-tauri/gen/android"
./gradlew --settings-file wear.settings.gradle :wear:testDebugUnitTest :wear:koverVerifyDebug :wear:koverXmlReportDebug
