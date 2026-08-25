import { describe, expect, it } from 'vitest';
import { fixtureCredentialFingerprint } from '../../src/development-fixtures/fixture-credential';

describe('fixtureCredentialFingerprint', () => {
  it('derives a deterministic, credential-specific fingerprint with scrypt', () => {
    const fingerprint = fixtureCredentialFingerprint('copyme', 'password');

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fixtureCredentialFingerprint('copyme', 'password')).toBe(
      fingerprint
    );
    expect(fixtureCredentialFingerprint('other', 'password')).not.toBe(
      fingerprint
    );
    expect(fixtureCredentialFingerprint('copyme', 'other')).not.toBe(
      fingerprint
    );
  });
});
