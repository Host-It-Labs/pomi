import {
  PurchaseState,
  type Purchase,
} from '@choochmeque/tauri-plugin-iap-api';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPendingCheckout,
  readPendingCheckout,
  savePendingCheckout,
} from './pendingCheckoutStorage';

const purchase: Purchase = {
  packageName: 'app.pomi.community',
  productId: 'app.pomi.community.pro.yearly',
  purchaseTime: 1,
  purchaseToken: 'purchase-token',
  purchaseState: PurchaseState.PURCHASED,
  isAutoRenewing: true,
  isAcknowledged: true,
  originalJson: '',
  signature: '',
};

afterEach(clearPendingCheckout);

describe('pending checkout storage', () => {
  it('restores an unclaimed purchase across an app reload', () => {
    savePendingCheckout({
      checkoutId: '550e8400-e29b-41d4-a716-446655440000',
      checkoutToken: 'checkout-token',
      productId: purchase.productId,
      purchase,
      platform: 'ios',
    });

    expect(readPendingCheckout()).toMatchObject({
      checkoutToken: 'checkout-token',
      purchase: { purchaseToken: 'purchase-token' },
    });

    clearPendingCheckout();
    expect(readPendingCheckout()).toBeNull();
  });

  it('keeps an unclaimed checkout until its purchase is claimed', () => {
    savePendingCheckout({
      checkoutId: '550e8400-e29b-41d4-a716-446655440000',
      checkoutToken: 'durable-token',
      productId: purchase.productId,
      platform: 'ios',
    });

    expect(readPendingCheckout()).toMatchObject({
      checkoutToken: 'durable-token',
      productId: purchase.productId,
    });
  });
});
