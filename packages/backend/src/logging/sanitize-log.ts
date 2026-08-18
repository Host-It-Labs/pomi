import {
  REDACTION_MARKER,
  SENSITIVE_REDACTION_KEY_PATTERN,
  SENSITIVE_REDACTION_TEXT_PATTERNS,
} from '@pomi/shared';

export const REDACTED_LOG_VALUE = REDACTION_MARKER;
const MAX_LOG_TEXT_LENGTH = 2_000;

export function sanitizeLogText(value: unknown): string {
  let sanitized =
    value instanceof Error ? formatSafeError(value) : String(value);
  for (const pattern of SENSITIVE_REDACTION_TEXT_PATTERNS) {
    sanitized = sanitized.replace(pattern, (_match, prefix?: string) =>
      typeof prefix === 'string'
        ? `${prefix}${REDACTION_MARKER}`
        : REDACTION_MARKER
    );
  }
  return sanitized.length > MAX_LOG_TEXT_LENGTH
    ? `${sanitized.slice(0, MAX_LOG_TEXT_LENGTH)}…`
    : sanitized;
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeLogValueRecursively(value, undefined, new WeakSet<object>());
}

function sanitizeLogValueRecursively(
  value: unknown,
  key: string | undefined,
  seen: WeakSet<object>
): unknown {
  if (key && SENSITIVE_REDACTION_KEY_PATTERN.test(key)) {
    return REDACTION_MARKER;
  }
  if (typeof value === 'string') {
    return sanitizeLogText(value);
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item =>
      sanitizeLogValueRecursively(item, undefined, seen)
    );
  }

  const sanitized: Record<string, unknown> = {};
  for (const [property, propertyValue] of Object.entries(value)) {
    sanitized[property] = sanitizeLogValueRecursively(
      propertyValue,
      property,
      seen
    );
  }
  return sanitized;
}

export function formatSafeError(error: unknown): string {
  if (error instanceof Error) {
    const errorName =
      typeof error.name === 'string' &&
      /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(error.name)
        ? error.name
        : 'Error';
    const errorCode = (error as { code?: unknown }).code;
    const code =
      typeof errorCode === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(errorCode)
        ? ` (${errorCode})`
        : '';
    return `${errorName}${code}`;
  }
  return 'UnknownError';
}

export function sanitizeSentryError(error: Error): Error {
  const safeLabel = formatSafeError(error);
  const safeName = safeLabel.split(' (', 1)[0] || 'Error';
  const sanitized = new Error(safeLabel);
  sanitized.name = safeName;

  if (typeof error.stack === 'string') {
    const stackLines = error.stack.split('\n');
    const firstFrame = stackLines.findIndex(line => /^\s*at\s/.test(line));
    const frames =
      firstFrame >= 0 ? stackLines.slice(firstFrame) : stackLines.slice(1);
    sanitized.stack = [
      sanitized.toString(),
      ...frames.map(frame => sanitizeLogText(frame)),
    ].join('\n');
  }

  return sanitized;
}

export function sanitizeSentryEvent<T>(event: T): T {
  return sanitizeLogValue(event) as T;
}
