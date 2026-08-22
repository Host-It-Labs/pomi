# Grill Session: Timer, Assistant, and Wear

- Pack: [index.md](../index.md)
- Original request: [original-prompt.md](../original-prompt.md)
- Assigned output: [output](../outputs/02-timer-assistant-and-wear.md)

## Focus

Decide the Timer and Assistant experience across desktop, mobile, the Wear app, and the Wear Tile as one cross-device product topic, including the physical-Wear release path needed to keep those surfaces usable.

Resolve these connected decision areas:

- Apply the nine-slot, three-by-three Intentions picker to Work Timers as well as Break and Long-break Timers. Decide whether nine slots apply at every expanded placement and viewport, how short screens degrade, and whether sub-Intention pagination remains six slots.
- Increase the desktop expanded window from 690 px to 700 px and shift the central Timer stage roughly 20 px. Define the intended spacing relationships among top navigation, picker arrows, Timer circle, minimized Task view, and bottom controls on every Timer type.
- Extension-state layout: prevent the three-by-three picker from touching Break/Long-break time, preserve normal spacing in minimized mode, and specify whether extension state changes picker density.
- Timer extension action: choose a non-conflicting shortcut, show the action whenever a Break/Long-break Timer is paused and extension is available, preserve it after the Timer has run and paused, and preserve it after one or more extensions. Clarify whether Work extensions follow the same rule.
- Editing a Task from the minimized Timer must expand to the full Task editor before opening, matching advanced Task creation behavior.
- Replace the Assistant recording modal on desktop/mobile with an in-place header control: smaller stop square, elapsed time only, separate cancel affordance above it, and clear states for recording, processing, result, and error.
- Make recording application-scoped so it continues and remains controllable while navigating among Timer, Tasks, Statistics, Settings, Intentions, and Debug pages. Decide stable header placement on pages with different chrome and behavior when another modal opens.
- Distinguish Stop (submit recording) from Cancel (discard recording), automatic maximum-duration stop, navigation, app backgrounding, authentication loss, and connection loss.
- Wear Assistant recording control: a bottom button that visibly looks pressable, shows a stop square, says Stop, displays elapsed time, and preserves the watch’s edge-to-edge bottom shape. Apply the same Stop-versus-Cancel semantics where the Watch surface permits them.
- Make the Wear Long break action roughly 25–30% smaller or exactly the same visual size as the other Timer actions. Decide the canonical size and accessible touch target.
- Make the Wear no-Intention dot substantially larger and reliably tappable. Distinguish visual size, hit target, auth/loading states, and navigation into the Intentions picker.
- Make the Wear Tile visually and behaviorally match the Wear app. Define parity across Timer ring, time, Session dots, Intentions, Assistant, Timer actions, colors, sizes, and enabled states while respecting Tile constraints.
- Establish a durable app/Tile parity boundary through shared presentation rules, tests or snapshots, and release evidence.
- Improve `release:wear` guidance: verify the current IP address and main Wireless debugging port before re-pairing, and show pairing instructions only after the verified address still fails.
- Reduce Mac-restart dependence after ADB server restart and install failure. Decide safe automated recovery escalation, useful diagnostics, and the stopping point before broad host changes.

## Dependencies and shared constraints

- Read root `CONTEXT.md`, root `DESIGN.md`, ADR 0003, ADR 0004, ADR 0006, ADR 0009 only as superseded history, ADR 0012, `packages/frontend/src/App.tsx`, `packages/frontend/src/pages/Timer.tsx`, `packages/frontend/src/pages/MinimizedTimer.tsx`, `packages/frontend/src/pages/timer/ExpandedIntentionsPicker.tsx`, `packages/frontend/src/components/MinimizedIntentionsPicker.tsx`, `packages/frontend/src/components/TimerActionButtons.tsx`, `packages/frontend/src/components/assistant/AssistantLauncher.tsx`, `packages/frontend/src/components/MinimizedTaskView.tsx`, `packages/frontend/src/stores/uiStore.ts`, `packages/frontend/src/constants/window.ts`, Wear `WatchFaceActivity.kt`, `PomiTileService.kt`, `WatchHomeState.kt`, `WatchUi.kt`, `AssistantActivity.kt`, `WatchActionQueue.kt`, `WatchHomeStateTest.kt`, `scripts/deploy-watch.sh`, and the Wear section of `README.md`.
- Current expanded picker chooses six or nine items based on Timer type, placement, device class, and a 700 px short-viewport threshold.
- Current expanded desktop height is 690 px; Timer circle positioning has separate desktop and mobile paths.
- Current minimized extension action uses `T` and appears only when a paused Timer is still at its original duration.
- Current `AssistantLauncher` owns MediaRecorder state locally and is mounted only in `Timer.tsx`; moving the visual alone cannot make recording survive navigation.
- Assistant actions remain confirmed through ADR 0012. Do not make voice results optimistic.
- Wear app and Tile are distinct renderers. They share some presentation helpers but can still drift.
- The Wear no-Intention control currently uses a `○` glyph inside a 32 dp control. Clickability can also be affected by coordinator/auth/loading state.
- The release script already validates and stores IPv4:port, retries connection after `adb kill-server`/`start-server`, and prints pairing instructions. Build/install failures are warnings.
- Session 01 owns Task-card, Task ordering/statistics, and Wear Task-completion acknowledgment. This session owns only the shell transition required before editing from the minimized Timer.

## Instructions

Use `$grill-with-docs`. Read `original-prompt.md`, `index.md`, this assigned prompt, the relevant code and documentation, and the assigned output before questioning the user. Inspect the repository to resolve facts instead of asking the user.

Grill one decision at a time and always recommend an answer. Stay within cross-device Timer/Assistant composition, Wear app/Tile parity, Wear release recovery, and the minimized-to-full editor transition; do not decide Task behavior/statistics or fixture behavior.

After each confirmed decision, update only the assigned output file. Record rationale, rejected alternatives, consequences, repository evidence, proposed `CONTEXT.md` changes, cross-track implications, and unresolved issues.

Reach explicit shared understanding, mark the output `complete`, and stop without implementation. Leave `CONTEXT.md`, ADRs, other session files, and product code unchanged.
