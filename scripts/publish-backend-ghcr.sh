#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/local-env.sh"
pomi_load_local_environment

: "${GHCR_IMAGE:=ghcr.io/host-it-labs/pomi-backend}"
: "${GHCR_USERNAME:?Set GHCR_USERNAME in .env.local}"
: "${GHCR_TOKEN:?Set GHCR_TOKEN in .env.local}"

tag="${1:-latest}"
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
exec docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --file "$ROOT_DIR/packages/backend/Dockerfile" \
  --tag "$GHCR_IMAGE:$tag" \
  --push \
  "$ROOT_DIR"
