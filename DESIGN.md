# Pomi App Design Guidelines

## Required Use

- Read this file before any app development, including frontend, UI, UX, layout, Tauri window behavior, or user-facing interaction changes.
- Apply these rules during planning, implementation, refactoring, screenshots, and review.

## Desktop Window

- Desktop sizing is configured in `packages/frontend/src/constants/window.ts` via `WINDOW_WIDTH`, `COLLAPSED_HEIGHT`, and `EXPANDED_HEIGHT`.
- Optimize all layouts and UI components for a compact, vertical desktop footprint, while keeping components responsive to runtime window size changes.
- The expanded desktop window may be taller than the original timer-only layout so work timers can reserve space for the Minimized task view or its setup placeholder without crowding timer controls.
- Task planning introduces an optional intermediate desktop state where the work timer remains minimized and the shared Minimized task view appears underneath when the minimized task setting is enabled; treat that as distinct from the full expanded view.
- When task placeholders are dismissed or unavailable, timer layouts should reclaim that reserved space so the timer circle can be as large and centered as the viewport allows with only modest side margins.
- Essential UI elements should fit above the fold whenever possible.
- Avoid scrolling for primary workflows.

## Navigation And Layout

- If a view requires scrolling, consider a fixed toolbar or header for essential controls such as back, save, and primary actions.
- Keep long content scrolling beneath fixed controls.
- Preserve dense, scannable layouts suited to a compact desktop app.
- `Mod+T` expands the app when needed, opens the Tasks view, and focuses and selects the quick-create input; when already in Tasks view it only focuses and selects that input.
- In the expanded Timer while the Minimized task view is visible, `Mod+I` switches that Task surface to Intention mode. Elsewhere `Mod+I` keeps its Intention-picker behavior; `Mod+F` is not used for this Task-mode action.
- The expanded Timer also opens the Tasks view through a top-navigation affordance on every device; the Tasks view returns through its back affordance.
- If Tasks is off, Tasks view entry points should be hidden and should not open a disabled Tasks view; setup happens through placeholders or Settings.
- Mobile Timer layout uses the same Minimized task view concept as desktop, adapted responsively rather than moved into a bottom sheet; Break and Long-break placement follows the “Tasks during breaks” setting.
- The Minimized task view is shared between the expanded Timer view and the optional minimized Timer task state. It appears for Work and, when enabled, matching Break or Long-break Task Timer types.
- The Minimized task view shows up to three visible Tasks on both mobile and desktop; extra matching Tasks use paginated controls like the Intentions picker without resizing the Timer. Pages are filled with Pinned Tasks first, followed by peer or general Tasks.
- The minimized timer intentions picker may show four visible intentions when spacing allows, with pagination arrows close to the visible intention choices. This does not change the expanded timer intentions picker count.
- Every intention picker, including Wear OS, drills into active Sub-intentions when a Parent has children; the Parent itself is not selectable until it has no active children. Timer, Task, log, Tile, and watch-face displays keep the selected Parent and Sub-intention visually paired.
- Task surfaces use a compact Intention/General segmented toggle to switch the current timer's task mode.
- Full Tasks view provides a compact filter-icon menu for All / Work / Break / Long break Task Timer types and shows the active choice. All is the default. Every mixed-type Task list, including archive and import review, shows a compact text-only type badge; a type-specific list hides that redundant badge.
- The Tasks view Intention filter is Task-Timer-type-aware: All groups Intentions by Work, Break, and Long break; a specific type shows only matching Intentions. Switching type clears an incompatible selected Intention with a brief notice.
- Task import review lets each row choose Work, Break, or Long break and limits its Intention choices to that type; missing legacy import values default to Work.
- “Tasks during breaks” is off by default. When enabled, expanded Break and Long-break layouts mirror Work: Intention picker or skeleton at the top, Timer in the middle, and matching Task Timer type surface at the bottom.
- Watch Tasks screen always shows Tasks for the current Timer type, Pinned first, with Work as fallback when no Timer exists; the desktop/mobile “Tasks during breaks” setting does not gate Watch.
- Intention-filtered task surfaces can show a dimmed General preview with a clear switch action when broader tasks are hidden by the current task mode.
- Task creation and editing from the expanded Timer use the same centered modal and complete field set as the full Tasks view, including RRULE-compatible recurrence editing.
- List items use the same inline destination, due-date, and priority controls as Tasks. Their destination control shows the current List and can convert the item back to a Work Intention; completion remains the List-specific extra control.
- Assistant confirmations name a single created Task or List item and expose the same View action for either destination.
- Desktop scrolling over the Minimized task view and expanded intentions picker must not change pages; use the visible pagination controls instead. Mobile swipe paging remains available where the layout exposes it, and the minimized intentions picker keeps its existing behavior.
- When statistics covers both timer/intentions and tasks, provide a clear mode switch between those statistic families.
- Settings uses the same centered Back/title/action header as Statistics; Back, Feedback, and the page title scroll normally. A full-width compact search below it is the only sticky Settings navigation and filters individual controls while retaining their section headings. A match on any part of a compound control, including Work, Break, or Long-break badges, keeps the complete titled control visible. General, Timer, Notifications, and Shortcuts remain permanent sections; Sessions, Intentions, Tasks, and Assistant use the same compact activation header and visible Essentials and Personalize groups. Keep labels short, move implementation details into small hover/focus help controls, and use restrained icons to make optional settings easier to scan. Disabled features remain discoverable through their activation action while hiding configuration. Administrator controls live inside General and are rendered only for administrators; the user-facing Assistant feature remains separate.
- Settings is the sole authority for Task due notifications. A checkable priority selection defaults to High and Urgent, may be empty to disable Task reminders, and applies immediately to every active Task; Tasks do not store reminder choices. A qualifying Task sends one normal Task reminder at its due instant, with a configurable before-due offset and 10:00 local fallback for date-only Tasks. Repeating overdue urgent reminders default to every 30 minutes, use the same ordinary Task-reminder path on every device, and stop when the Task is completed, archived, loses its due date, stops being Urgent, or Task/notification/repeat settings no longer allow them.
- Prefer existing primitives from `packages/frontend/src/components/ui` for shared patterns.

