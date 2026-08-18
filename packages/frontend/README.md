# Pomi frontend

This package contains the React/Vite client and Tauri shells for desktop,
Android, and iOS. Public builds use the neutral identifier
`app.pomi.community`; official store identifiers and signing material are not
part of this repository.

```bash
cp .env.example .env
pnpm dev
pnpm build
```

From the repository root, native verification builds are available through
`pnpm build:macos`, `pnpm build:android`, `pnpm build:wear`,
`pnpm build:linux`, and `pnpm build:windows` when their platform toolchains are
installed.

Android Firebase support is disabled when
`src-tauri/gen/android/app/google-services.json` is absent. Supply a file from
your own Firebase project locally if push notifications are required; never
commit it.

Before sharing a compiled fork, follow [the rebranding guide](../../docs/rebranding.md).
