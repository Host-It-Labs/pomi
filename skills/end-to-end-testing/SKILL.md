# End-to-End Testing

Use this skill for any Pomi end-to-end testing work: selecting the correct test layer; writing, updating, running, debugging, or reviewing Playwright tests; or taking screenshots for browser assertions.

# Coverage Ownership

Choose the cheapest layer that can prove the behavior reliably:

1. **Unit:** pure rules, validation, transformations, stores, reducers, state machines, queues, clocks, IDs, and serialization. Inject nondeterministic dependencies.
2. **jsdom integration:** React interaction, focus, modal states, loading and errors, permission gates, store-to-view behavior, and mocked network boundaries through MSW.
3. **Chromium browser component:** responsive geometry, rendered layout, drag/autoscroll, charts, browser focus, and behavior that requires a real rendering engine but not a full Pomi stack.
4. **Backend integration:** Nest `TestingModule` and Supertest against the production application configuration, migrated PostgreSQL, and Redis for DTO validation, authentication, HTTP contracts, persistence, isolation, and Watch APIs.
5. **Native:** JUnit/Robolectric and Kover for Wear state, presentation, queues, and serialization; Cargo tests for extracted Tauri helpers.
6. **Playwright end to end:** only the approved non-mocked, real-stack workflows below.

Do not duplicate lower-layer assertions in Playwright. When an E2E assertion can move down, add and pass its replacement coverage before removing it from Playwright.

## Retained Playwright Journeys

The suite owns exactly these 13 workflows:

1. Account creation, authenticated reload, logout, and login.
2. Enable Intentions, create and select a Parent/Sub-intention pair, then run and record a Timer.
3. Primary Timer actions: confirmed start, pause, add five, undo, and reset.
4. Session and Timer-extension flow through Break or Long break with persisted state.
5. Enable Tasks, create and edit a Task through the shared editor, then verify reload persistence.
6. Pin a linked Task, reconcile Timer Intentions, and confirm Task completion.
7. Complete and undo or archive a recurring Task while preserving its successor contract.
8. Persist manual Task ordering across refresh.
9. Reconcile Task updates across two clients while isolating another user.
10. Persist and cross-client-sync settings into affected Timer behavior.
11. Produce real Timer and Task activity, then verify statistics and work-Timer logs.
12. Verify accepted-action FIFO, delayed indicator, reconnect, and authoritative reconciliation.
13. Export and import complete user data as an administrator.

Do not add a fourteenth journey. Merge new workflow coverage into the closest existing journey or replace an obsolete journey and update this list. Health, standalone API integration, Watch API, Android-notification, layout, modal-state, mocked Assistant/debug, and other component-level scenarios belong below Playwright.

Retained journeys may mock OS and browser facilities when the real facility is outside the application boundary. They must never mock or fulfill Pomi backend API responses.

# General rule

When running E2E tests locally, update this skill if you discover a repeatable mistake that could affect future work across multiple projects.

Only add guidance when the mistake is global and reusable, not specific to the current codebase, feature, file structure, or temporary implementation detail.

When adding an instruction, include:

- the mistake that was made;
- the solution that fixed it;
- the general rule to follow next time.

If an existing instruction is irrelevant, outdated, duplicated, or wrong, edit or remove it instead of adding more noise.

The goal is to prevent the same class of mistake from happening again.

## Execution Discipline

- Do not run multiple local e2e commands in parallel.
- The wrapper clears test data and test artifacts before and after each run, so parallel runs can race on `db:clear`, ports, storage, screenshots, and Playwright output.
- Run one focused spec or filter at a time, wait for it to finish, then run the next one.
- Start with the smallest focused spec or `-g` filter that covers the changed behavior, then run broader coverage after the focused run passes.
- If Playwright retries a failed test, wait for the retry and final failure output before editing code or tests.
- After changing implementation that affects TypeScript, layout calculations, or shared UI behavior, run `pnpm -r run build` before rerunning the focused e2e spec.
- CI runs with zero retries and `failOnFlakyTests`; a flaky pass is a failure to diagnose, not an acceptable result.
- Keep each retained journey under 45 seconds. Assert durable application state instead of waiting for elapsed time.
- Never use fixed sleeps, random timestamps, broad route interception, shared mutable test users, or state left behind in PostgreSQL or Redis.
- Build deterministic fixture identities from Playwright test IDs and repeat indexes so stress runs remain isolated and reproducible.

