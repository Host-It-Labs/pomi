# Realtime scaling

Pomi uses the Socket.IO Redis adapter. Every authenticated socket joins a
per-user room, so Timer, Preferences, Task, notification, and accepted-action
events reach the user even when the mutation and socket are handled by
different backend instances.

When more than one backend instance serves `/socket.io`, the load balancer must
use sticky sessions because clients retain HTTP long-polling as a fallback when
WebSocket upgrades fail. The proxy read timeout must exceed Socket.IO's combined
ping interval and ping timeout. Redis must be shared by every backend instance.

The Redis Pub/Sub adapter does not persist missed packets. Authoritative state
still comes from PostgreSQL and Redis domain state; reconnecting clients refresh
Timer state and accepted actions reconcile through their HTTP status endpoint.

## Timer scheduler and Watch query rollouts

The distributed Timer scheduler listens for Redis schedule-change wakeups and
also scans the earliest deadline under a five-second, lease-renewal-bounded
fallback. A missed Pub/Sub packet therefore delays work only until the next
bounded scan; it cannot skip a completion. If Pub/Sub must be disabled during a
rollback, restart the backend with `POMI_TIMER_SCHEDULER_WAKE_MODE=poll` to use
the same bounded deadline polling without the subscriber.

`GET /watch/status` uses the bounded Watch Task query by default. Set
`POMI_WATCH_STATUS_TASK_QUERY_MODE=shadow` during rollout to compare its ordered
rows and counts with the legacy full-list path while returning the bounded
result. Set it to `legacy` and restart the backend for an immediate rollback;
bounded-query failures also fall back to the legacy path for that request.

## TypeScript 7 compatibility and rollback

TypeScript 7.0.2 is installed in every package workspace. The root tooling
keeps an exact TypeScript 6.0.3 devDependency because the current stable
TypeScript-ESLint 8.x line declares a peer range below 6.1.0, and Nest CLI and
ts-node still require the programmatic compiler API. ESLint and the backend's
compatibility entry points therefore use TypeScript 6, while direct package
builds and tests resolve TypeScript 7 from their own workspace manifests. If a
future package-compiler incompatibility requires a TypeScript 7 rollback,
temporarily set the four workspace TypeScript pins to `6.0.3`, regenerate
`pnpm-lock.yaml` with Node 26 and pnpm 11.23.0, and rerun `pnpm lint`,
`pnpm -r run build`, and the focused tests before restoring the TypeScript 7
pins.
