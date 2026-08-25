#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/local-env.sh"
pomi_load_release_environment

cd "$ROOT_DIR"

APP_VERSION="$(node -p "require('./packages/frontend/package.json').version")"
FRONTEND_SENTRY_RELEASE="${VITE_SENTRY_RELEASE:-pomi-frontend@${RELEASE_TAG:-$(node -p "require('./packages/frontend/package.json').version")}}"

build_for_platform() {
  local platform="$1" target_dir="$2"

  docker run --rm --platform "$platform" \
    --env "VITE_BACKEND_URL=${VITE_BACKEND_URL:-}" \
    --env "VITE_USE_HTTPS=${VITE_USE_HTTPS:-}" \
    --env "VITE_RENDER_SYSTEM_TRAY_ICON=${VITE_RENDER_SYSTEM_TRAY_ICON:-}" \
    --env "VITE_DEBUG_PANEL_ENABLED=${VITE_DEBUG_PANEL_ENABLED:-}" \
    --env "VITE_PROD=${VITE_PROD:-}" \
    --env "VITE_ANDROID_BACKEND_URL=${VITE_ANDROID_BACKEND_URL:-}" \
    --env "VITE_SENTRY_DSN=${VITE_SENTRY_DSN:-}" \
    --env "VITE_SENTRY_RELEASE=${VITE_SENTRY_RELEASE:-}" \
    -v "$ROOT_DIR:/workspace" \
    --mount type=volume,destination=/workspace/.pnpm-store \
    --mount type=volume,destination=/workspace/node_modules \
    --mount type=volume,destination=/workspace/packages/backend/node_modules \
    --mount type=volume,destination=/workspace/packages/frontend/node_modules \
    --mount type=volume,destination=/workspace/packages/landing/node_modules \
    --mount type=volume,destination=/workspace/packages/shared/node_modules \
    -w /workspace \
    node:26-bookworm bash -lc "
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

npm install --global corepack@0.35.0
corepack enable pnpm
corepack install --global pnpm@11.23.0
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
