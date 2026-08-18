#!/usr/bin/env bash
set -euo pipefail

attach=false

for arg in "$@"; do
  case "$arg" in
    --attach)
      attach=true
      ;;
    *)
      echo "[pomi] unsupported tmux option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ -n "${POMI_PROJECT_DIR:-}" ]]; then
  PROJECT_DIR="$POMI_PROJECT_DIR"
else
  PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"
fi
SESSION_NAME="${POMI_TMUX_SESSION:-pomi-dev}"
COMPOSE_PROJECT="${POMI_COMPOSE_PROJECT:-pomi}"
BACKEND_COMMAND="${POMI_TMUX_BACKEND_COMMAND:-pnpm run docker:dev}"
FRONTEND_COMMAND="${POMI_TMUX_FRONTEND_COMMAND:-./scripts/start-project-frontend.sh}"
NATIVE_COMMAND="${POMI_TMUX_NATIVE_COMMAND:-}"
SHELL_COMMAND="${POMI_TMUX_SHELL_COMMAND:-}"
TMUX_COMMAND_SHELL="${SHELL:-/bin/zsh}"

cd "$PROJECT_DIR"

# shellcheck disable=SC1091
. "$PROJECT_DIR/scripts/node-env.sh"
pomi_use_node_version "$PROJECT_DIR"
pnpm --filter @pomi/shared build

if [[ "${POMI_TMUX_SKIP_COMPOSE_STOP:-false}" != "true" ]]; then
  docker compose -f packages/backend/docker-compose.dev.yml -p "$COMPOSE_PROJECT" stop >/dev/null 2>&1 || true
fi

tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

tmux new-session -d -s "$SESSION_NAME" -n 'dev' -c "$PROJECT_DIR"
backend_pane="$(tmux display-message -p -t "$SESSION_NAME":dev '#{pane_id}')"
frontend_pane="$(tmux split-window -h -P -F '#{pane_id}' -t "$backend_pane" -c "$PROJECT_DIR")"
if [[ -n "$NATIVE_COMMAND" ]]; then
  shell_pane="$(tmux split-window -v -P -F '#{pane_id}' -t "$backend_pane" -c "$PROJECT_DIR")"
  native_pane="$(tmux split-window -v -P -F '#{pane_id}' -t "$frontend_pane" -c "$PROJECT_DIR")"
else
  shell_pane="$(tmux split-window -h -P -F '#{pane_id}' -t "$frontend_pane" -c "$PROJECT_DIR")"
fi

tmux set-option -t "$SESSION_NAME" mouse on >/dev/null
if [[ -n "$NATIVE_COMMAND" ]]; then
  tmux select-layout -t "$SESSION_NAME":dev tiled >/dev/null
else
  tmux select-layout -t "$SESSION_NAME":dev even-horizontal >/dev/null
fi
tmux select-pane -t "$backend_pane" -T 'backend'
tmux select-pane -t "$frontend_pane" -T 'frontend'
tmux select-pane -t "$shell_pane" -T 'shell'
if [[ -n "$NATIVE_COMMAND" ]]; then
  tmux select-pane -t "$native_pane" -T 'native'
fi

printf -v node_env_path_q '%q' "$PROJECT_DIR/scripts/node-env.sh"
printf -v project_dir_q '%q' "$PROJECT_DIR"
NODE_SETUP_COMMAND=". ${node_env_path_q} && pomi_use_node_version ${project_dir_q}"

run_tmux_command() {
  local pane="$1"
  local command="$2"

  tmux respawn-pane -k -t "$pane" -c "$PROJECT_DIR" "$TMUX_COMMAND_SHELL" -lc "$command; exit_code=\$?; if [[ \$exit_code -ne 0 ]]; then echo \"[pomi] command exited with status \$exit_code\"; fi; exec \"$TMUX_COMMAND_SHELL\" -l"
}

run_tmux_command "$backend_pane" "$NODE_SETUP_COMMAND && $BACKEND_COMMAND"
run_tmux_command "$frontend_pane" "$NODE_SETUP_COMMAND && $FRONTEND_COMMAND"
if [[ -n "$NATIVE_COMMAND" ]]; then
  run_tmux_command "$native_pane" "$NODE_SETUP_COMMAND && $NATIVE_COMMAND"
fi

if [[ -n "$SHELL_COMMAND" ]]; then
  run_tmux_command "$shell_pane" "$NODE_SETUP_COMMAND && $SHELL_COMMAND"
else
  run_tmux_command "$shell_pane" "$NODE_SETUP_COMMAND && echo \"[pomi] node: \$(node -v)\" && exec \"$TMUX_COMMAND_SHELL\" -l"
fi

tmux select-pane -t "$shell_pane"
tmux select-window -t "$SESSION_NAME":dev

if [[ "$attach" == "true" ]]; then
  if [[ -n "${TMUX:-}" ]]; then
    tmux switch-client -t "$SESSION_NAME"
  else
    exec tmux attach-session -t "$SESSION_NAME"
  fi
fi

echo "[pomi] tmux session ready: $SESSION_NAME"
echo "[pomi] attach with: tmux attach -t $SESSION_NAME"
