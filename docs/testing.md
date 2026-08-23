# Testing Pomi

Pomi uses the cheapest deterministic layer that can prove a behavior. Playwright is reserved for the 13 real-stack journeys listed in `testing/e2e-ownership.md`.

## Test layers

| Layer               | Owns                                                                                             | Command                                        |
| ------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Node unit           | Pure rules, schemas, DTOs, transformations, store/state factories                                | `pnpm test:unit`                               |
| jsdom integration   | React behavior, accessibility, focus, loading and error states with MSW boundaries               | `pnpm exec vitest run --project frontend-unit` |
| Chromium component  | Geometry, overflow, responsive layout, drag and browser-only behavior                            | `pnpm test:browser`                            |
| Backend integration | Nest production middleware, HTTP validation and migrated PostgreSQL/Redis behavior               | `pnpm test:integration`                        |
| Native              | Wear JUnit/Kover plus Rust formatting, checks and tests                                          | `pnpm test:native`                             |
| Inventory           | Static counts by project plus active and transitional Playwright lines                           | `pnpm test:inventory`                          |
| Business acceptance | Executable ownership specification, V8 report, non-regression ratchet and compact 100% contracts | `pnpm test:business`                           |
| Coverage ratchet    | Same aggregate report with the replacement-phase non-regression floor                            | `pnpm test:coverage:ratchet`                   |
| Non-E2E CI parity   | Build, lint, all non-E2E layers and coverage                                                     | `pnpm test:ci`                                 |
| Non-E2E stress      | Ten shuffled unit/integration repetitions                                                        | `pnpm test:stress`                             |
| E2E                 | Thirteen real-stack product journeys                                                             | `pnpm test:e2e`                                |
| E2E stress          | Ten fully parallel repetitions                                                                   | `pnpm test:e2e:stress`                         |
| E2E timing          | Ten separate parallel and three separate serial full-suite measurements                          | `pnpm test:e2e:timing`                         |

Focused Playwright runs use the wrapper so database cleanup, ports and artifacts match CI:

```bash
./scripts/run-e2e.sh e2e/journeys.spec.ts -g "account creation"
PLAYWRIGHT_FULLY_PARALLEL=0 ./scripts/run-e2e.sh e2e/journeys.spec.ts --workers=1
pnpm test:e2e:stress:focused -- -g "accepted-action FIFO"
```

## Inventory and timing reports

`pnpm test:inventory` uses Vitest static collection plus native and Playwright declaration counts. It does not run tests, browsers, PostgreSQL, or Redis. It writes machine-readable and Markdown reports to `docs/testing/results/test-inventory.json` and `docs/testing/results/test-inventory.md`, then refreshes the ownership report.

`pnpm test:e2e:timing` runs the complete 13-journey suite ten times with seven workers and three times with one worker. Every repetition is a separate wrapper invocation with zero retries; duration uses a monotonic clock and includes cleanup plus deterministic fixture provisioning. It writes `docs/testing/results/e2e-timing.json` after every run so a failure leaves partial evidence marked incomplete, writes the Markdown companion, refreshes inventory, and updates the ownership report only after all runs pass.

Inspect the exact timing plan without touching PostgreSQL, Redis, or Playwright:

```bash
pnpm test:e2e:timing:dry
```

Timing p50/p95 values use linear interpolation over successful full-suite durations. A mode is reportable only when all required runs pass; partial measurements remain `incomplete` and the ownership report stays `pending`.

The `PR E2E` workflow keeps its normal pull-request run unchanged. A manual workflow dispatch with `acceptance_timing` enabled runs the measured 10+3 sequence and uploads `e2e-acceptance-timing`; failures upload the partial timing report with the ordinary diagnostics.

## Business-logic acceptance and coverage

The acceptance gate is executable behavior ownership, not a blanket percentage. [`config/business-logic-ownership.json`](../config/business-logic-ownership.json) names each business rule, its production source, and the test-title evidence that documents it across auth/preferences, intentions, timer/session transitions, tasks/recurrence/order, accepted-action reconciliation, statistics, administrator data transfer, and Watch/Wear. `pnpm test:business` runs every Vitest project with coverage and requires the manifest to be complete and valid. It keeps 100% coverage only for compact contracts/models: shared API schemas, backend DTO validation, the Watch surface model, and the Timer-session service.

This keeps the useful role the former E2Es played: the tests are readable, executable statements of the main business rules. Larger services do not need artificial line coverage when their rules are better demonstrated through focused service, HTTP, component, native, and retained journey specifications. The manifest is the mechanically checked acceptance gate for main business behavior; the historical matrix also records duplicate and narrow presentation assertions intentionally retired without claiming one-for-one replacement coverage.

`pnpm test:coverage` is an alias for `pnpm test:business`. It produces a full-source V8 report across Node, jsdom, backend integration, and Chromium. `config/coverage-baseline.json` records the full-source baseline from the required Node 26 CI runtime. `pnpm test:coverage:ratchet` prevents covered counts or percentages from falling. Raise the baseline when replacement coverage lands; never lower it or hide a difficult product source through an exclusion.

Coverage exclusions are limited to declarations, generated/build output, migrations, and framework bootstrap/module wiring. Entities, product services, controllers, stores, utilities, and components remain measurable.

## Determinism

- Derive fixture identity from Playwright's stable test ID and repeat index.
- Do not use timestamps, randomness, fixed sleeps or shared mutable users.
- Do not intercept Pomi backend APIs in retained E2E journeys.
- Stub external AI and OS facilities at their adapters in lower layers.
- E2Es use zero CI retries, `failOnFlakyTests`, durable server-state assertions and a 45-second per-journey target.
- Integration tests own their PostgreSQL rows and Redis keys and clean both after themselves.

## Stress acceptance

Before publishing a testing-suite change:

1. Run unit and integration suites ten times with shuffled seeds.
2. Run all retained E2Es ten times fully parallel and three times with one worker.
3. Run historically failing replacements or retained journeys 50 focused times.
4. Reject retry-only passes, fixed waits, leaked state, external AI calls and order dependence.
5. Record counts plus p50/p95 workflow durations in the ownership report.
