# Pomi scheduled automation contract

This is the shared safety contract for all six Pomi Radar scheduled
automations: the Feature/Bug, Performance, and Security planning parents and
implementation children. Every scheduled prompt must read `AGENTS.md` and this
file before lifecycle work, repository research, external mutation, or file
writing. Track-specific prompts may add scope and workflow requirements, but
must not weaken this contract.

## Startup synchronization

The first phase of every run is startup synchronization. Each installed prompt
contains this bootstrap sequence so it can be followed before opening the
versioned lifecycle and policy files:

- Take only the required read-only snapshot of `pwd -P`, the exact expected
  branch, complete `git status --porcelain --untracked-files=all`, and
  `git worktree list --porcelain`. A wrong path, branch, or dirty entry is a
  hard stop.
- Acquire the durable per-worktree lock before any Git mutation. If acquisition
  reports an existing owner, stop without reading or changing the checkout.
- While holding the lock, use the GitHub App helper to fetch both the
  automation branch's remote-tracking ref and `origin/main` without writing the
  shared `FETCH_HEAD`. Fast-forward the local branch when it is behind its own
  remote; preserve an ahead-only branch; stop on divergence. Merge `origin/main`
  when it is not already an ancestor, and stop on conflict.
- Recheck the exact worktree, branch, and empty status. Only after this gate
  succeeds may the run read `AGENTS.md`, this file, lifecycle files, or source
  code, run preflight, research, delegate, build, or write.

## Worktree ownership and handoff

- Work only in the dedicated worktree and branch named by the track-specific
  prompt.
- Before branch synchronization or any other run work, acquire the durable
  per-worktree lock with `node scripts/radar-automation-lock.mjs acquire --track
  <track> --stage <parent|child>`. If acquisition reports an existing owner,
  stop without reading or changing the checkout. Hold the lock for the entire
  run and release it only after the final clean-branch check with `node
  scripts/radar-automation-lock.mjs release --track <track> --stage
  <parent|child>`. Recover a lock only after verifying that no run is active,
  using the explicit `recover --confirm` command.
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
- Every exit path after successful acquisition must release the lock. For an
  early no-work or checkout-gate stop, make no checkout changes, report the
  gate, and release the lock; if restoration cannot be completed, keep the
  lock held for manual recovery instead.

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
  review fixes. Before releasing the lock, implementation children must return
  the shared checkout to the exact handoff branch named by their prompt and
  verify an empty status. Do not release the lock while on a source branch or
  with uncommitted work. Do not cross those ownership boundaries.

## Verification and reporting

- Use the cheapest reliable validation for the change and keep local results,
  remote CI, automatic review, browser/device checks, and deployment status
  distinct in reports.
- Treat transient network errors as execution blockers and retry only the same
  read-only operation once when the track-specific prompt permits it. Never
  infer an empty Radar index or continue past a failed required preflight.
- Preserve user decisions and repository history. Do not perform destructive
  cleanup, unrelated lifecycle housekeeping, or out-of-scope implementation.
