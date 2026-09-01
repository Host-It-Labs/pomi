# Pomi

Pomi is a self-hostable focus timer for work and break sessions, intentions,
tasks, statistics, and optional AI-assisted task capture. The repository
contains a NestJS backend, a React web client, Tauri desktop and mobile shells,
and a Wear OS companion.

## Local development

Requirements: Node.js 26, pnpm 11.23.0, and Docker with Compose. Node 26 no
longer bundles Corepack, so install the current Corepack release once before
activating pnpm:

```bash
npm install --global corepack@0.35.0
corepack enable pnpm
corepack install --global pnpm@11.23.0
pnpm install --frozen-lockfile
cp .env.example .env.local
chmod 600 .env.local
pnpm docker:dev:detached
pnpm dev:migrate
pnpm dev:frontend
```

Run the main checks with:

```bash
pnpm -r run build
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:browser
pnpm test:native
```

## Self-hosting

The production Compose stack runs the backend, PostgreSQL, and Redis. Copy the
production environment example, set `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, and
`JWT_SECRET`, and a separate 32-character-or-longer
`POMI_ADMIN_BOOTSTRAP_TOKEN`, then start it:

```bash
cp packages/backend/.env.production.example pomi.env
docker compose --env-file pomi.env -f packages/backend/docker-compose.yml up -d --build
```

It binds to `127.0.0.1:3000` by default. Put an HTTPS reverse proxy in front of
it. Web deployments must also set their exact frontend origin in
`CORS_ORIGINS`. The first account must provide the administrator bootstrap
token. See [the self-hosting guide](docs/self-hosting.md) for session upgrades,
client rollout order, and optional integrations.

## Optional services

Development variables live in the ignored root `.env.local`. Scheduled Radar
automation uses the separate ignored `config/pomi-automation.env`, and local
release commands use `config/pomi-release.env`. File-shaped credentials live in
ignored `config/secrets/`. Sentry, OpenRouter, GitHub feedback, Firebase, and
APNs remain disabled unless their credentials are supplied. See [the local setup guide](docs/local-setup.md).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report
security issues privately as described in [SECURITY.md](SECURITY.md).

## Third-party review

Dependency licenses and asset notices still need a dedicated review before
redistributing compiled builds. Check and preserve every applicable third-party
license and notice.

## License

Pomi is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use or distribution
requires separate permission from the licensor.
