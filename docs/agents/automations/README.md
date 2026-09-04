# Radar automation prompt backups

These files are the version-controlled recovery copies of the six Codex Radar
automations: three planning parents and three implementation children. The
Codex automation records remain the runtime schedules; when a prompt changes,
update its matching file here in the same change.

The shared runtime safety contract is `GLOBAL.md`, reinforced by the
Scheduled Automation Contract section in the repository root `AGENTS.md`.
Every scheduled prompt reads both before lifecycle work, repository research,
external mutation, or file writing. Track prompts contain only their
track-specific scope and workflow additions.

Prompt synchronization is manual in both directions. Editing a prompt in this
repository does not update the installed Codex automation, and editing an
installed automation does not update its Markdown backup. Before handing a
prompt change off for merge, update the matching installed automation directly,
then verify that its complete runtime prompt exactly matches the backup while
its schedule, model, execution environment, worktree, status, and notification
settings remain unchanged. Do not attach the secret-bearing automation profile
as a Codex task environment; the repository's Node loaders resolve it only when
the App-authentication or Sentry wrapper needs it.
Run `node scripts/verify-automation-prompt-sync.mjs` for that exact six-prompt
comparison.

Each backup records the stable automation ID, cadence, parent/child relationship,
dedicated branch, and complete runtime prompt. Every parent runs one hour before
its child and hands off through the canonical GitHub issue state. Machine-local
project IDs and worktree paths remain in Codex and are intentionally not
required to restore the prompt text.

Every runtime prompt must acquire the durable per-worktree lock before branch
synchronization and release it on every successful exit. The lock helper and
its recovery procedure are defined in `GLOBAL.md` and covered by the operations
tests.

Planning parents currently use `gpt-5.6-sol` with high reasoning. Child model
and reasoning settings remain track-specific in the installed records.
Activation is controlled by the Codex automation records; every run must still
pass its App and track preflight gates.

## Worktree ownership

Each run has one mutable worktree owner. A parent and its implementation child
may share a path when the automation contract explicitly defines a sequential
handoff and the expected run duration fits the cadence gap. The Feature/Bug,
Performance, and Security pipelines use a one-hour parent-to-child offset for
that handoff; it is not a general lock for unrelated or overlapping runs. If a
run is still active when its child window begins, stop before concurrent
mutation and report the overlap. Before reactivating a schedule, verify its
runtime worktree assignment and the intended cadence.

Never use a same-directory or shared-environment fork for a coding or
file-writing subagent. Writer subagents use separate git worktrees and
branches. Read-only subagents must be explicitly labeled, have no
file-writing side effects, and stop after analysis. A broad diff from one
logical batch does not require local checkpoints; isolation and single-writer
ownership are the recovery boundaries.

| Planning parent                        | Implementation child                  | Parent cadence | Child cadence |
| -------------------------------------- | ------------------------------------- | -------------- | ------------- |
| `pomi-parent-feature-and-bug-planning` | `pomi-daily-feature-and-bug-requests` | 00:30, 11:30   | 01:30, 12:30  |
| `pomi-parent-performance-planning`     | `pomi-daily-performance-ideas`        | 00:15, 11:15   | 01:15, 12:15  |
| `pomi-parent-security-planning`        | `pomi-daily-security-ideas`           | 00:00, 11:00   | 01:00, 12:00  |
