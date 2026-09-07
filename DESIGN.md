# Pomi App Design Guidelines

## Required Use

- Read this file before any app development, including frontend, UI, UX, layout, Tauri window behavior, or user-facing interaction changes.
- Apply these rules during planning, implementation, refactoring, screenshots, and review.

## Visual language

Desktop and mobile use blue for Work, sage for Break, and dark teal-green for Long break across decorative accents, with task quick-create Add always blue. Use the accepted Midnight navy background palette, with distinct raised task surfaces. Preserve semantic status colors. Keep contrast clear without purple foundations, glow, or stark white chrome. Use subtle pressed, selection, paging, and sheet transitions; respect reduced motion. Wear OS and the public website keep their own visual systems.

## Desktop Window and workspace

- Keep the expanded desktop window at 440 × 700. Navigation, six intentions, and the compact timer remain stationary. Give task rows at least half the usable main-page height.
- The expanded intention picker has six stable 2 × 3 slots, emoji, concise names, selected states, and compact pagination. Preserve Parent/Sub-intention selection, multi-selection, keyboard shortcuts, and optional habit/count information. Habit summaries use compact icons and counts with accessible explanations.
- Place the Work/Break/Long break label in a shallow row above the centered countdown. Align session ring, optional ETAs, previous-timer extension, countdown, and actions on the row beneath; place play/pause closest to the countdown, followed by a separator and timer actions. The previous eligible Work timer remains extendable throughout the following timer, including while it runs; extension reassigns elapsed time to the previous timer and restarts the following timer afterward. Expanded and minimized layouts share countdown and session progress components; only minimized mode includes its compact intention picker.
- Session segments are directly selectable by pointer or keyboard, without a details popup. Preserve elapsed progress direction and extended/stacked duration weighting. Optional ETA timestamps sit beside the ring with accessible clock and finish labels; hide inline ETAs at constrained widths while retaining segment tooltips. ETAs are off by default.
- Embed the full task workspace beneath the timer. Desktop shows five rows per page, each with a two-line title; Up/Down changes pages outside inputs and dialogs. Desktop clips task overflow without allowing scrolling; page changes fade without positional animation. Mobile scrolls task rows independently.
- Keep quick creation and destination selection immediately available. Voice, full-editor, and Add actions sit inside the quick-create field. All/destination, Search, Sort, and Filter share one row. All and Search always have equal widths. Anchor the destination dropdown to the left edge of its trigger at 30 px wider than the trigger, capped to the viewport. Preserve backend usage ranking for Intentions followed by Lists; show Sub-intentions as wrapping emoji-only controls with accessible names. A thin All / Intention switch appears to the left of the precisely centered task pager beneath filters, with four favorite destination emoji shortcuts per page on the right immediately before reset; archive, import, and Vacation actions belong in overflow. List creation is available in the intention creation sheet.
- Tasks remain available during Work, Break, and Long break whenever enabled. Each timer shows only Tasks assigned to its own type, including in All mode and search. A View action for another timer type explains when the Task is available; it must not override this filter or change the active timer. Start with All and preserve explicit destination filters across timer changes. Intention mode follows current Timer selections and shows only matching Tasks, including parent-only matches for selected Sub-intentions. Search narrows the chosen scope. Switching modes clears an explicit destination; choosing a destination exits Intention mode. There is no separate Tasks page or Tasks during breaks preference.
- Preserve pinning, inline edits, recurrence, List views, contextual creation, confirmed saves, and completion undo. Minimized mode retains its compact task surface.
- `Mod+T` expands the app and focuses quick creation. `Mod+N` also focuses quick creation; the full editor is opened through its explicit button. `Mod+Shift+F` clears search, filters, selected List, and sort back to the normal list. Repeated focus shortcuts blur the targeted input or close its picker; Escape also blurs those inputs and closes dropdowns without clearing drafts. Window expansion remains available from focused inputs. Shortcut actions must respect open editors.
- Assistant View actions and notification reveals route to the embedded workspace and reveal the target page.

## Editors

Use shared content-sized bottom sheets for Tasks, Intentions, and Lists. Title, Close, and Save remain fixed while fields scroll inside. More options is centered with a subtly raised background among the fields above the action footer. Edit Intention uses a quiet Cancel, primary Save, and a header overflow for management actions. More options reveals extra fields and expands toward the available height without losing edits. Sheets use intrinsic content sizing and must never grow while idle. Extra fields always follow all essential fields instead of appearing between them. Account for the mobile keyboard and safe areas; expand the app before editing from minimized mode.

Task essentials are Title, Description, destination/timer type, due date and time. Place timer type and destination on one row, and date and time on one row; priority belongs in More options. Recurrence, duration, follow-up, and Vacation Coverage are additional options. Intention essentials are name, emoji, timer type, and Parent/Sub-intention relationship; habit, duration, linked Tasks, and description are additional options. Preserve validation, dirty-close confirmation, focus restoration, and backend-confirmed saves. Creating an Intention leaves the background page in place and shows a success toast.

## Statistics and Settings

Keep the compact Statistics cards, charts, and mode switches. Completed activity always includes every completion, including undated occurrences; retain historical completion metadata.

Settings keeps full-width sticky search that finds individual controls, including collapsed options and dismissed suggestions. Search reveals matching groups. Automatic actions, timer resets, long-break detection, and notifications remain prominent; passive customization belongs under collapsed More options.

You might like shows up to two relevant disabled tools in stable order. Provide a feature-specific icon, benefit, enable/setup action, and Not interested. Confirm Not interested in a modal explaining that the setting remains available below and through Settings search. Dismissals persist per account across devices and export/import; they never disable a feature or remove its searchable control. AI infrastructure lives in a separate admin-only AI administration page linked from General; the link and its search entry are admin-only, with backend authorization preserved. Ordinary Assistant preferences remain separate.

For new accounts, enable Tasks, Intentions, Sessions, Lists, custom intention durations, Sub-intentions, advanced skip, and timer extension. Keep optional display clutter, habits, multi-selection, minimized tasks, and Vacation tools off. Preserve existing users' choices and existing automatic-action, permission, notification, and Assistant defaults.

Use the existing UI primitives. Keep all device-specific interactions accessible by keyboard, with visible focus, adequate touch targets, and no horizontal overflow. Keep local development's visible context slug current as required by AGENTS.md.

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

Overdue Task rows keep their normal surface background while retaining red status text and icons. Minimized selected-intention emojis start at the countdown upper-right edge, with further emojis extending rightward.

The destination trigger reflects the effective task scope: All, a single destination name, or selected timer intention emojis for multi-selection. Favorite shortcuts choose one destination and exit Intention mode without changing the timer. A selected destination leaves both mode buttons off; Mod+G toggles All/current Intentions and returns a destination-filtered view to All. Manual task reordering is removed across clients and the backend.

Favorite shortcuts keep room for up to four emojis and both paging arrows. Center the visible favorites between the task pager and Reset, including partially filled pages. Task page counts use a fixed width with tabular numerals; hover or keyboard focus replaces a non-first page count with a return-to-page-one action. The All/Intention switch shares one centered Mod+G hint. Task update toasts use the fixed Work blue; View selects the destination page before focusing its row.
