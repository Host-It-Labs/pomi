# Local configuration

Pomi keeps three local environment profiles. They are all ignored by Git and
must be created from the versioned examples when needed:

```bash
cp .env.example .env.local
chmod 600 .env.local
cp config/pomi-automation.example.env config/pomi-automation.env
chmod 600 config/pomi-automation.env
cp config/pomi-release.example.env config/pomi-release.env
chmod 600 config/pomi-release.env
mkdir -p config/secrets
chmod 700 config/secrets
```

Use `.env.local` for the local backend, web client, native development, and
optional product integrations. The `GITHUB_FEEDBACK_*` values here are for
local product-feedback testing; scheduled Radar uses the automation profile.
It is the profile loaded by the development launchers.

Use `config/pomi-automation.env` only for scheduled Radar automation. It holds
the Pomi Radar GitHub App settings, the read-only source-repository token, and
the Sentry values needed by the scheduled agent. `scripts/github-app-auth.mjs`
loads this profile automatically and fails closed if the App cannot
authenticate.

Use `config/pomi-release.env` only for local release commands. It holds the
production client URL, client Sentry release values, native build paths, Wear
deployment address, and optional GHCR credentials. The release commands load
this profile explicitly, so development values cannot silently be embedded in
a client artifact.

Keep file-shaped credentials in `config/secrets/` and set their corresponding
path variables in the appropriate profile. All three profiles and the secrets
directory are copied into Codex worktrees through `.worktreeinclude`.

The standard credential paths are:

- `config/secrets/pomi-radar.private-key.pem` for the Pomi Radar GitHub App;
- `config/secrets/firebase-service-account.json` for Firebase Admin;
- `config/secrets/google-services.json` for Android package
  `app.pomi.community` in Firebase project `pomi-d8ea6`;
- `config/secrets/pomi-release.jks` for local Android release signing.

Run `pnpm native:prepare` before a native Android release build. It reads
`config/pomi-release.env`, copies the Firebase file, and generates Gradle
signing configuration where Android expects them without committing either
file. Android signing remains optional locally; leave the keystore password
blank for unsigned/debug-capable local work.

Run `pnpm release:macos` to build the local ARM64 macOS app. This command reads
`config/pomi-release.env` and passes Tauri's `--no-sign` option, so an Apple
signing identity or notarization credentials are not required for a local
build. The resulting app is for local testing until it is signed for
distribution.

`VITE_SENTRY_DSN` is embedded in frontend/native release artifacts so those
clients can report errors to Sentry. `NEST_SENTRY_DSN` is read by the backend at
runtime. Get both values from the relevant Sentry project under **Project
Settings → Client Keys (DSN)**.

Local Docker builds do not need registry credentials. To push the backend image
to GHCR, set `GHCR_USERNAME` and `GHCR_TOKEN` (with `write:packages`) in
`config/pomi-release.env` and run `pnpm release:docker`. CI publishes to
`ghcr.io/host-it-labs/pomi-backend` with its GitHub token; Docker Hub is not
used.

Production Compose deliberately remains separate: use a private deployment
file based on `packages/backend/.env.production.example` as described in
[self-hosting.md](self-hosting.md).
