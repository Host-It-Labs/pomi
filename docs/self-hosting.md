# Self-hosting

## Production backend

Copy `packages/backend/.env.production.example` to a private path. Set the four
required secrets: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, and
`POMI_ADMIN_BOOTSTRAP_TOKEN`. Generate them with a cryptographically secure
password generator; do not use the development values.

Generate each secret separately so credentials are not shared:

```bash
openssl rand -hex 32
```

- `POSTGRES_PASSWORD` protects PostgreSQL and must remain unchanged when an
  existing database is upgraded. PostgreSQL only applies it automatically when
  initializing an empty data directory.
- `REDIS_PASSWORD` protects the private Redis instance. Compose passes the same
  value to both Redis and the backend.
- `JWT_SECRET` signs authentication tokens. Changing it signs every user out.
- `POMI_ADMIN_BOOTSTRAP_TOKEN` protects the first self-hosted administrator
  claim. It must contain at least 32 characters and must be different from the
  other secrets. The first account-creation form asks for this value. Once an
  administrator exists, later registrations do not use it, but keep it private
  for disaster recovery unless your operational policy rotates it.
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
front of it and configure `TRUST_PROXY_HOPS` to the exact number of trusted
proxy hops. Remote clients reject plaintext HTTP backends. Native Tauri origins
are allowed by default; a separately hosted web frontend must set
`CORS_ORIGINS` to its exact comma-separated origins. Origins include scheme,
host, and optional port only—never paths, wildcards, credentials, queries, or
fragments.
PostgreSQL and Redis are isolated on an internal Docker network and must not be
published to the internet.

Optional integrations can stay blank. Their values come from their respective
service consoles: Sentry project settings for `NEST_SENTRY_DSN`, OpenRouter API
keys for `OPENROUTER_API_KEY`, a GitHub App installation with Issues write access
for feedback, Firebase project settings under **Service accounts** for
`FIREBASE_SERVICE_ACCOUNT_JSON`, and the Apple Developer portal for APNs values.
The environment template has a comment beside each group, including the `jq -c`
command needed to compact the
Firebase JSON and the read-only APNs key-file mount.

Set `GITHUB_FEEDBACK_APP_PRIVATE_KEY` in the private Compose environment file to
the GitHub App private key. The backend accepts PEM newlines, literal `\n` or
`\r\n` sequences, one-line PEMs, surrounding single or double quotes, and
base64-encoded PKCS#8 or PKCS#1 RSA key material without PEM wrapper lines.
For a Portainer environment-variable entry, use the key contents as the value;
quotes are optional. Compose passes the value directly to the backend container,
so protect the environment file with restrictive filesystem permissions and
never commit it.

The container applies TypeORM migrations before startup. Back up PostgreSQL and
test restores before upgrades. The public Compose stack uses PostgreSQL 18 and
a volume named from the `pgdata18` key. PostgreSQL 18's official image stores
its versioned cluster below `/var/lib/postgresql`, so the volume intentionally
mounts that parent directory. Never attach the old `pgdata17` volume or a
PostgreSQL 17 data directory to the PostgreSQL 18 service. Redis is not the
durable user-data backup.

### Upgrade authentication sessions

Deploy the database migration and backend before updating web, desktop, mobile,
or Wear clients. The backend accepts the new short-lived access tokens and
rotating refresh sessions as soon as the `auth_sessions` migration has run.

Existing bearer-only clients can migrate without prompting the user again only
during an explicitly bounded compatibility window. Set
`POMI_LEGACY_JWT_MIGRATION_UNTIL` to an ISO-8601 UTC timestamp, for example
`2026-09-08T12:00:00Z`, before deploying the upgraded backend. Upgrade every
client before that deadline, then remove the variable. Leave it blank for new
deployments. Do not extend the window merely to preserve abandoned sessions;
users can sign in again after it closes.

Web and mobile-webview clients keep refresh credentials in Secure, HttpOnly
cookies. Desktop clients use the operating-system keyring, and Wear OS uses
Android Keystore. Access tokens remain short-lived and process-memory-only.
Saved custom backend values that are not exact secure origins are quarantined
before old authentication data can be reused; affected users must enter a valid
HTTPS origin and sign in again.

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
