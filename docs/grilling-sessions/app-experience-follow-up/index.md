# Grilling Session Pack: App Experience Follow-up

- Status: adr-created
- Original request: [original-prompt.md](./original-prompt.md)
- Consolidated ADR: [ADR 0013](../../adr/0013-app-experience-follow-up.md)
- Updated contexts: [CONTEXT.md](../../../CONTEXT.md)

## Sessions

| Session                                 | Logical topic                                                             | Why separate                                                        | Depends on | Prompt                                                         | Output                                                         | Status   |
| --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------- | -------------------------------------------------------------- | -------------------------------------------------------------- | -------- |
| 01-tasks-experience                     | Tasks across desktop, mobile, Wear, and Task statistics                   | One Task lifecycle and ordering decision tree                       | none       | [prompt](./prompts/01-tasks-experience.md)                     | [output](./outputs/01-tasks-experience.md)                     | complete |
| 02-timer-assistant-and-wear             | Timer and Assistant experience across desktop, mobile, Wear app, and Tile | Cross-device Timer/Assistant presentation and release decision tree | none       | [prompt](./prompts/02-timer-assistant-and-wear.md)             | [output](./outputs/02-timer-assistant-and-wear.md)             | complete |
| 03-development-fixtures-and-diagnostics | Copyme fixture freshness/performance and AI debug-log stability           | Developer fixture and diagnostic workflow, separate from product UX | none       | [prompt](./prompts/03-development-fixtures-and-diagnostics.md) | [output](./outputs/03-development-fixtures-and-diagnostics.md) | complete |

## Session-count rationale

The request reduces to three independent decision trees: Task behavior and analytics; cross-device Timer/Assistant/Wear experience; and local development fixtures/diagnostics. Wear Task-completion feedback belongs to the Task session, while all other Wear controls, Tile parity, and release behavior belong to the Timer/Assistant session. No session depends on another, so all three can run in one batch.

## Shared constraints

- Use Pomi terms from root `CONTEXT.md`: Task, Task due date, Task priority, Recurrence pattern, Task order, Minimized task view, Task editor, Timer, Intention, Intentions picker, and Assistant.
- Root `DESIGN.md` requires existing UI primitives, dense microcopy, and hidden shortcut badges in the normal state.
- User-triggered mutations use the confirmed FIFO action gateway from ADR 0012. Wear must render confirmed server state and must not reintroduce optimistic projections.
- The shared `TaskFormModal` is the canonical Task editor. The compact minimized Task surface already expands advanced creation into the full Tasks view, but editing can still render the editor inside the compact view.
- Current default Task ordering is due-aware. Manual overrides exist only for active undated Tasks; extending drag ordering to dated Tasks changes the current frontend, API, backend, and Watch ordering contract.
- Current Tasks mobile back handling is page-oriented. The description modal does not register its own mobile back behavior, so native back can fall through to the Tasks page handler and return to Timer.
- The expanded Intentions picker already supports six or nine slots depending on Timer type, placement, and viewport. The desktop expanded window height is currently 690 px.
- The minimized extension button currently appears only before a paused Timer has started and uses `T`, which conflicts with the Tasks shortcut.
- Assistant recording state currently lives inside `AssistantLauncher`, which is mounted only on the Timer page; navigating away unmounts it.
- Task statistics currently expose one flat event filter at a time: Completed, Overdue, On time, Archived, or High+. Created-task and recurring-task counts are not part of the current statistics response.
- Copyme already seeds varied Tasks, Work/Break/Long-break Intentions, preferences, and roughly three years of Timer statistics. Its “healthy” path still performs broad credential, preferences, Intention, statistics, Task, and Task-event validation on every startup.
- Wear app and Tile are separate renderers over shared status/presentation helpers. Parity is not mechanically enforced today.
- `scripts/deploy-watch.sh` validates and saves the Wireless debugging address, reconnects, restarts ADB once, then prints re-pair instructions. Installation failure does not currently attempt deeper host-side recovery.
- The request’s William-data import, anonymization, replacement of Copyme, and filling William’s missing April–June logs were explicitly withdrawn. They are out of scope.
- Batch plan: all three sessions are roots and may run concurrently. Dependency depth is one, below the two-batch maximum.
- No product code, canonical `CONTEXT.md`, or ADR changes belong to Phase 1 or to an individual grilling session.

## Reconciliation decisions

- On 2026-07-25 the user confirmed that Session 01's removal of the Task overdue grace window governs. Session 03's stale one-day Copyme fixture value is omitted; Copyme follows the removed domain preference.
