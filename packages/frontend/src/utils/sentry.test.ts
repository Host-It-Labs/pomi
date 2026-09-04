import { describe, expect, it } from 'vitest';
import {
  getFrontendSentryRelease,
  getSafeSentryFingerprint,
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
  it('groups equivalent safe origins without retaining exception text', () => {
    const baseEvent = {
      tags: { operation: 'modal.render' },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'private Task title',
            mechanism: {
              type: 'auto.browser.global_handlers.onunhandledrejection',
            },
            stacktrace: {
              frames: [
                { module: 'vendor', in_app: false },
                { module: 'components.ui.Modal', in_app: true },
              ],
            },
          },
        ],
      },
    };

    expect(getSafeSentryFingerprint(baseEvent)).toEqual([
      'pomi-client',
      'TypeError',
      'auto.browser.global_handlers.onunhandledrejection',
      'components.ui.Modal',
      'modal.render',
    ]);
    const redacted = redactSentryEvent(baseEvent) as typeof baseEvent & {
      fingerprint: string[];
    };
    expect(redacted.fingerprint).toEqual(
      getSafeSentryFingerprint({
        ...baseEvent,
        exception: {
          values: [
            {
              ...baseEvent.exception.values[0],
              value: 'a different private Task title',
            },
          ],
        },
      })
    );
    expect(redacted.exception.values[0].value).toBe('ClientError');
  });

  it('rejects unsafe high-cardinality fingerprint segments', () => {
    expect(
      getSafeSentryFingerprint({
        tags: { operation: 'task for user@example.com' },
        exception: { values: [{ type: 'Error with private title' }] },
      })
    ).toEqual(['pomi-client', 'unknown', 'unknown', 'unknown', 'unknown']);
  });

  it('removes Vite content hashes from fallback frame origins', () => {
    const fingerprintFor = (filename: string) =>
      getSafeSentryFingerprint({
        exception: {
          values: [
            {
              type: 'TypeError',
              stacktrace: { frames: [{ filename, in_app: true }] },
            },
          ],
        },
      });

    expect(fingerprintFor('/assets/Modal-Dgs3xT92.js')).toEqual(
      fingerprintFor('/assets/Modal-A1b2C3d4.js')
    );
    expect(fingerprintFor('/assets/Modal-Dgs3xT92.js')[3]).toBe('Modal.js');
  });

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
