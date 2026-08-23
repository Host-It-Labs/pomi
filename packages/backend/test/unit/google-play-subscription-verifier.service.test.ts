import { beforeEach, describe, expect, it, vi } from 'vitest';

const googleRequest = vi.hoisted(() => vi.fn());

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    async getClient() {
      return { request: googleRequest };
    }
  },
}));

import { GooglePlaySubscriptionVerifierService } from '../../src/billing/google-play-subscription-verifier.service';

describe('GooglePlaySubscriptionVerifierService', () => {
  beforeEach(() => googleRequest.mockReset());

  it('uses the verified purchase token as the unique transaction identity', async () => {
    googleRequest.mockResolvedValue({
      data: {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        externalAccountIdentifiers: {
          obfuscatedExternalAccountId: 'a3d025a0416840b19ef1bde9b613597b',
        },
        lineItems: [
          {
            productId: 'app.pomi.community.pro.monthly',
            expiryTime: new Date(Date.now() + 86_400_000).toISOString(),
            autoRenewingPlan: { autoRenewEnabled: true },
          },
        ],
      },
    });
    const verifier = new GooglePlaySubscriptionVerifierService(
      {
        get: vi.fn((key: string) => {
          if (key === 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON') return '{}';
          if (key === 'GOOGLE_PLAY_PACKAGE_NAME') return 'app.pomi.community';
          return undefined;
        }),
      } as never,
      { planFor: vi.fn(() => 'monthly') } as never
    );

    const verified = await verifier.verifyBoundPurchase(
      {
        platform: 'android',
        productId: 'app.pomi.community.pro.monthly',
        purchaseToken: 'verified-play-purchase-token',
        originalId: 'client-controlled-original-id',
      },
      'a3d025a0-4168-40b1-9ef1-bde9b613597b'
    );

    expect(verified.transactionId).toBe('verified-play-purchase-token');
    expect(verified.originalTransactionId).toBe('verified-play-purchase-token');
    expect(verified.originalTransactionId).not.toBe(
      'client-controlled-original-id'
    );
  });
});
