# Self-hosting

## Production backend

Copy `packages/backend/.env.production.example` to a private path. Set only the
three required secrets: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, and
`JWT_SECRET`. Generate them with a cryptographically secure password generator;
do not use the development values.

```bash
docker compose \
  --env-file /private/path/pomi.env \
  -f packages/backend/docker-compose.yml \
  up -d --build
```

The backend binds to `127.0.0.1:3000` by default. Put an HTTPS reverse proxy in
front of it. Native Tauri origins are allowed by default; a separately hosted
web frontend must set `CORS_ORIGINS` to its exact comma-separated origins.
PostgreSQL and Redis are isolated on an internal Docker network and must not be
published to the internet.

The container applies TypeORM migrations before startup. Back up PostgreSQL and
test restores before upgrades. The public Compose stack uses a PostgreSQL 17
volume named from the `pgdata17` key so it cannot silently attach a volume made
by the previous floating-major image. To migrate an older installation, dump it
with its original PostgreSQL major and restore the dump into the new volume.
Never point a PostgreSQL 17 container directly at another major's data
directory. Redis is not the durable user-data backup.

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
