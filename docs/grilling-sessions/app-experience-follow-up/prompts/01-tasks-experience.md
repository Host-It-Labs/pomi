# Grill Session: Tasks Experience

- Pack: [index.md](../index.md)
- Original request: [original-prompt.md](../original-prompt.md)
- Assigned output: [output](../outputs/01-tasks-experience.md)

## Focus

Decide the complete Tasks experience as one coherent product topic across desktop, mobile, and Wear: Task-card density and metadata, direct property editing, mobile description navigation, favorite filters, default and manual ordering, delayed/confirmed action feedback, and the expanded Task statistics model.

Keep implementation details subordinate to product behavior. Resolve these connected decision areas:

- Which metadata appears in the minimized Task view versus the full Tasks view: recurrence without “Every”, removal of the Voice badge, removal or recoloring of Work/Break/Long break badges, two-line titles in the full view, “Due … ago” copy, pin size/placement, and Intention emoji placement.
- Which visible attributes are directly editable from each surface. The request names due date, recurrence, Task priority, and Intention. Decide the interaction for each, including calendar/picker behavior, priority cycling order, finger-occlusion feedback, cancellation, keyboard/accessibility behavior, persistence timing, and whether the title/body remain non-clickable.
- Task editor density, especially the recurrence interval/unit width split and the requirement that recurring Tasks still need a due date.
- Native mobile back while a Task description is open: close the modal and remain in Tasks before any page-level return to Timer.
- Favorite Intention filter layout: reserved first-row height after favorites exist, deterministic one-row versus two-row behavior, when labels collapse to emoji-only, and where the Timer-type filter sits relative to sorting.
- Default order for Tasks without due dates: priority from urgent to low, then newest versus oldest within the same priority. Reconcile that with the existing documented due-aware Task order.
- Manual ordering for every active Task, including dated Tasks: top/bottom ceiling and floor semantics, how manual anchors coexist with newly created or automatically re-ranked Tasks, whether filtering/search/sort modes permit dragging, how overridden rows are distinguished, and how reset returns to automatic order.
- What happens when an inline property change would move a Task: how long the row stays put, what “updating Task position” communicates, when the confirmed order becomes authoritative, and how the user jumps to the new location without violating the confirmed-action gateway.
- Wear Task completion feedback: strike through the Task after the completion action is accepted, keep it visible until backend confirmation, then remove it. Decide rejection/unknown-outcome recovery without projecting confirmed completion.
- Task statistics information architecture: Completed and Archived as filters, Overdue/On time as Completed subfilters, created-task counts, recurring-task counts, general inventory counts, time periods, Intention ranking/heatmap behavior, and a compact understandable control hierarchy.

## Dependencies and shared constraints

- Read root `CONTEXT.md`, root `DESIGN.md`, ADR 0001, ADR 0011, ADR 0012, `packages/frontend/src/pages/Tasks.tsx`, `packages/frontend/src/components/MinimizedTaskView.tsx`, `packages/frontend/src/components/tasks/TaskFormModal.tsx`, `packages/frontend/src/components/tasks/TaskDescriptionModal.tsx`, `packages/frontend/src/utils/taskView.ts`, `packages/frontend/src/stores/tasksStore.ts`, `packages/backend/src/tasks/tasks.service.ts`, `packages/shared/src/types.ts`, `packages/frontend/src/pages/Statistics.tsx`, and Wear `TasksActivity.kt`.
- Current manual ordering is intentionally limited to all active undated Tasks, with `manualOrderOverride` inserted into automatic priority order. Dated Tasks are rejected by the backend reorder contract.
- Current undated priority comparison uses urgent, high, normal, low, then oldest creation time first. The request proposes newest first within priority.
- `TaskFormModal` already blocks recurring Tasks without due dates.
- Desktop/mobile Task completion waits for confirmed action completion before removing the row. Wear currently disables completion and removes only after refreshed status, but no longer shows the prior strike-through acknowledgment.
- ADR 0012 forbids optimistic Wear domain projection. A transient accepted-action affordance may acknowledge input, but must not claim confirmed completion.
- Current Task statistics are event-based and cannot answer created/current/recurring inventory questions without an expanded data contract.
- Surface-specific rules must be explicit. Do not assume a compact-view change also applies to the full Tasks view, or vice versa.
- Surface only non-Task Timer, Assistant, Tile, or Wear-shell implications to Session 02.

## Instructions

Use `$grill-with-docs`. Read `original-prompt.md`, `index.md`, this assigned prompt, the relevant code and documentation, and the assigned output before questioning the user. Inspect the repository to resolve facts instead of asking the user.

Grill one decision at a time and always recommend an answer. Stay within Task behavior and Task statistics on every client, including Wear completion acknowledgment; surface non-Task Timer, Assistant, Tile, fixture, or diagnostic implications without deciding those tracks.

After each confirmed decision, update only the assigned output file. Record rationale, rejected alternatives, consequences, repository evidence, proposed `CONTEXT.md` changes, cross-track implications, and unresolved issues.

Reach explicit shared understanding, mark the output `complete`, and stop without implementation. Leave `CONTEXT.md`, ADRs, other session files, and product code unchanged.
