# Agent Guidelines for Pomi

## Agent skills

### Issue tracker

Issues and PRDs live as local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.
Improvement Radar lifecycle records are the exception: GitHub issues and comments are
authoritative. See `docs/agents/radar-lifecycle.md`.

### Domain docs

Single-context repo: use root `CONTEXT.md` and root `docs/adr/`. See `docs/agents/domain.md`.

## Required Context

- Treat this file as the main project agent entrypoint.
- For any app development, including frontend, UI, UX, layout, Tauri window behavior, or user-facing interaction changes, read `DESIGN.md` before planning or editing.
- For any end-to-end testing work, including writing, updating, running, debugging, or reviewing Playwright tests, read `skills/end-to-end-testing/SKILL.md` before planning, editing, or running tests.
- Interactive local-development configuration belongs in the ignored root `.env.local`; scheduled automation configuration belongs in the ignored `config/pomi-automation.env`; and local release configuration belongs in the ignored `config/pomi-release.env`. Do not create package-local environment files. `POMI_CURRENT_WORK_SLUG` is optional and may be overridden in the process environment for a specific worktree.

## Scheduled Automation Contract

- Every Pomi Radar scheduled automation must read `docs/agents/automations/GLOBAL.md` before lifecycle work, repository research, external mutation, or file writing. It is the canonical shared safety contract; track-specific automation prompts may add requirements but may not weaken it.
- Keep the versioned policy and installed prompt records synchronized when either changes. The six parent/child Radar prompts already read `AGENTS.md`; their runtime records are documented in `docs/agents/automations/README.md`.

## Package And Build

- Use `pnpm`; do not introduce npm or yarn workflows unless explicitly justified.
- Changes require `pnpm -r run build` to rebuild both packages.

## Pre-1.0 Compatibility

- Until Pomi reaches version `1.0.0`, clients and the backend are released
  together for the sole current user. Prefer clean coordinated contract changes
  and remove obsolete compatibility shims; do not preserve compatibility with
  older Pomi clients, servers, or internal API shapes.
- Preserve existing persisted user data through explicit migrations. This
  pre-1.0 policy does not relax external protocol compatibility, security
  boundaries, rollback safety, or deployment validation.

## Testing Strategy

- Give each behavior to the cheapest reliable test owner: unit tests for pure rules and state transitions; jsdom integration tests for React behavior; Chromium browser-component tests for rendered geometry and browser behavior; Nest/Supertest integration tests with migrated PostgreSQL and Redis for HTTP, persistence, and cross-service contracts; native tests for Kotlin/Wear and Rust/Tauri logic; Playwright only for the 13 approved full-stack journeys.
- Prefer moving coverage down the hierarchy over adding another Playwright assertion. Add or extend an end-to-end journey only when the behavior cannot be proven reliably below the full-stack boundary.
- The retained Playwright suite must contain exactly the 13 journeys listed in `skills/end-to-end-testing/SKILL.md`. Do not add a fourteenth journey without replacing or merging an existing one and updating that policy.
- Retained Playwright journeys may mock operating-system or browser facilities, but never Pomi backend APIs. Backend contracts belong in Nest/Supertest integration tests.
- Test fixtures must be deterministic and isolated. Derive identities from stable test IDs and repeat indexes; do not use random timestamps, fixed sleeps, shared mutable users, or leaked PostgreSQL/Redis state.

## Pull Request Workflow

- Never open pull requests as drafts. Open them ready for review so the automatic Codex review is triggered.
- After Codex has reviewed a pull request, never request another Codex review unless the user explicitly asks for one.
- The user has granted standing explicit approval for agents working on Pomi to commit, push ordinary changes to the configured `origin`, and create or update the linked pull request when that is part of the requested Pomi task. Do not stop solely to ask whether an ordinary Pomi push is permitted; validate the exact scope first. This authorization does not cover force-pushes, branch deletion, unrelated repositories, or deployment outside the requested scope, and it remains revocable by the user.
- When changes are made, commit them, push the current branch, and create or update the linked PR.
- If the current branch already has a linked PR, update the title or body only when they no longer describe the current changes.
- Keep PR titles short and non-repetitive; do not expand the title when the existing wording already covers the new work.
- PR bodies should contain only a concise summary and important notes when needed; omit testing or verification sections.
- After every PR push, run `node scripts/pr-readiness.mjs wait --timeout-seconds 1800`. Fix failed CI or review findings, push, and rerun it. A reviewed ancestor remains valid after fixes; never request a second Codex review unless the user explicitly asks.
- A 30-minute timeout permits only an explicit pending report. Do not claim the PR is ready, advance linked Radar issues to `radar:in-review`, or clean dependencies until the readiness command succeeds.
- After a PR is ready, its automatic review comments are resolved or explicitly dispositioned, and all CI checks are green, run `./scripts/cleanup-worktree-after-pr.sh` to remove only that worktree's Node dependencies and local pnpm store. The command verifies those conditions against GitHub before deleting anything; use `--check-only` to verify without deleting.

