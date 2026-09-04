/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOW_INSECURE_REMOTE_BACKEND?: string;
  readonly VITE_SENTRY_RELEASE?: string;
}
