import {
  PurchaseState,
  type Purchase,
} from '@choochmeque/tauri-plugin-iap-api';

export type CheckoutPlatform = 'ios' | 'android';

export type PendingCheckoutState = {
  checkoutId: string;
  checkoutToken: string;
  productId: string;
  platform: CheckoutPlatform;
  purchase?: Purchase;
};

export type PendingCheckoutPurchase = PendingCheckoutState & {
  purchase: Purchase;
};

export function isCompletedCheckout(
  checkout: PendingCheckoutState | null | undefined
): checkout is PendingCheckoutPurchase {
  return checkout?.purchase?.purchaseState === PurchaseState.PURCHASED;
}
