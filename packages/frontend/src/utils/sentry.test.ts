import { describe, expect, it } from 'vitest';
import {
  getFrontendSentryRelease,
  redactSentryEvent,
  redactSentryLog,
} from './sentry';

describe('Sentry release configuration', () => {
  it('uses the production release injected by the build', () => {
    expect(
      getFrontendSentryRelease({ VITE_SENTRY_RELEASE: 'pomi-frontend@v1.2.3' })
    ).toBe('pomi-frontend@v1.2.3');
  });

  it('keeps a stable local fallback when no release is injected', () => {
    expect(getFrontendSentryRelease({})).toBe('pomi-frontend@0.1.0');
  });
});

describe('redactSentryEvent', () => {
  it('removes credentials, personal fields, and request payloads', () => {
    const event = redactSentryEvent({
      request: {
        headers: { authorization: 'Bearer secret-token' },
        data: { title: 'Pay the private invoice' },
      },
      user: { id: 'user-1', email: 'user@example.com' },
      extra: { prompt: 'private task prompt' },
      exception: { values: [{ type: 'Error', value: 'Bearer another-token' }] },
    });

    expect(event).toMatchObject({
      request: '[REDACTED]',
      user: '[REDACTED]',
      extra: '[REDACTED]',
      exception: {
        values: [{ type: 'Error', value: 'ClientError' }],
      },
    });
    expect(JSON.stringify(event)).not.toContain('private');
    expect(JSON.stringify(event)).not.toContain('secret-token');
  });

  it('redacts captured console log messages and attributes', () => {
    const log = redactSentryLog({
      level: 'error',
      message: 'request failed with Bearer secret-token',
      attributes: { title: 'Private task' },
    });

    expect(log).toEqual({
      level: 'error',
      message: 'request failed with [REDACTED]',
      attributes: { title: '[REDACTED]' },
    });
  });
});
