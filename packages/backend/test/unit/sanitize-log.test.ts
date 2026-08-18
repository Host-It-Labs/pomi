import { describe, expect, it } from 'vitest';
import {
  REDACTED_LOG_VALUE,
  formatSafeError,
  sanitizeLogText,
  sanitizeLogValue,
  sanitizeSentryError,
  sanitizeSentryEvent,
} from '../../src/logging/sanitize-log';

describe('log sanitization', () => {
  it('redacts credentials and personal fields by key', () => {
    const value = sanitizeLogValue({
      authorization: 'Bearer token',
      title: 'Private task',
      outcome: 'failed',
      durationMs: 42,
    });

    expect(value).toEqual({
      authorization: REDACTED_LOG_VALUE,
      title: REDACTED_LOG_VALUE,
      outcome: 'failed',
      durationMs: 42,
    });
  });

  it('redacts token formats embedded in operational messages', () => {
    const value = sanitizeLogText(
      'request failed with Bearer token and token=secret-value'
    );

    expect(value).not.toContain('secret-value');
    expect(value).not.toContain('Bearer token');
  });

  it('turns errors into safe names and sanitizes Sentry event fields', () => {
    expect(formatSafeError(new Error('private task title'))).toBe('Error');
    const sourceError = new Error('private task title');
    sourceError.stack =
      'Error: private task title\n    at sourceFailure (/app/source.ts:10:4)';
    const safeError = sanitizeSentryError(sourceError);
    expect(safeError.message).toBe('Error');
    expect(safeError.stack).toContain('at sourceFailure (/app/source.ts:10:4)');
    expect(safeError.stack).not.toContain('private task title');

    const event = sanitizeSentryEvent({
      request: { data: { title: 'Private task' } },
      user: { id: 'user-1' },
      exception: { values: [{ value: 'Bearer token' }] },
    });

    expect(event).toMatchObject({
      request: REDACTED_LOG_VALUE,
      user: REDACTED_LOG_VALUE,
      exception: { values: [{ value: REDACTED_LOG_VALUE }] },
    });
  });
});