## Standard Run

Prefer the wrapper script:

```bash
./scripts/run-e2e.sh e2e/journeys.spec.ts
```

Equivalent package script:

```bash
pnpm test:e2e
```

When no spec path is supplied, the wrapper defaults to `e2e/journeys.spec.ts` so a focused `-g` run cannot accidentally select legacy specs. The wrapper:

1. Cleans previous test artifacts.
2. Clears test users from DB with `db:clear`.
3. Resolves local ports from explicit env vars, `POMI_DEV_PORTS_FILE`, worktree `.pomi/dev-ports.env`, or the default user-state dev ports file; CI falls back to default ports.
4. Falls back to the running default backend/frontend app ports when the resolved local app endpoints are stale and no explicit app port override was supplied.
5. Waits for backend health and retries with optional Docker restart.
6. Runs `playwright test --reporter=list` with 7 parallel workers locally by default; CI worker count is controlled by Playwright config through `PLAYWRIGHT_CI_WORKERS`.
7. Runs tests fully parallel by default locally and in CI. Set `PLAYWRIGHT_FULLY_PARALLEL=0` only when diagnosing a suspected order or isolation issue.
8. Preserves the current Playwright artifacts for local debugging and CI upload, then clears test data after tests. For faster local focused reruns only, set `POMI_E2E_SKIP_FINAL_CLEANUP=1`; the next wrapper run still performs the initial artifact cleanup and `db:clear`.

GitHub PR E2E runs `pnpm test:e2e`, so it uses `./scripts/run-e2e.sh`.

## Local Test Commands

Use the narrowest command that owns the behavior:

```bash
pnpm test:unit          # fast pure and jsdom unit coverage
pnpm test:integration   # Nest HTTP, PostgreSQL, and Redis contracts
pnpm test:browser       # Chromium component and geometry coverage
pnpm test:native        # Wear/Kover and Rust/Tauri checks
pnpm test:coverage      # Business-rule ownership and coverage ratchet
pnpm test:ci            # complete non-E2E PR parity
pnpm test:e2e           # all 13 retained full-stack journeys
pnpm test:e2e:stress    # repeated, fully parallel isolation run
```

Run a single retained journey while developing:

```bash
./scripts/run-e2e.sh e2e/journeys.spec.ts -g "primary Timer actions"
```

## Focused Runs

Start with focused specs for changed behavior, then run the full suite when the focused run is clean.

```bash
./scripts/run-e2e.sh e2e/journeys.spec.ts
./scripts/run-e2e.sh e2e/journeys.spec.ts -g "primary Timer actions"
```

Direct Playwright is allowed only when backend and `db:clear` are handled manually:

```bash
pnpm exec playwright test e2e/journeys.spec.ts --reporter=list
```

Other modes:

```bash
pnpm test:e2e:ui
pnpm test:e2e:headed
pnpm test:e2e:debug
```

Prefer Playwright `--reporter=list`.

## Local Server Setup

