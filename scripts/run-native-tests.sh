#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}/packages/frontend/src-tauri"
cargo fmt --check
cargo check
cargo test

cd "${ROOT_DIR}/packages/frontend/src-tauri/gen/android"
./gradlew --settings-file wear.settings.gradle :wear:testDebugUnitTest :wear:koverVerifyDebug :wear:koverXmlReportDebug
