#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/local-env.sh"
pomi_load_local_environment

cd "$ROOT_DIR"

APP_VERSION="$(node -p "require('./packages/frontend/package.json').version")"
FRONTEND_SENTRY_RELEASE="${VITE_SENTRY_RELEASE:-pomi-frontend@${RELEASE_TAG:-$(node -p "require('./packages/frontend/package.json').version")}}"

build_for_platform() {
  local platform="$1" target_dir="$2"

  docker run --rm --platform "$platform" \
    --env VITE_SENTRY_DSN \
    -v "$ROOT_DIR:/workspace" \
    --mount type=volume,destination=/workspace/.pnpm-store \
    --mount type=volume,destination=/workspace/node_modules \
    --mount type=volume,destination=/workspace/packages/backend/node_modules \
    --mount type=volume,destination=/workspace/packages/frontend/node_modules \
    --mount type=volume,destination=/workspace/packages/landing/node_modules \
    --mount type=volume,destination=/workspace/packages/shared/node_modules \
    -w /workspace \
    node:24-bookworm bash -lc "
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
  curl \
  ca-certificates \
  build-essential \
  pkg-config \
  libssl-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  file \
  libxdo-dev

curl https://sh.rustup.rs -sSf | sh -s -- -y
export PATH=\"\$HOME/.cargo/bin:\$PATH\"

npm i -g pnpm@9
pnpm install --frozen-lockfile --force
cd packages/frontend
CARGO_TARGET_DIR='$target_dir' VITE_DEBUG_PANEL_ENABLED=false VITE_SENTRY_RELEASE='$FRONTEND_SENTRY_RELEASE' VITE_RENDER_SYSTEM_TRAY_ICON=true pnpm tauri build --bundles deb
"
}

build_for_platform linux/amd64 /workspace/packages/frontend/src-tauri/target/linux-amd64

AMD64_DEB="packages/frontend/src-tauri/target/linux-amd64/release/bundle/deb/pomi_${APP_VERSION}_amd64.deb"

if [[ ! -f "$AMD64_DEB" ]]; then
  echo "Missing expected package: $AMD64_DEB" >&2
  exit 1
fi

echo "Linux packages ready:"
echo "- $AMD64_DEB"
