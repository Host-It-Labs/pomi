# App Experience Follow-up

Status: Accepted

Pomi will refine Tasks, Timer and Assistant surfaces, Wear parity, local Copyme startup, and AI debug-log inspection as one coordinated experience update. The decisions preserve confirmed server-state rendering from ADR 0012, keep compact workflows predictable across desktop, mobile, Wear app, and Tile, and make local development startup constant-size when Copyme is healthy.

## Tasks Experience

- Mixed-type full Task lists show colored Break and Long-break badges and omit Work; type-specific and Minimized task views show none. Voice creation-source badges are removed without deleting provenance.
- Full and minimized rows show repeat icon plus compact cadence without “every,” and past due copy becomes `Due {duration} ago`. Full titles wrap to two lines; minimized titles stay one-line truncated. Row bodies and titles remain inert.
- The minimized pin button keeps its size and placement and may carry a display-only Parent/Sub-intention emoji badge. The full linked-Intention emoji opens a draft chooser; Apply submits one confirmed change, while Cancel, Escape, or outside click discards it.
- Due metadata opens a draft calendar with explicit Clear. Date changes preserve time; Clear removes date and time and is unavailable for recurring Tasks. Existing simple recurrence opens a draft interval/unit/anchor picker with Remove; complex rules route to the full editor without lossy conversion. First recurrence remains an editor action.
- Priority cycles low, normal, high, urgent, then low. It submits one confirmed action, locks while pending, keeps confirmed row state, and shows accessible local pending, one-second confirmed, failure, or checking feedback.
- Recurrence cadence fields use equal widths without inline “Every.” Mobile back closes Task description before leaving Tasks and preserves page state.
- Favorite filters reserve known-user height during refresh. They use one labeled row when it fits, otherwise uniform emoji-only badges in at most two paged rows. Timer-type filtering moves beside Sort.
- Default order keeps Pinned and relevance grouping. Overdue Tasks sort priority-first immediately after their due instant; upcoming dated Tasks sort by date, time, then priority; undated Tasks sort priority then newest. Date-only Tasks become overdue after local end-of-day. The overdue grace setting and concept are removed everywhere.
- Every active Unpinned Task can take an absolute manual slot in the complete default list. Top/bottom are durable edge anchors; occupied insertion shifts later anchors; automatic Tasks fill free slots. Pinned Tasks stay pin-time ordered above and preserve dormant anchors until unpinned; completion/archive clears anchors. Manual handles appear only in the unfiltered default full list, use an indigo state plus adjacent Reset when overridden, and never cross the Pinned boundary.
- Reorder renders authoritative order until confirmation. Confirmed inline edits that change automatic position immediately render the new authoritative order without a separate refresh affordance.
- Wear completion shows accepted-but-unconfirmed acknowledgment by striking and muting the row with a spinner and disabling repeat input. Terminal confirmed refresh removes it. Rejection restores it with failure; unknown outcome restores confirmed presentation but keeps completion disabled until refresh resolves it.
- Task statistics switch between Overview and Activity. Overview counts active total, recurring, overdue, undated, and Pinned. Activity has Created, Completed, and Archived; Completed alone has All, On time, and Overdue. Created counts initial Task creation only and is backfilled from `createdAt` with documented best-effort historical metadata snapshots. Completed counts every occurrence; undated completions are only in All. Activity retains Today/Week/Month/Year cards, one-year heatmap, and Intention ranking with its own period selector, using immutable event-time snapshots and `No Intention`.

## Timer, Assistant, and Wear

