import * as Sentry from '@sentry/react';
import {
  REDACTION_MARKER,
  SENSITIVE_REDACTION_KEY_PATTERN,
  SENSITIVE_REDACTION_TEXT_PATTERNS,
} from '@pomi/shared/src/utils/redaction';
import { environmentVariables } from '../config/environmentVariables';

let initialized = false;
const SAFE_EXCEPTION_VALUE = 'ClientError';
const SAFE_FINGERPRINT_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,79}$/;
const UNKNOWN_FINGERPRINT_SEGMENT = 'unknown';

function safeFingerprintSegment(value: unknown): string {
  return typeof value === 'string' && SAFE_FINGERPRINT_SEGMENT.test(value)
    ? value
    : UNKNOWN_FINGERPRINT_SEGMENT;
}

function normalizeBundledAssetName(value: string): string {
  return value.replace(/-[A-Za-z0-9_-]{8,}(?=\.[^.]+$)/, '');
}

function getSafeFrameOrigin(value: Record<string, unknown>): string {
  const stacktrace = value.stacktrace;
  if (!stacktrace || typeof stacktrace !== 'object') {
    return UNKNOWN_FINGERPRINT_SEGMENT;
  }
  const frames = (stacktrace as Record<string, unknown>).frames;
  if (!Array.isArray(frames)) return UNKNOWN_FINGERPRINT_SEGMENT;

  for (const frame of [...frames].reverse()) {
    if (!frame || typeof frame !== 'object') continue;
    const candidate = frame as Record<string, unknown>;
    if (candidate.in_app !== true) continue;
    const module = safeFingerprintSegment(candidate.module);
    if (module !== UNKNOWN_FINGERPRINT_SEGMENT) return module;
    if (typeof candidate.filename === 'string') {
      const assetName = candidate.filename.split(/[?#]/, 1)[0].split('/').pop();
      const safeAssetName = safeFingerprintSegment(
        assetName ? normalizeBundledAssetName(assetName) : undefined
      );
      if (safeAssetName !== UNKNOWN_FINGERPRINT_SEGMENT) return safeAssetName;
    }
  }
  return UNKNOWN_FINGERPRINT_SEGMENT;
}

export function getSafeSentryFingerprint(event: unknown): string[] {
  if (!event || typeof event !== 'object') {
    return ['pomi-client', UNKNOWN_FINGERPRINT_SEGMENT];
  }
  const candidate = event as Record<string, unknown>;
  const exception = candidate.exception;
  const values =
    exception && typeof exception === 'object'
      ? (exception as Record<string, unknown>).values
      : undefined;
  const firstValue =
    Array.isArray(values) && values[0] && typeof values[0] === 'object'
      ? (values[0] as Record<string, unknown>)
      : {};
  const mechanism = firstValue.mechanism;
  const tags = candidate.tags;

  return [
    'pomi-client',
    safeFingerprintSegment(firstValue.type),
    safeFingerprintSegment(
      mechanism && typeof mechanism === 'object'
        ? (mechanism as Record<string, unknown>).type
        : undefined
    ),
    getSafeFrameOrigin(firstValue),
    safeFingerprintSegment(
      tags && typeof tags === 'object'
        ? (tags as Record<string, unknown>).operation
        : undefined
    ),
  ];
}

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
  const fingerprint = getSafeSentryFingerprint(event);
  const sanitized = redactValue(event) as Record<string, unknown>;
  sanitized.fingerprint = fingerprint;
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
