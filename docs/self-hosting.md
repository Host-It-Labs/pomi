# Self-hosting

## Production backend

Copy `packages/backend/.env.production.example` to a private path. Set only the
three required secrets: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, and
`JWT_SECRET`. Generate them with a cryptographically secure password generator;
do not use the development values.

Generate each secret separately so the three services do not share a value:

```bash
openssl rand -hex 32
```

- `POSTGRES_PASSWORD` protects PostgreSQL and must remain unchanged when an
  existing database is upgraded. PostgreSQL only applies it automatically when
  initializing an empty data directory.
- `REDIS_PASSWORD` protects the private Redis instance. Compose passes the same
  value to both Redis and the backend.
- `JWT_SECRET` signs authentication tokens. Changing it signs every user out.
- `CORS_ORIGINS` is not a secret. Native clients use the provided defaults. Add
  a hosted web frontend as an exact origin such as `https://pomi.example.com`,
  without a trailing slash or path.

```bash
docker compose \
  --env-file /private/path/pomi.env \
  -f packages/backend/docker-compose.yml \
  pull backend

docker compose \
  --env-file /private/path/pomi.env \
  -f packages/backend/docker-compose.yml \
  up -d --no-build
```

Those commands run the published image selected by `POMI_BACKEND_IMAGE`. To
build the checked-out source locally instead, set
`POMI_BACKEND_IMAGE=pomi-backend:local` and use `up -d --build`.

The backend binds to `127.0.0.1:3000` by default. Put an HTTPS reverse proxy in
front of it. Native Tauri origins are allowed by default; a separately hosted
web frontend must set `CORS_ORIGINS` to its exact comma-separated origins.
PostgreSQL and Redis are isolated on an internal Docker network and must not be
published to the internet.

Optional integrations can stay blank. Their values come from their respective
service consoles: Sentry project settings for `NEST_SENTRY_DSN`, OpenRouter API
keys for `OPENROUTER_API_KEY`, a fine-grained GitHub token for feedback, Firebase
project settings under **Service accounts** for `FIREBASE_SERVICE_ACCOUNT_JSON`,
and the Apple Developer portal for APNs values. The environment template has a
comment beside each group, including the `jq -c` command needed to compact the
Firebase JSON and the read-only APNs key-file mount.

The container applies TypeORM migrations before startup. Back up PostgreSQL and
test restores before upgrades. The public Compose stack uses PostgreSQL 18 and
a volume named from the `pgdata18` key. PostgreSQL 18's official image stores
its versioned cluster below `/var/lib/postgresql`, so the volume intentionally
mounts that parent directory. Never attach the old `pgdata17` volume or a
PostgreSQL 17 data directory to the PostgreSQL 18 service. Redis is not the
durable user-data backup.

### Upgrade PostgreSQL 17 to 18

Create and verify a logical dump while the PostgreSQL 17 service from the old
checkout is still running. Run these commands from the repository root and use
the same private environment file as the deployment:

```bash
docker compose \
  --env-file /private/path/pomi.env \
  -f packages/backend/docker-compose.yml \
  exec -T db sh -c \
  'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > pomi-postgres-17.dump

docker compose \
  --env-file /private/path/pomi.env \
  -f packages/backend/docker-compose.yml \
  exec -T db pg_restore --list \
  < pomi-postgres-17.dump \
  > /dev/null
```

Stop the old stack without `-v`, switch to the checkout containing the
PostgreSQL 18 Compose definition, and initialize only the new datastore
services:

```bash
docker compose \
  --env-file /private/path/pomi.env \
  -f packages/backend/docker-compose.yml \
  down

docker compose \
  --env-file /private/path/pomi.env \
  -f packages/backend/docker-compose.yml \
  up -d db redis
```

Restore the verified dump into the empty PostgreSQL 18 database, then start the
backend so it can apply any pending TypeORM migrations:

```bash
docker compose \
  --env-file /private/path/pomi.env \
  -f packages/backend/docker-compose.yml \
  exec -T db sh -c \
  'pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < pomi-postgres-17.dump

docker compose \
  --env-file /private/path/pomi.env \
  -f packages/backend/docker-compose.yml \
  up -d backend
```

Verify the application and a second restore in a disposable environment before
removing the old project-scoped `pgdata17` volume. Keep the dump outside the
repository and protect it as production data.

### Upgrade Redis 7 to 8

Redis 8 can read Redis 7 RDB and append-only persistence files, so the Compose
stack keeps the existing `redisdata` volume. Before upgrading, authenticate
with `redis-cli`, run `SAVE`, stop the backend and Redis cleanly, and snapshot
the volume through the host's normal backup procedure. Start Redis 8 once the
snapshot is complete.

Do not downgrade by starting Redis 7 on files that Redis 8 may have rewritten;
restore the pre-upgrade snapshot instead. PostgreSQL remains the authoritative
user-data store. Recreating `redisdata` is acceptable only when losing active
timer coordination, rate-limit state, and other transient Redis state is an
explicitly accepted recovery choice.

## Frontend

Copy the root `.env.example` to the ignored root `.env.local`, set
`VITE_BACKEND_URL`, `VITE_USE_HTTPS`, and any optional frontend integration
variables, then run:

```bash
pnpm --filter @pomi/frontend build
```

Serve `packages/frontend/dist` over HTTPS or build a native client. Optional
Sentry, push, feedback, and AI integrations remain disabled until configured.

Commercial use or distribution requires separate permission under the
PolyForm Noncommercial License 1.0.0.