- Expanded parent Intentions always use nine stable 3x3 slots for every Timer type and placement, including under 700 px through a compact no-scroll composition. Sub-intentions remain six in one row. The expanded desktop shell is exactly 700 px.
- Expanded Timer composition uses one relational spacing contract across Work, Break, and Long break. Extension availability never reduces picker density. `Mod+D` opens extension options; eligible paused Break and Long-break Timers keep the action after running or prior extensions. Work and Work-extension Timers retain ordinary `+5` and cannot recursively create extension opportunities.
- Editing from compact Minimized timer first expands Timer, then opens the shared Task editor; closing leaves expanded Timer visible.
- One application-scoped Assistant session owns recording, processing, results, and errors across navigation and collapse. Idle launch remains expanded-Timer-only; active control stays in the Timer slot, follows other page headers after Back, and uses compact top-right presentation in collapsed Timer.
- Recording shows Stop square plus elapsed time and separate Cancel, without modal chrome, transcript, denominator, microphone, or “Listening.” Stop submits; Cancel discards. Maximum duration and genuine app backgrounding auto-Stop once; desktop focus loss does not. Authentication loss cancels. Connection loss preserves capture and queues exactly one in-memory submission on Stop, without persisted audio replay.
- Processing remains visible and non-dismissible until confirmed resolution. Success shows `Done` for at least three seconds and until response audio ends; concise detail uses audio and in-app notification. Error persists with Record again and Dismiss; Record again starts fresh and never resubmits old audio. Other modals do not interrupt capture and active controls remain operable above them.
- Wear recording uses an edge-to-edge filled Stop button with square, label, elapsed time, pressed state, and separate Cancel. It follows the same stop, cancel, background, duration, auth, and connection semantics.
- Wear Long break matches other secondary action visual size, while all secondary targets remain at least 48 dp. The no-Intention glyph is 26 sp. Authenticated Intentions navigation always opens during loading, refresh, offline, or queued actions; unauthenticated navigation opens Login.
- Wear app and Tile share one pure presentation/behavior model and state-matrix tests for ring math/colors, time, Session dots, Intentions, Tasks/Assistant placement and availability, action order/hierarchy/visibility/enabled state, and confirmed-action behavior. Only documented renderer constraints may differ.
- `release:wear` first guides verification of the main wireless-debug address, then separate pairing only if that address still fails. Automated recovery is bounded to reconnect, ADB restart, wait/state/model checks, normal install, one `--no-streaming` retry, and focused diagnostics; it does not clear trust, uninstall, restart networking, kill unrelated processes, or reboot devices.

## Development Fixtures and Diagnostics

- Copyme uses fixture-specific metadata with a monotonic seed version and non-plaintext credential fingerprint. One indexed startup lookup verifies marker, user, admin, version, and configured credentials; it never scans preferences, Intentions, Tasks, events, or statistics on the healthy path.
- Marker mismatch automatically and atomically deletes/reseeds disposable Copyme. Infrastructure failures exit nonzero with phase, concise cause, and exact recovery command. Seed-version bumps are explicit for fixture semantics, not migrations or source hashes. Startup never refreshes statistics by age.
- `pnpm seed:copyme` always performs a clearly described destructive full rebuild. Startup scripts call a separate internal ensure entry point. There is no separate Verify command.
- Copyme enables all safe in-app capabilities, including Tasks during breaks, minimized Tasks, extension, undo, Assistant, transcript retention, and persistent debug logging. Contradictory auto-starts and OS/global side effects remain off. No overdue-grace preference is seeded.
- Fixture data is a representative matrix across Timer types, Task states/priorities/due states/recurrence/reminders/manual positions/events, Parent/Sub-intentions, durations, and statistics. It does not seed runtime Timer/Session Redis state, secrets, models, budgets, or fake debug logs.
- AI debug logs load on page entry and explicit Refresh only. Initial load reserves stable skeleton height; refresh keeps current content with a small busy state. Empty, initial error, and stale refresh error are distinct.
- Refresh preserves expanded row and viewport anchor by stable log ID. Confirmed mutations update narrowly: flag patches one row; clear/disable empties only after success; enable updates status without teardown. Failures preserve content and expose inline feedback.

## Considered Options

- Retaining a configurable or fixture-only overdue grace was rejected because one immediate due boundary must govern UI, ordering, statistics, logs, alarms, and fixture data.
- Optimistic Task and Wear projections were rejected in favor of accepted-action acknowledgment plus authoritative reconciliation.
- Six-slot expanded Work pickers, page-specific shell heights, scrolling primary Timer workflows, and extension-driven density changes were rejected as unpredictable composition.
- Timer-owned Assistant state, modal results, background microphone capture, and persisted audio replay were rejected for lifecycle, privacy, and duplicate-action risks.
- Pixel-identical Wear app/Tile rendering and screenshot release gates were rejected in favor of shared rules and contract tests that accommodate platform constraints.
- Broad Copyme health scans, automatic monthly refresh, source hashes, migration invalidation, and non-destructive manual seeding were rejected because they slow startup or obscure the fixture lifecycle.
- Polling/realtime debug logs and full-list refetch after every mutation were rejected because Debug is an inspection surface and list churn destroys reading context.

## Consequences

- Shared contracts, migrations, frontend/Wear renderers, fixture scripts, statistics persistence, and focused E2E/native tests must change together.
- All user mutations continue through ADR 0012's confirmed FIFO gateway; temporary pending visuals acknowledge accepted work without claiming domain success.
- Existing Task creation history receives exact dates but may have approximate pre-migration metadata breakdowns; new event snapshots are exact.
- Copyme is explicitly disposable. Developers must use another fixture for valuable local data and invoke full reseed when a valid marker hides unintended drift.
- Layout verification must cover short/700 px Timer compositions, all Timer types, picker placements, Minimized task presence, extension states, and app/Tile state parity.