- The e2e wrapper resolves ports from explicit env vars, `POMI_DEV_PORTS_FILE`, worktree `.pomi/dev-ports.env`, or the default user-state file at `${XDG_STATE_HOME:-$HOME/.local/state}/pomi/dev-ports.env`.
- If Playwright reports the frontend is not running, inspect the same resolved port source the wrapper uses before starting anything.
- In secondary worktrees, the wrapper may use the default user-state port file when `.pomi/dev-ports.env` is absent.
- Start the frontend on the exact `POMI_FRONTEND_PORT` used by the wrapper, not a guessed default.
- If you manually start a frontend on default ports, pass matching `POMI_FRONTEND_PORT`, `POMI_FRONTEND_BASE_URL`, `POMI_BACKEND_PORT`, and `POMI_BACKEND_BASE_URL` env vars to the e2e wrapper; otherwise the default user-state port file may point the wrapper at a different stack.
- Do not use `./scripts/start-project-frontend.sh` for normal e2e runs that need the login form or test-created users. That script enables dev fixture auto-login, which can replace persisted auth and bypass the login screen.
- For normal e2e runs, start plain Vite on the resolved frontend port with the resolved backend URL and without `VITE_DEV_AUTO_LOGIN_USERNAME` or `VITE_DEV_AUTO_LOGIN_PASSWORD`.
- If an existing frontend was started with dev auto-login, stop it before rerunning login-based e2e specs.
- Plain Vite startup pattern:

```bash
POMI_FRONTEND_PORT=<resolved-frontend-port> POMI_BACKEND_PORT=<resolved-backend-port> pnpm --filter @pomi/frontend dev
```

## Sandbox And Permissions

- Local e2e cleanup connects to Postgres and Redis through resolved ports. Sandbox EPERM or connection permission failures during `db:clear` are infrastructure failures, not test failures.
- If the wrapper fails with sandbox EPERM while connecting to local Postgres or Redis, rerun the exact same `./scripts/run-e2e.sh ...` command outside the sandbox using the approved e2e path.
- Do not change tests or app code to work around sandbox EPERM.
- When rerunning after sandbox EPERM, keep runs sequential so cleanup does not collide with another active wrapper process.
- When local Playwright retries pass and the wrapper exits successfully, still report the flaky tests by spec and title.

## Test Authoring Rules

- Do not mock Pomi backend APIs in Playwright. Exercise route contracts through Nest/Supertest integration tests and use MSW only at frontend integration boundaries.
- Avoid broad route interception. If a retained journey must observe a request, match its backend pathname explicitly with `new URL(request.url()).pathname` and let the request continue unchanged.
- Always call `helpers.expandWindow()` before screenshots because the app may start collapsed in Tauri context.
- Scroll to the target section before screenshotting settings because it is a long scrollable page.
- Use `page.waitForLoadState('domcontentloaded')` before capturing after navigation.
- For feature states such as Sessions dots or intention buttons, ensure the feature is activated before snapping.
- The desktop shell uses a fixed expanded app height in the test harness. Changing the Playwright viewport does not necessarily change the app's usable shell height.
- Do not assert responsive behavior by assuming `page.setViewportSize()` changes the fixed desktop shell dimensions. Mock or drive the actual measured value the component uses, or assert visible layout inside the fixed shell.
- For overflow regressions, distinguish document/page overflow from internal scroll-container content. Measure visible container bounds and visible children, not the total `scrollHeight` of an intentionally scrollable region.
- Bottom-gap assertions should target the visible area that must reserve space, not a parent column whose content can extend inside an internal scroll container.
- Tailwind `space-y-*` creates margins, not CSS `row-gap`. Layout tests and adaptive row calculations must measure rendered row pitch or actual element positions, not `row-gap`, when rows use `space-y-*`.

## Scenario Pitfalls

- For cross-page same-user scenarios, do not re-login on a second page. Re-login can invalidate or replace session behavior and make assertions misleading.
- Prefer opening a second page in the same context and cloning auth localStorage state when needed.
- Creating an intention from `IntentionsManager` can auto-start and navigate back to timer when timer is not running.
- If setup needs a neutral state, seed baseline intentions through authenticated API calls instead of UI creation.
- Timer running state can hide intention controls.
- If asserting intention button state, reload or pause first when needed to make selectors deterministic.
- When click interception happens, prefer testing the intended input path directly with pointer events and verify the control is enabled before interaction.
