#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
check_only=false
temporary_directory=""

for arg in "$@"; do
  case "$arg" in
    --check-only)
      check_only=true
      ;;
    *)
      echo "[pomi] unsupported cleanup option: $arg" >&2
      exit 1
      ;;
  esac
done

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/worktree-lib.sh"

pomi_require_linked_worktree "$ROOT_DIR"
cd "$ROOT_DIR"

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/pomi-pr-cleanup.XXXXXX")"
trap 'rm -rf "$temporary_directory"' EXIT

gh pr view \
  --json number,state,isDraft,headRefName,headRefOid,statusCheckRollup,comments \
  >"$temporary_directory/pull-request.json"

repository="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
case "$repository" in
  */*)
    owner="${repository%%/*}"
    repo="${repository#*/}"
    ;;
  *)
    echo "[pomi] GitHub repository identity is invalid." >&2
    exit 1
    ;;
esac
if [[ ! "$owner" =~ ^[A-Za-z0-9_.-]+$ || ! "$repo" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "[pomi] GitHub repository identity is invalid." >&2
  exit 1
fi

pull_request_number="$(gh pr view --json number --jq .number)"
review_threads_query='query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          isResolved
          comments(first: 100) {
            pageInfo { hasNextPage }
            nodes { author { login } }
          }
        }
      }
    }
  }
}'
gh api graphql \
  -f "query=$review_threads_query" \
  -F "owner=$owner" \
  -F "repo=$repo" \
  -F "number=$pull_request_number" \
  >"$temporary_directory/review-threads.json"

node "$ROOT_DIR/scripts/cleanup-worktree-after-pr.mjs" \
  "$temporary_directory/pull-request.json" \
  "$temporary_directory/review-threads.json"

if [[ "$check_only" == "true" ]]; then
  echo "[pomi] completion verified; no worktree files were removed."
  exit 0
fi

pomi_remove_worktree_node_dependencies "$ROOT_DIR"
echo "[pomi] removed worktree Node dependencies and the local pnpm store."
