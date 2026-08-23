import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { BillingController } from '../../src/billing/billing.controller';

async function invokeHandler(result: unknown): Promise<unknown> {
  expect(result).toBeTypeOf('function');
  return await (result as () => Promise<unknown>)();
}

function controller() {
  const billing = {
    verifyCheckoutPurchase: vi.fn().mockResolvedValue(undefined),
  };
  const checkouts = {
    create: vi.fn().mockResolvedValue({
      checkoutId: 'checkout-id',
      checkoutToken: 'checkout-token',
    }),
  };
  const anonymousRateLimits = {
    assertCheckoutCreationAllowed: vi.fn().mockResolvedValue(undefined),
    assertCheckoutVerificationAllowed: vi.fn().mockResolvedValue(undefined),
  };
  return {
    billing,
    checkouts,
    anonymousRateLimits,
    billingController: new BillingController(
      billing as never,
      checkouts as never,
      anonymousRateLimits as never
    ),
  };
}

const request = { ip: '203.0.113.50' } as Request;
const purchase = {
  checkoutToken: 'checkout-token',
  platform: 'android' as const,
  productId: 'pomi_monthly',
  purchaseToken: 'purchase-token',
  originalId: 'order-id',
};

describe('BillingController anonymous checkout limits', () => {
  it('limits checkout creation before persisting a checkout', async () => {
    const { anonymousRateLimits, billingController, checkouts } = controller();
    anonymousRateLimits.assertCheckoutCreationAllowed.mockRejectedValueOnce(
      new HttpException('Too many requests', 429)
    );

    await expect(
      invokeHandler(await billingController.createCheckout(request))
    ).rejects.toMatchObject<HttpException>({ status: 429 });
    expect(
      anonymousRateLimits.assertCheckoutCreationAllowed
    ).toHaveBeenCalledWith('203.0.113.50');
    expect(checkouts.create).not.toHaveBeenCalled();
  });

  it('limits purchase verification by client and checkout token before store verification', async () => {
    const { anonymousRateLimits, billing, billingController } = controller();
    anonymousRateLimits.assertCheckoutVerificationAllowed.mockRejectedValueOnce(
      new HttpException('Too many requests', 429)
    );

    await expect(
      invokeHandler(
        await billingController.verifyCheckoutPurchase(request, purchase)
      )
    ).rejects.toMatchObject<HttpException>({ status: 429 });
    expect(
      anonymousRateLimits.assertCheckoutVerificationAllowed
    ).toHaveBeenCalledWith('203.0.113.50', 'checkout-token');
    expect(billing.verifyCheckoutPurchase).not.toHaveBeenCalled();
  });

  it('continues both anonymous routes when their scoped limits allow them', async () => {
    const { billing, billingController, checkouts } = controller();

    await expect(
      invokeHandler(await billingController.createCheckout(request))
    ).resolves.toEqual({
      status: 201,
      body: { checkoutId: 'checkout-id', checkoutToken: 'checkout-token' },
    });
    await expect(
      invokeHandler(
        await billingController.verifyCheckoutPurchase(request, purchase)
      )
    ).resolves.toEqual({ status: 200, body: { success: true } });
    expect(checkouts.create).toHaveBeenCalledOnce();
    expect(billing.verifyCheckoutPurchase).toHaveBeenCalledWith(purchase);
  });
});
