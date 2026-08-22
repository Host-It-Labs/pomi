/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_GOOGLE_AUTH_CLIENT_ID?: string;
  readonly VITE_GOOGLE_AUTH_CLIENT_SECRET?: string;
  readonly VITE_SUBSCRIPTION_MONTHLY_PRODUCT_ID?: string;
  readonly VITE_SUBSCRIPTION_YEARLY_PRODUCT_ID?: string;
}
