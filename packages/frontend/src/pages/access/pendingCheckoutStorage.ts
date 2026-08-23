import type { Purchase } from '@choochmeque/tauri-plugin-iap-api';
import type { PendingCheckoutState } from './checkoutTypes';

const STORAGE_KEY = 'pomi-pending-checkout';

export function savePendingCheckout(value: PendingCheckoutState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Restricted webviews may reject storage. The in-memory handoff still works.
  }
}

export function readPendingCheckout(): PendingCheckoutState | null {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) return null;
    const value: unknown = JSON.parse(rawValue);
    if (!isPendingCheckout(value)) {
      clearPendingCheckout();
      return null;
    }
    return value;
  } catch {
    clearPendingCheckout();
    return null;
  }
}

export function clearPendingCheckout() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else can be done when storage is unavailable.
  }
}

function isPendingCheckout(value: unknown): value is PendingCheckoutState {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const purchase = record.purchase as Partial<Purchase> | undefined;
  return Boolean(
    typeof record.checkoutToken === 'string' &&
    typeof record.checkoutId === 'string' &&
    (record.platform === 'ios' || record.platform === 'android') &&
    typeof record.productId === 'string' &&
    (!purchase ||
      (typeof purchase.productId === 'string' &&
        typeof purchase.purchaseToken === 'string' &&
        typeof purchase.packageName === 'string' &&
        typeof purchase.purchaseTime === 'number' &&
        typeof purchase.purchaseState === 'number'))
  );
}
