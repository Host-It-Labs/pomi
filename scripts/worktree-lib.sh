#!/usr/bin/env bash

pomi_realpath_dir() {
  cd "$1" && pwd -P
}

pomi_main_worktree() {
  local common_dir common_dir_abs
  common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  common_dir_abs="$(pomi_realpath_dir "$common_dir")" || return 1

  if [[ "$(basename "$common_dir_abs")" == ".git" ]]; then
    dirname "$common_dir_abs"
    return 0
  fi

  git worktree list --porcelain | awk '
    /^worktree / {
      if (!seen) {
        sub(/^worktree /, "")
        print
        seen = 1
      }
    }
  '
}

pomi_is_linked_worktree() {
  local git_dir git_common_dir git_dir_abs git_common_dir_abs

  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  git_dir="$(git rev-parse --git-dir 2>/dev/null)" || return 1
  git_common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  git_dir_abs="$(pomi_realpath_dir "$git_dir")" || return 1
  git_common_dir_abs="$(pomi_realpath_dir "$git_common_dir")" || return 1

  [[ "$git_dir_abs" != "$git_common_dir_abs" ]]
}

pomi_require_linked_worktree() {
  local root_dir main_worktree
  root_dir="$1"
  main_worktree="$(pomi_main_worktree)"

  if ! pomi_is_linked_worktree || [[ "$(pomi_realpath_dir "$root_dir")" == "$(pomi_realpath_dir "$main_worktree")" ]]; then
    echo "[pomi] this action must run from a secondary git worktree, not the main worktree." >&2
    echo "[pomi] main worktree: $main_worktree" >&2
    exit 1
  fi
}

pomi_dependency_files_for_root() {
  local root_dir
  root_dir="$1"

  (
    cd "$root_dir"
    [[ -e package.json ]] && printf '%s\n' package.json
    [[ -e package-lock.json ]] && printf '%s\n' package-lock.json
    [[ -e pnpm-lock.yaml ]] && printf '%s\n' pnpm-lock.yaml
    [[ -e pnpm-workspace.yaml ]] && printf '%s\n' pnpm-workspace.yaml
    if [[ -d packages ]]; then
      find packages -mindepth 2 -maxdepth 2 -name package.json -print
    fi
  )
}

pomi_dependency_files() {
  {
    pomi_dependency_files_for_root "$1"
    pomi_dependency_files_for_root "$2"
  } | sort -u
}

pomi_package_install_fingerprint() {
  local file_path
  file_path="$1"

  if ! command -v node >/dev/null 2>&1; then
    cat "$file_path"
    return 0
  fi

  node - "$file_path" <<'NODE'
const fs = require('node:fs');

const filePath = process.argv[2];
const packageJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const installKeys = [
  'packageManager',
  'engines',
  'workspaces',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'dependenciesMeta',
  'overrides',
  'resolutions',
  'pnpm',
  'os',
  'cpu',
  'libc',
];

const stable = value => {
  if (Array.isArray(value)) {
    return value.map(stable);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)])
    );
  }

  return value;
};

const fingerprint = {};

for (const key of installKeys) {
  if (packageJson[key] !== undefined) {
    fingerprint[key] = stable(packageJson[key]);
  }
}

process.stdout.write(JSON.stringify(stable(fingerprint)));
NODE
}

