#!/usr/bin/env bash
set -euo pipefail

attach=false

for arg in "$@"; do
  case "$arg" in
    --attach)
      attach=true
      ;;
    *)
      echo "[pomi] unsupported release tmux option: $arg" >&2
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${POMI_RELEASE_TMUX_SESSION:-pomi-release}"

cd "$ROOT_DIR"

if ! command -v tmux >/dev/null 2>&1; then
  echo "[pomi] tmux is required for separated release terminals." >&2
  echo "[pomi] run without tmux with: pnpm run release:all:parallel" >&2
  exit 1
fi

tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

tmux new-session -d -s "$SESSION_NAME" -n 'release' -c "$ROOT_DIR"
docker_pane="$(tmux display-message -p -t "$SESSION_NAME":release '#{pane_id}')"
android_pane="$(tmux split-window -h -P -F '#{pane_id}' -t "$docker_pane" -c "$ROOT_DIR")"
macos_pane="$(tmux split-window -h -P -F '#{pane_id}' -t "$android_pane" -c "$ROOT_DIR")"

tmux set-option -t "$SESSION_NAME" mouse on >/dev/null
tmux set-option -t "$SESSION_NAME" pane-border-status top >/dev/null
tmux select-layout -t "$SESSION_NAME":release even-horizontal >/dev/null

tmux select-pane -t "$docker_pane" -T 'release:docker'
tmux select-pane -t "$android_pane" -T 'release:android'
tmux select-pane -t "$macos_pane" -T 'release:macos'

tmux send-keys -t "$docker_pane" "pnpm run release:docker" C-m
tmux send-keys -t "$android_pane" "pnpm run release:android" C-m
tmux send-keys -t "$macos_pane" "pnpm run release:macos" C-m

tmux select-pane -t "$docker_pane"
tmux select-window -t "$SESSION_NAME":release

if [[ "$attach" == "true" ]]; then
  if [[ -n "${TMUX:-}" ]]; then
    tmux switch-client -t "$SESSION_NAME"
  else
    exec tmux attach-session -t "$SESSION_NAME"
  fi
fi

echo "[pomi] release tmux session ready: $SESSION_NAME"
echo "[pomi] attach with: tmux attach -t $SESSION_NAME"