## Buttons, Tooltips, And Shortcut Hints

- Prefer icon-only buttons in compact action toolbars when the icon is recognizable. Every icon-only button must still have a concise accessible label and a matching tooltip; do not add a permanently visible text label only to explain the button.
- Simple action, icon, and text hover hints use the native `title` attribute instead of custom tooltip overlays. Keep custom popovers only for interactive help, chart/data detail, and a full-page Task title that is actually truncated.
- Treat tooltips as hover or focus help. Static screenshots, mockups, and generated design concepts should show them only when the specific hover or focus state is being demonstrated.
- On desktop, keyboard shortcut badges are contextual overlays. Hide them in the normal state, reveal them while the user holds `Mod` (`Command` on macOS or `Ctrl` elsewhere), and hide them again when the modifier is released.
- Keep a shortcut badge permanently visible only when the interaction explicitly opts into an always-visible hint, such as a transient keyboard-driven choice where the available keys need to remain discoverable. Do not generalize those exceptions to ordinary navigation, timer, intention, or Task buttons.
- Static screenshots, mockups, and generated design concepts should use the normal state without shortcut badges unless they are specifically illustrating shortcut discovery or an always-visible exception.
- Shortcut badge visibility does not reduce keyboard coverage: desktop workflows should remain operable from the keyboard even when their badges are hidden.

## Confirmed user actions

User-triggered mutations are submitted through the backend action gateway and are rendered from confirmed server state. The shared app queue is application-scoped, FIFO, and remains visible across navigation. Its compact indicator is fixed at the bottom-right, appears after one second, shows a count badge when more than one action is active or queued, and opens ordered details on hover, focus, or tap. Clearing the queue removes unsent actions; an accepted or running head remains until its terminal lifecycle is reconciled.

Wear uses the same lifecycle without local optimistic projection or persisted replay. Its 20dp loader sits in the 38dp top-center slot between Tasks and Assistant, with a small upper-right count badge and no dismissal/details affordance.

## Microcopy

- Keep text, labels, and tooltips brief.
- Avoid filler words.
- Prefer high-density labels that can be scanned instantly.
