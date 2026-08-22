# Grill Session: Development Fixtures and Diagnostics

- Pack: [index.md](../index.md)
- Original request: [original-prompt.md](../original-prompt.md)
- Assigned output: [output](../outputs/03-development-fixtures-and-diagnostics.md)

## Focus

Decide the local Copyme fixture lifecycle and AI debug-log usability as one developer-experience topic.

Resolve these connected decision areas:

- Make normal startup’s Copyme check extremely fast when the fixture is already valid. Decide the durable marker/version contract, where it lives, which changes invalidate it, and which minimum database checks remain necessary.
- Decide whether freshness is calendar-month based, elapsed-time based, or seed-version based. Specify how current-month Timer statistics are appended or regenerated without deleting useful fixture state.
- Keep an explicit manual full reseed/repair command and define when startup should fall back to it automatically versus report an actionable failure.
- Define “every setting on by default” precisely. Distinguish capability settings that should be true, safety/privacy settings that should remain false, settings with non-boolean defaults, and feature data required to exercise Work, Break, Long break, Tasks during breaks, recurrence, reminders, Sessions, Assistant, and statistics.
- Define a compact health contract for seeded data without scanning every seeded Task, Intention, statistic, and Task event on every startup.
- Fix the AI debug-log panel’s disappearing/reappearing list and page-height oscillation. Decide desired loading, refresh, expansion, mutation, empty, and error behavior; preserve the user’s scroll and expanded log while data changes.
- Decide whether debug logs refresh only on entry/manual action, after known mutations, through realtime events, or by polling. Avoid a refresh model that repeatedly tears down the list.

## Dependencies and shared constraints

- Read root `CONTEXT.md`, root `DESIGN.md`, ADR 0005, ADR 0012, `packages/backend/scripts/seed-copyme-user.ts`, `packages/backend/scripts/seed-user-fixture.ts`, `packages/backend/test/copyme-fixture.test.cjs`, `scripts/start-project-frontend.sh`, `scripts/start-worktree-environment.sh`, `packages/frontend/src/pages/DebugPanel.tsx`, and the Assistant debug service/controller files.
- Copyme already includes all three Timer types, parent/Sub-intentions, varied active/completed/archived Tasks, recurrence, manual-order examples, preferences, Task events, and roughly three years of Timer statistics.
- The current healthy path runs migrations and then compares password hash, admin state, every expected preference, every seeded Intention relationship, aggregate statistics counts and latest date, every Task field, and Task events. This is why “already seeded” is not a cheap marker check.
- Startup scripts rely on `pnpm --filter @pomi/backend seed:copyme` preserving a healthy fixture and reseeding only when inconsistent.
- The explicitly withdrawn William import/anonymization/account replacement and missing April–June log filling are out of scope. Do not reopen them.
- “Every setting on” must not silently override privacy, cost, notification, or destructive behavior without a confirmed rule.
- This session may propose fixture-specific metadata terminology for `CONTEXT.md`, but must not put general implementation vocabulary into the glossary.

## Instructions

Use `$grill-with-docs`. Read `original-prompt.md`, `index.md`, this assigned prompt, the relevant code and documentation, and the assigned output before questioning the user. Inspect the repository to resolve facts instead of asking the user.

Grill one decision at a time and always recommend an answer. Stay within local fixture performance/freshness/completeness and AI debug-log behavior; do not decide product Task, Timer, Assistant recording, Wear app, or Tile UI.

After each confirmed decision, update only the assigned output file. Record rationale, rejected alternatives, consequences, repository evidence, proposed `CONTEXT.md` changes, cross-track implications, and unresolved issues.

Reach explicit shared understanding, mark the output `complete`, and stop without implementation. Leave `CONTEXT.md`, ADRs, other session files, and product code unchanged.
