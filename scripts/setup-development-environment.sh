#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_STATE_FILE="$ROOT_DIR/.pomi/install-inputs.sha"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/worktree-lib.sh"
# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/node-env.sh"

pomi_use_node_version "$ROOT_DIR"

require_worktree=false

for arg in "$@"; do
  case "$arg" in
    --require-worktree)
      require_worktree=true
      ;;
    *)
      echo "[pomi] unsupported setup option: $arg" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"

pomi_hash_install_input() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256
    return
  fi

  cksum
}

pomi_current_install_fingerprint() {
  (
    cd "$ROOT_DIR"
    while IFS= read -r rel; do
      [[ -n "$rel" && -f "$rel" ]] || continue

      printf 'path:%s\n' "$rel"
      if [[ "$rel" == "package.json" || "$rel" == packages/*/package.json ]]; then
        pomi_package_install_fingerprint "$rel"
      else
        cat "$rel"
      fi
      printf '\n'
    done < <(pomi_dependency_files_for_root "$ROOT_DIR" | sort)
  ) | pomi_hash_install_input | awk '{ print $1 }'
}

install_inputs_hash="$(pomi_current_install_fingerprint)"

pomi_install_is_current() {
  [[ -f "$ROOT_DIR/node_modules/.modules.yaml" ]] &&
    [[ -f "$INSTALL_STATE_FILE" ]] &&
    [[ "$(cat "$INSTALL_STATE_FILE")" == "$install_inputs_hash" ]]
}

pomi_mark_install_current() {
  mkdir -p "$(dirname "$INSTALL_STATE_FILE")"
  printf '%s\n' "$install_inputs_hash" >"$INSTALL_STATE_FILE"
}

install_args=(install --frozen-lockfile)
main_store_dir=""

if pomi_is_linked_worktree; then
  main_worktree="$(pomi_main_worktree)"
  mismatches="$(pomi_dependency_mismatches "$ROOT_DIR" "$main_worktree" || true)"

  if [[ -z "$mismatches" ]]; then
    install_args+=(--prefer-offline)

    main_store_dir="$(pomi_node_modules_store_dir "$main_worktree" || true)"
    if [[ -n "$main_store_dir" && -d "$main_store_dir" ]]; then
      install_args+=(--store-dir "$main_store_dir")
      echo "[pomi] reusing the primary worktree's pnpm content-addressable store."
    fi

    if pomi_install_is_current; then
      echo "[pomi] install inputs match main worktree and are current; existing node_modules is ready."
      exit 0
    fi

    echo "[pomi] install inputs match main worktree; laying out pnpm links from cache."
  else
    echo "[pomi] install inputs differ from main worktree; running isolated install."
    printf '%s\n' "$mismatches" | sed 's/^/[pomi] changed dependency file: /'
  fi
elif [[ "$require_worktree" == "true" ]]; then
  pomi_require_linked_worktree "$ROOT_DIR"
elif pomi_install_is_current; then
  echo "[pomi] install inputs are current; existing node_modules is ready."
  exit 0
fi

if [[ -n "$main_store_dir" ]]; then
  if ! pnpm "${install_args[@]}"; then
    echo "[pomi] primary pnpm store is unavailable; retrying with a worktree-local store." >&2
    CI=1 pnpm install \
      --frozen-lockfile \
      --prefer-offline \
      --store-dir "$ROOT_DIR/.pnpm-store"
  fi
else
  pnpm "${install_args[@]}"
fi
pomi_mark_install_current
