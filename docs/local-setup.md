# Local configuration

Pomi uses one manually edited local environment file:

```bash
cp .env.example .env.local
chmod 600 .env.local
mkdir -p config/secrets
chmod 700 config/secrets
```

Keep scalar values in `.env.local`. Keep file-shaped credentials in
`config/secrets/` and set their corresponding path variables in `.env.local`.
Both locations are ignored by Git and copied into Codex worktrees through
`.worktreeinclude`.

The standard credential paths are:

- `config/secrets/pomi-radar.private-key.pem` for the Pomi Radar GitHub App;
- `config/secrets/firebase-service-account.json` for Firebase Admin;
- `config/secrets/google-services.json` for Android package
  `app.pomi.community` in Firebase project `pomi-d8ea6`;
- `config/secrets/pomi-release.jks` for local Android release signing.

Run `pnpm native:prepare` before a native Android release build. It copies the
Firebase file and generates Gradle signing configuration where Android expects
them without committing either file.

`VITE_SENTRY_DSN` is embedded in frontend/native release artifacts so those
clients can report errors to Sentry. `NEST_SENTRY_DSN` is read by the backend at
runtime. Get both values from the relevant Sentry project under **Project
Settings → Client Keys (DSN)**.

Local Docker builds do not need registry credentials. To push the backend image
to GHCR, set `GHCR_USERNAME` and `GHCR_TOKEN` (with `write:packages`) and run
`pnpm release:docker`. CI publishes to `ghcr.io/host-it-labs/pomi-backend` with its
GitHub token; Docker Hub is not used.

Production Compose deliberately remains separate: use a private deployment
file based on `packages/backend/.env.production.example` as described in
[self-hosting.md](self-hosting.md).
