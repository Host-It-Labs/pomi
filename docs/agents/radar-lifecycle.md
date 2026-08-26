# GitHub-backed Improvement Radar

## Bot-only GitHub writes

Every Radar-related GitHub interaction must run as `Pomi Radar[bot]`. Run every
GitHub-facing `git` command, every `git commit`, and every `gh` or lifecycle
command through:

```bash
node scripts/github-app-auth.mjs exec -- <command> [args...]
```

For local scheduled-agent work, copy `config/pomi-automation.example.env` to
`config/pomi-automation.env`. The helper loads that profile automatically; do
not put scheduled Radar credentials in `.env.local` or use a personal GitHub
token as a fallback.

The helper fails closed when App authentication is unavailable, isolates Git
from stored personal credentials, and supplies the bot Git identity and
short-lived token only to that child command. Never fall back to the user's Git
or `gh` identity for fetches, issues, comments, commits, branches, pushes, pull
requests, or reviews. `POMI_RADAR_SOURCE_GITHUB_TOKEN` is reserved for read-only
migration access to `NeoHuncho/pomi-private`.

GitHub issues and comments are authoritative for Radar Features, Bugs, Sentry
problems, Security proposals, and Performance proposals. The website is an
interface over those records; D1 is retained only as migration evidence.

The versioned machine contract is `config/radar-lifecycle.json`. Use
`scripts/radar-lifecycle.mjs` for deterministic markers, lifecycle labels,
duplicate candidates, clarification rounds, preflight indexing, consolidation
merge updates, and production-release closure.

## Issue contract

- Keep one source label and exactly one `radar:*` lifecycle label.
- Store immutable source IDs, root behavior, Sentry group IDs, clarification
  state, source PRs, and the consolidation merge SHA in a `pomi-radar:v1` HTML
  marker. Keep the surrounding issue and comments readable.
- Use `Related #N` in source and consolidation PRs. Never use a closing keyword.
- Accept moves to `radar:accepted`; Ask moves to `radar:needs-agent`; Reject
  requires a reason, moves to `radar:rejected`, and closes as not planned.
- A consolidation merge moves included canonical issues to
  `radar:ready-for-release`. Only a successful, non-prerelease production job
  closes included issues as `radar:released` and resolves mapped Sentry groups.
- The consolidation manifest must list every source PR in `sourcePrs`. After a
  consolidation merge, the trusted lifecycle verifies that each listed source
  head is contained in the merge commit, comments on it once, and closes it.
  Source PRs remain open while the consolidation PR is open. The
  `consolidation-reconcile` command repairs a missed post-merge event.

## Radar presentation contract

Before an issue can appear as a card that needs the user's action, enrich the
existing canonical issue in place. Do not create a replacement issue merely to
improve its presentation.

- Use a four-to-ten-word, plain-language GitHub title of at most 72 characters.
  Prefer six to eight words so it fits on two Radar lines. Keep raw Sentry
  messages, exception names, URLs, paths, and diagnostic identifiers in the
  Evidence section instead of the title.
- Fill `displayTitle`, `summary`, `whyNow`, `currentState`, `details`, `evidence`,
  `tradeoffs`, `validation`, and at least one `acceptanceCriteria` entry in the
  issue marker. These fields supply the Radar card title and subtitles.
- Write for scanning: one sentence per field, no repeated context, a 20-word
  summary, no more than 24 words for each main section, and acceptance criteria
  of at most 18 words each. Evidence may use up to 30 words when a diagnostic is
  necessary.
- Run `node scripts/radar-lifecycle.mjs enrich < payload.json` to patch the
  canonical issue title and marker and add an idempotent, readable audit comment.
- Process every issue listed in preflight `enrichmentIssues`, then rerun
  preflight and require that list to be empty before presenting or implementing
  the issue.

