#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/local-env.sh"
pomi_load_local_environment

: "${GHCR_IMAGE:=ghcr.io/host-it-labs/pomi-backend}"
: "${POMI_DOCKER_BUILDER:=pomi-release-builder}"
tag="${1:-local-check}"

exec docker buildx build \
  --builder "$POMI_DOCKER_BUILDER" \
  --platform linux/amd64,linux/arm64 \
  --file "$ROOT_DIR/packages/backend/Dockerfile" \
  --tag "$GHCR_IMAGE:$tag" \
  --output type=cacheonly \
  "$ROOT_DIR"
