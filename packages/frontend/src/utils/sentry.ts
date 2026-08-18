import * as Sentry from '@sentry/react';
import {
  REDACTION_MARKER,
  SENSITIVE_REDACTION_KEY_PATTERN,
  SENSITIVE_REDACTION_TEXT_PATTERNS,
} from '@pomi/shared/src/utils/redaction';
import { environmentVariables } from '../config/environmentVariables';

let initialized = false;
const SAFE_EXCEPTION_VALUE = 'ClientError';

function redactValue(value: unknown, key?: string): unknown {
  return redactValueRecursively(value, key, new WeakSet<object>());
}

function redactValueRecursively(
  value: unknown,
  key: string | undefined,
  seen: WeakSet<object>
): unknown {
  if (key && SENSITIVE_REDACTION_KEY_PATTERN.test(key)) {
    return REDACTION_MARKER;
  }
  if (typeof value === 'string') {
    return SENSITIVE_REDACTION_TEXT_PATTERNS.reduce(
      (current, pattern) =>
        current.replace(pattern, (_match, prefix?: string) =>
          typeof prefix === 'string'
            ? `${prefix}${REDACTION_MARKER}`
            : REDACTION_MARKER
        ),
      value
    );
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map(item => redactValueRecursively(item, undefined, seen));
  }
  const result: Record<string, unknown> = {};
  for (const [property, propertyValue] of Object.entries(value)) {
    result[property] = redactValueRecursively(propertyValue, property, seen);
  }
  return result;
}

export function redactSentryEvent<T>(event: T): T {
  const sanitized = redactValue(event) as Record<string, unknown>;
  const exception = sanitized.exception;
  if (exception && typeof exception === 'object') {
    const values = (exception as Record<string, unknown>).values;
    if (Array.isArray(values)) {
      (exception as Record<string, unknown>).values = values.map(value => {
        if (!value || typeof value !== 'object') return value;
        const item = value as Record<string, unknown>;
        return {
          ...item,
          value: SAFE_EXCEPTION_VALUE,
        };
      });
    }
  }
  return sanitized as T;
}

export function redactSentryLog<T>(log: T): T {
  return redactValue(log) as T;
}

export function getFrontendSentryRelease(env: {
  VITE_SENTRY_RELEASE?: string;
}): string {
  const configuredRelease = env.VITE_SENTRY_RELEASE?.trim();
  return configuredRelease || 'pomi-frontend@0.1.0';
}

function getConfiguredFrontendSentryRelease(): string {
  return getFrontendSentryRelease(import.meta.env);
}

export function initFrontendSentryLogging() {
  if (initialized) return;
  initialized = true;

  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();

  Sentry.init({
    dsn,
    environment: environmentVariables.NODE_ENV,
    release: getConfiguredFrontendSentryRelease(),
    enabled: environmentVariables.NODE_ENV === 'production' && Boolean(dsn),
    sendDefaultPii: false,
    enableLogs: true,
    debug: false,
    integrations: [
      Sentry.consoleLoggingIntegration({
        levels: ['log', 'info', 'warn', 'error'],
      }),
      Sentry.browserTracingIntegration(),
    ],
    beforeSend: event => redactSentryEvent(event),
    beforeSendLog: log => redactSentryLog(log),
    tracesSampleRate: 1.0,
  });
}