A saved user decision remains visible and reversible until a scheduled agent
pass acknowledges it. After processing the decision, run
`node scripts/radar-lifecycle.mjs acknowledge < payload.json` with the canonical
issue numbers and their latest `lastMutationId` values, track, stable run ID,
and an explicit stable `acknowledgedAt` timestamp. This clears the pending-pass
marker and adds one readable, idempotent acknowledgement comment. A changed
mutation ID is stale and must be processed again rather than acknowledged.
Lifecycle transitions still determine whether the issue needs a new user action
after acknowledgement.

## Duplicate contract

Immutable source and Sentry group IDs are exact matches. Reports with the same
underlying behavior and fix are duplicates. Reports that merely touch the same
area stay open and are cross-linked. Agents must inspect expected behavior,
observed behavior, reproduction, diagnostics, platform, and acceptance criteria
before confirming a semantic match.

The oldest applicable open issue is canonical. Add only new evidence to it.
Label the newer issue `duplicate`, retain its source labels, comment
`Duplicate of #N`, and close it with GitHub's duplicate reason. Include an
idempotency event marker in every generated comment. Reopen released canonical
issues for regressions. Reopen rejected issues only when evidence invalidates
the rejection reason.

## Feature clarification

Inspect the repository and existing history before asking. Round 1 contains all
independent questions. Round 2 contains only questions unlocked by Round 1.
User-initiated Ask conversations do not consume these rounds. Restore the state
held before clarification when complete. If uncertainty remains after Round 2,
record the remaining choice and recommended assumption, move to
`radar:blocked`, and do not send a third proactive batch.

## Scheduled preflight

Before lifecycle preflight, verify the automation is in its dedicated worktree
and expected branch, and require a clean worktree. Fetch the branch and
`origin/main`; fast-forward when the local branch is behind its remote, merge
`origin/main` when needed, and stop without discarding work on divergence or a
merge conflict. An ahead-only automation branch is valid and must be preserved.

After branch synchronization, run `node scripts/radar-lifecycle.mjs preflight`
before research, builds, or other writes. Reconcile duplicates first. Stop when
the resulting track index has no relevant issue, clarification, source PR,
review, Sentry, or proposal work. A duplicate proposal candidate does not fill
a daily or three-item research slot.

Security and Performance each keep three decision cards available. Preflight
reports `visibleProposalCount`, `visibleProposalIssueNumbers`, and
`proposalSlotsNeeded`. A recorded decision remains in a slot until the agent
processes and acknowledges it. Rerun preflight immediately after acknowledgement
and create exactly `proposalSlotsNeeded` distinct proposals; do not wait for the
other proposals from the original run to be resolved.

Feature/Bug keeps one daily Feature decision card available using the same
preflight fields. An acknowledged daily Feature in `radar:in-progress` or
`radar:in-review` no longer occupies that slot, so the same run must research
and publish its distinct replacement when `proposalSlotsNeeded` is one.

Every automation run and category owns a fresh source PR based on the latest
`origin/main`. Existing source PRs may receive only fixes for their original
marker issue set; never append newly accepted work to them. Features use a
`track:feature` marker and Bugs use `track:bug`, with one PR per category when a
run implements both.

## Automatic Codex review dispositions

Compare every automatic Codex finding with the latest explicit user request,
the canonical Radar issue, its accepted decision, and later clarifications.
Mandatory repository and safety constraints still apply and must be surfaced
when they conflict with the requested behavior. A finding that enforces one of
those mandatory constraints is compatible with the governing intent, not a
contradiction disposition: implement it when possible or stop for user
resolution when the requirements cannot coexist.

Fix and resolve findings that are compatible with the governing intent. When a
finding contradicts that intent, make no code change for the finding. Reply in
the review thread with the exact contradiction and governing requirement, then
append this marker:

```markdown
<!-- pomi-review-disposition:v1 {"version":1,"outcome":"contradicts-request","requiresUserCheck":true} -->
```

Leave the marked thread unresolved so the Radar can report it. The marked reply
is nevertheless a completed review disposition: continue other review work and
do not let it block CI, lifecycle transitions, or PR readiness. Never use this
disposition for findings that are merely difficult, inconvenient, or broader
than expected.
