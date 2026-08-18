# Project Deterministic Watch Actions Before Synchronization

Status: Superseded by ADR 0012.

Wear OS and Tile project deterministic timer controls, Intention selection, Session position, and Task completion immediately, then send commands through one shared persisted ordered queue with server-side atomic claims for idempotency IDs. Normal fast synchronization shows no busy state; after roughly two seconds a subtle Syncing or Offline state appears without dimming or disabling controls. Transient failures keep the projected state and retry across reconnects or app restarts; definitive server rejection fetches authoritative status, rolls back, and shows a sync failure. Voice and AI actions wait for their result because their outcome cannot be projected safely.
