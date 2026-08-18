#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_VERSION="^2"
FRONTEND_SENTRY_RELEASE="${VITE_SENTRY_RELEASE:-pomi-frontend@${RELEASE_TAG:-$(node -p "require('./packages/frontend/package.json').version")}}"

cd "$ROOT_DIR"

docker run --rm --platform linux/arm64 \
  -v "$ROOT_DIR:/workspace" \
  -w /workspace \
  node:20-bookworm bash -lc "
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
cargo install tauri-cli --version \"$TAURI_VERSION\" --locked

cd packages/frontend
VITE_SENTRY_RELEASE='$FRONTEND_SENTRY_RELEASE' VITE_RENDER_SYSTEM_TRAY_ICON=true pnpm tauri build --bundles deb
"

ARM64_DEB="packages/frontend/src-tauri/target/release/bundle/deb/pomi_0.1.0_arm64.deb"

if [[ ! -f "$ARM64_DEB" ]]; then
  echo "Missing expected package: $ARM64_DEB" >&2
  exit 1
fi

echo "Linux ARM64 package ready:"
echo "- $ARM64_DEB"