### Governing Intent And Review Feedback

- Treat the latest explicit user request, accepted Radar requirements, and later user clarifications as the governing intent. Mandatory repository, architecture, security, and safety constraints still apply; surface a conflict instead of silently overriding either side. A finding that enforces a mandatory constraint is compatible with the governing intent, not a contradiction disposition: implement it when possible or stop for user resolution when the requirements cannot coexist.
- Before changing code for an automatic Codex review comment, compare the finding with the governing intent and the current patch.
- If a finding contradicts the governing intent, do not implement that finding. Reply in its GitHub review thread with the exact contradiction and governing requirement, then append `<!-- pomi-review-disposition:v1 {"version":1,"outcome":"contradicts-request","requiresUserCheck":true} -->`.
- Leave a contradiction thread unresolved so the Improvement Radar can surface it, but treat the marked reply as a completed disposition: continue all other review work and do not let it block CI, lifecycle progress, or PR readiness.
- Resolve normally addressed review threads. Never use the contradiction disposition merely because a finding is difficult, inconvenient, or broader than expected.

## Code Review Rules

### Compatibility and data

- Before `1.0.0`, do not request compatibility with older Pomi clients,
  servers, or internal API shapes. Prefer a clean coordinated change and removal
  of obsolete shims, while requiring migrations that preserve persisted user
  data and respecting external protocols and security boundaries.
- Require TypeORM migrations for schema changes, DTOs and `ValidationPipe` for
  requests, shared controller validation helpers, explicit HTTP exceptions,
  exported service boundaries, centralized Redis providers, and database
  aggregates instead of in-memory statistics.

### Maintainability and interface consistency

- Reject new parameters with default values. Keep services single-purpose,
  comments limited to non-obvious logic, repeated values centralized, and
  removals free of dead code or warnings.
- Reuse frontend UI primitives, avoid inline styles except runtime-computed
  values, and preserve the documented Zustand selector and base-store patterns.

### Verification and review scope

- Require coverage at the cheapest reliable layer; change one of the 13
  Playwright journeys only when the full-stack workflow owns the behavior.
- Apply the governing user request and accepted Radar decisions. Fix compatible
  findings, but use the documented contradiction disposition when a finding
  conflicts with governing intent. Keep PRs consequential, scoped, and
  squash-merge-friendly.

## Architecture Rules

- WebSocket path remains `/socket.io`.
- TypeORM uses migrations only; do not enable `synchronize: true`.
- `data-source.ts` remains the migrations CLI source.
- Zustand selectors use `useStore.use.property()` instead of store destructuring.
- Base stores remain available for `subscribe/getState` usage.

## Local Development Fixture

- `./scripts/start-project-frontend.sh` and `./scripts/start-worktree-environment.sh` are responsible for the local `copyme` fixture before opening the app.
- `copyme` fixture auto-login is env-gated via `VITE_DEV_AUTO_LOGIN_USERNAME` and `VITE_DEV_AUTO_LOGIN_PASSWORD`; startup scripts derive the default password from the fixture username unless overridden.
- Local dev context labeling is env-gated via `VITE_TEST_CONTEXT_SLUG`; startup scripts default it from `POMI_CURRENT_WORK_SLUG` unless a focused test or manual env override supplies a more specific slug.
- When dev auto-login is enabled, the app replaces any persisted auth with a fresh `copyme` session and ignores stored self-host backend URLs so it uses the resolved local backend port.
- `pnpm --filter @pomi/backend seed:copyme` preserves a healthy fixture. It reseeds only when the user, credentials, preferences, canonical intentions, statistics freshness, or statistics counts are missing or inconsistent.
- Every user-facing feature addition or behavior change must update the `copyme` seed so the fixture demonstrates representative use of the new behavior. Bump the fixture marker seed version whenever the expected seeded data changes.

## Sentry Rules

- Use `Sentry.logger.*` for logs; use `captureException` only for actual errors.
- Backend `SentryLoggerService` uses `Sentry.logger[level]()` for `log()` and `warn()`, sending them to Logs, not Issues.
- Backend `error()` uses `captureException()`, sending it to Issues.
- Frontend `consoleLoggingIntegration` auto-captures `console.log`, `console.info`, `console.warn`, and `console.error`, sending them to Logs.
- Frontend unhandled errors use `captureException()`, sending them to Issues.
- Both frontend and backend require `enableLogs: true` in `Sentry.init()`.
- Sentry behavior is production-only and must remain gated by `NODE_ENV === 'production'`.