pomi_dependency_file_matches() {
  local current_file main_file rel
  current_file="$1"
  main_file="$2"
  rel="$3"

  if [[ "$rel" == "package.json" || "$rel" == packages/*/package.json ]]; then
    [[ "$(pomi_package_install_fingerprint "$current_file")" == "$(pomi_package_install_fingerprint "$main_file")" ]]
    return
  fi

  cmp -s "$current_file" "$main_file"
}

pomi_dependency_mismatches() {
  local current_root main_root rel current_file main_file mismatches=0
  current_root="$1"
  main_root="$2"

  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    current_file="$current_root/$rel"
    main_file="$main_root/$rel"

    if [[ ! -e "$current_file" || ! -e "$main_file" ]]; then
      printf '%s\n' "$rel"
      mismatches=1
      continue
    fi

    if ! pomi_dependency_file_matches "$current_file" "$main_file" "$rel"; then
      printf '%s\n' "$rel"
      mismatches=1
    fi
  done < <(pomi_dependency_files "$current_root" "$main_root")

  return "$mismatches"
}

pomi_node_modules_store_dir() {
  local root_dir modules_file
  root_dir="$1"
  modules_file="$root_dir/node_modules/.modules.yaml"

  [[ -f "$modules_file" ]] || return 1

  node - "$modules_file" <<'NODE'
const fs = require('node:fs');

const modulesFile = process.argv[2];
let modules;

try {
  modules = JSON.parse(fs.readFileSync(modulesFile, 'utf8'));
} catch {
  process.exit(1);
}

if (typeof modules.storeDir !== 'string' || modules.storeDir.length === 0) {
  process.exit(1);
}

process.stdout.write(modules.storeDir);
NODE
}

pomi_cargo_input_files_for_root() {
  local root_dir
  root_dir="$1"

  (
    cd "$root_dir" || return 1
    [[ -f packages/frontend/src-tauri/Cargo.lock ]] &&
      printf '%s\n' packages/frontend/src-tauri/Cargo.lock
    find packages/frontend/src-tauri \
      -path packages/frontend/src-tauri/target -prune -o \
      -type f -name Cargo.toml -print 2>/dev/null | sort
  )
}

pomi_cargo_inputs_match() {
  local current_root main_root rel
  current_root="$1"
  main_root="$2"

  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    if [[ ! -f "$current_root/$rel" || ! -f "$main_root/$rel" ]] ||
      ! cmp -s "$current_root/$rel" "$main_root/$rel"; then
      return 1
    fi
  done < <(
    {
      pomi_cargo_input_files_for_root "$current_root"
      pomi_cargo_input_files_for_root "$main_root"
    } | sort -u
  )
}

pomi_remove_worktree_local_cargo_artifacts() {
  local debug_dir
  debug_dir="$1"

  rm -f \
    "$debug_dir/pomi" \
    "$debug_dir/pomi.d" \
    "$debug_dir/libpomi_lib.d" \
    "$debug_dir/libpomi_lib.rlib"
  rm -rf "$debug_dir/incremental"

  find "$debug_dir/.fingerprint" -mindepth 1 -maxdepth 1 -type d \
    \( -name 'pomi-*' -o -name 'tauri-plugin-notifications-*' \) \
    -exec rm -rf {} + 2>/dev/null || true
  find "$debug_dir/build" -mindepth 1 -maxdepth 1 -type d \
    \( -name 'pomi-*' -o -name 'tauri-plugin-notifications-*' \) \
    -exec rm -rf {} + 2>/dev/null || true
  find "$debug_dir/deps" -mindepth 1 -maxdepth 1 \
    \( -name 'pomi*' -o -name 'libpomi*' -o -name 'tauri_plugin_notifications*' -o -name 'libtauri_plugin_notifications*' \) \
    -exec rm -rf {} + 2>/dev/null || true
}

pomi_seed_worktree_cargo_cache() {
  local current_root main_root current_target main_target source_debug
  current_root="$1"
  main_root="$2"
  current_target="$current_root/packages/frontend/src-tauri/target"
  main_target="$main_root/packages/frontend/src-tauri/target"
  source_debug="$main_target/debug"

  if [[ -d "$current_target/debug" ]]; then
    return 0
  fi

  if [[ ! -d "$source_debug" ]]; then
    echo "[pomi] primary worktree has no Cargo debug cache; Rust dependencies will compile normally."
    return 0
  fi

  if ! pomi_cargo_inputs_match "$current_root" "$main_root"; then
    echo "[pomi] Cargo inputs differ from the primary worktree; Rust dependencies will compile in isolation."
    return 0
  fi

  mkdir -p "$current_target"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "[pomi] copy-on-write Cargo cache seeding is only enabled on macOS."
    return 0
  fi

  echo "[pomi] seeding an isolated Cargo debug cache from the primary worktree."
  if ! cp -cR "$source_debug" "$current_target/"; then
    rm -rf "$current_target/debug"
    echo "[pomi] Cargo cache seeding failed; Rust dependencies will compile normally." >&2
    return 0
  fi

  if [[ -f "$main_target/.rustc_info.json" ]]; then
    cp -c "$main_target/.rustc_info.json" "$current_target/.rustc_info.json"
  fi
  pomi_remove_worktree_local_cargo_artifacts "$current_target/debug"
  echo "[pomi] Cargo dependency cache ready; worktree-local app artifacts will rebuild independently."
}

pomi_worktree_hash() {
  local root_dir
  root_dir="$1"

  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$root_dir" | shasum -a 1 | awk '{ print substr($1, 1, 8) }'
    return 0
  fi

  printf '%s' "$root_dir" | cksum | awk '{ print $1 }'
}

pomi_worktree_slug() {
  basename "$1" |
    tr '[:upper:]' '[:lower:]' |
    sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' |
    cut -c 1-24
}

pomi_slugify() {
  tr '[:upper:]' '[:lower:]' |
    sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

pomi_worktree_context_slug() {
  local root_dir parent leaf context
  root_dir="$1"

  parent="$(basename "$(dirname "$root_dir")")"
  leaf="$(basename "$root_dir")"
  context="$(printf '%s-%s' "$parent" "$leaf" | pomi_slugify | cut -c 1-32)"

  if [[ -z "$context" ]]; then
    context="worktree"
  fi

  printf '%s\n' "$context"
}

pomi_branch_worktree_id() {
  local root_dir branch hash
  root_dir="$1"
  branch="$(git -C "$root_dir" branch --show-current 2>/dev/null || true)"
  branch="$(printf '%s' "$branch" | pomi_slugify | cut -c 1-32)"

  if [[ -z "$branch" ]]; then
    return 0
  fi

  hash="$(pomi_worktree_hash "$root_dir")"
  printf '%s-%s\n' "$branch" "$hash"
}

pomi_legacy_worktree_id() {
  local root_dir slug hash
  root_dir="$1"
  slug="$(pomi_worktree_slug "$root_dir")"
  hash="$(pomi_worktree_hash "$root_dir")"

  if [[ -z "$slug" ]]; then
    slug="worktree"
  fi

  printf '%s-%s\n' "$slug" "$hash"
}

pomi_worktree_id() {
  local root_dir slug hash
  root_dir="$1"
  slug="$(pomi_worktree_context_slug "$root_dir")"
  hash="$(pomi_worktree_hash "$root_dir")"

  if [[ -z "$slug" ]]; then
    slug="worktree"
  fi

  printf '%s-%s\n' "$slug" "$hash"
}
