import { describe, expect, it } from 'vitest';
import { getBackendSentryRelease } from '../../src/sentry-release';

describe('Sentry release configuration', () => {
  it('uses the release supplied to the production process', () => {
    expect(
      getBackendSentryRelease({ SENTRY_RELEASE: 'pomi-backend@v1.2.3' })
    ).toBe('pomi-backend@v1.2.3');
  });

  it('keeps a stable local fallback when no release is supplied', () => {
    expect(getBackendSentryRelease({})).toBe('pomi-backend@0.0.1');
  });
});
