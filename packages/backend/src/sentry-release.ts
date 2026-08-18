const LOCAL_BACKEND_SENTRY_RELEASE = 'pomi-backend@0.0.1';

export function getBackendSentryRelease(env: NodeJS.ProcessEnv): string {
  const configuredRelease = env.SENTRY_RELEASE?.trim();
  return configuredRelease || LOCAL_BACKEND_SENTRY_RELEASE;
}

export function getConfiguredBackendSentryRelease(): string {
  return getBackendSentryRelease(process.env);
}
