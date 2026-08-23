import { describe, expect, it } from 'vitest';
import { purchaseVerificationMessageKey } from './Paywall';

describe('paywall purchase messaging', () => {
  it('preserves pending store approval for purchases and restores', () => {
    expect(purchaseVerificationMessageKey('pending', 'buy')).toBe(
      'billing.purchasePending'
    );
    expect(purchaseVerificationMessageKey('pending', 'restore')).toBe(
      'billing.purchasePending'
    );
  });

  it('uses flow-specific messages only for verified inactive purchases', () => {
    expect(purchaseVerificationMessageKey('inactive', 'buy')).toBe(
      'billing.verificationFailed'
    );
    expect(purchaseVerificationMessageKey('inactive', 'restore')).toBe(
      'billing.nothingToRestore'
    );
    expect(purchaseVerificationMessageKey('active', 'buy')).toBeNull();
  });
});
