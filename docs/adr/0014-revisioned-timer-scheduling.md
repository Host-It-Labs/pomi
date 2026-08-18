# Revisioned Timer Scheduling Foundation

Status: Accepted

Timer runtime writes are fenced before durable deadline consumption is enabled. Every successful current-Timer write receives a fresh `scheduleRevision`; callers must provide the Timer ID and revision they read. Stale writers return a conflict instead of overwriting a newer pause, resume, duration change, warning claim, completion claim, or Timer replacement.

The same Lua write atomically maintains one completion member per user in `pomi:timer-schedules:completion`. Running Timers are scored at `startTime + duration`; paused and completed Timers have no member. Warning and completion claims update the revision and index in their existing Redis-time claim scripts. Imports intentionally replace state with a fresh revision and matching index.

Timer companion state has a separate per-user runtime revision. Session state coupled to a Timer transition is committed inside the Timer CAS. Other TimerStore mutations advance the runtime revision atomically. Whole-runtime operations such as intention-slug rename export a stable revisioned snapshot and replace it only if both the current Timer and runtime revision still match. Undo and redo peek history, fence the runtime snapshot, and atomically transfer the exact history entry to the opposite stack with the Timer/session transition before applying idempotent history effects; a losing writer leaves history untouched.

The completion index is dormant in this phase. Existing countdown and startup recovery remain authoritative. No worker may consume the index until completion transition and event creation are atomic, PostgreSQL completion effects are idempotent, notification delivery has a durable outbox, and overdue state is backfilled under distributed ownership. This ordering lets the later worker remove replica-multiplied polling without trading it for lost or duplicated completion effects.
