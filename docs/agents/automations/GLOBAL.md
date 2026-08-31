# Pomi scheduled automation contract

This is the shared safety contract for all six Pomi Radar scheduled
automations: the Feature/Bug, Performance, and Security planning parents and
implementation children. Every scheduled prompt must read `AGENTS.md` and this
file before lifecycle work, repository research, external mutation, or file
writing. Track-specific prompts may add scope and workflow requirements, but
must not weaken this contract.

## Worktree ownership and handoff

- Work only in the dedicated worktree and branch named by the track-specific
  prompt.
- Before lifecycle work, research, delegation, synchronization, or writing,
  capture `pwd -P`, the exact branch, complete
  `git status --porcelain --untracked-files=all`, and
  `git worktree list --porcelain`. Ignore only macOS `.DS_Store` entries.
- A wrong path or branch, or any other dirty entry, is a hard stop. Preserve
  the checkout and do not switch branches, stash, reset, clean, checkout,
  commit, delegate, or run generators to repair it implicitly.
- Each Radar parent and its implementation child intentionally share their
  track's worktree and branch in sequence. Their one-hour parent-to-child
  cadence gap is the handoff and non-overlap contract. Identical runtime
  worktree or branch metadata is not, by itself, a configuration blocker.
- If a run is still active when its child window begins, stop before concurrent
  mutation and report the actual overlap. Do not use a same-directory or
  shared-environment fork for a coding or file-writing subagent. Writer
  subagents need separate worktrees and branches; read-only subagents must be
  explicitly labeled and have no file-writing side effects.

## Synchronization, credentials, and external writes

- Use the dedicated `config/pomi-automation.env` profile. Never load
  `.env.local`, enumerate or print secret values, or fall back to a personal
  GitHub token or identity.
- Run every GitHub-facing `git`, `gh`, and Radar lifecycle command through
  `node scripts/github-app-auth.mjs exec -- ...`, and stop before GitHub
  interaction if authentication does not resolve to `pomi-radar[bot]`.
- Synchronize through the App helper without writing the shared `FETCH_HEAD`.
  Fast-forward a branch that is behind its remote; merge `origin/main` only
  through the helper when required; stop on divergence or conflict. Never
  discard commits or silently repair a checkout.
- Parents plan and hand off through canonical GitHub issues. Children implement
  only accepted work and own source branches, PRs, tests, CI, and compatible
  review fixes. Do not cross those ownership boundaries.

## Verification and reporting

- Use the cheapest reliable validation for the change and keep local results,
  remote CI, automatic review, browser/device checks, and deployment status
  distinct in reports.
- Treat transient network errors as execution blockers and retry only the same
  read-only operation once when the track-specific prompt permits it. Never
  infer an empty Radar index or continue past a failed required preflight.
- Preserve user decisions and repository history. Do not perform destructive
  cleanup, unrelated lifecycle housekeeping, or out-of-scope implementation.
