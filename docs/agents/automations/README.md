# Radar automation prompt backups

These files are the version-controlled recovery copies of the six Codex Radar
automations: three planning parents and three implementation children. The
Codex automation records remain the runtime schedules; when a prompt changes,
update its matching file here in the same change.

Prompt synchronization is manual in both directions. Editing a prompt in this
repository does not update the installed Codex automation, and editing an
installed automation does not update its Markdown backup. Before handing a
prompt change off for merge, update the matching installed automation directly,
then verify that its complete runtime prompt exactly matches the backup while
its schedule, model, environment, and notification settings remain unchanged.

Each backup records the stable automation ID, cadence, parent/child relationship,
dedicated branch, and complete runtime prompt. Every parent runs one hour before
its child and hands off through the canonical GitHub issue state. Machine-local
project IDs and environment-file paths remain in Codex and are intentionally not
required to restore the prompt text.

Planning parents use `gpt-5.6-sol` with high reasoning. Implementation children
use `gpt-5.6-luna` with max reasoning. All six schedules remain paused until
their App and track preflight gates are green.

## Worktree ownership

Each run has one mutable worktree owner. Parent and child schedules must not
overlap in the same path unless the scheduler provides an explicit
non-overlap guarantee; the one-hour cadence offset is not a lock. Before
reactivating a schedule, verify its runtime worktree assignment and pause or
reconfigure any conflicting pair.

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
