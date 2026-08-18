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
