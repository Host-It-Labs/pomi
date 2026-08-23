import type {
  SubscriptionEntitlement,
  SubscriptionPlatform,
} from '@pomi/shared';
import type { Purchase } from '@choochmeque/tauri-plugin-iap-api';
import { create } from 'zustand';
import { apiClient } from '../utils/apiClient';
import { createSelectors } from './createSelectors';

type BillingState = {
  entitlement: SubscriptionEntitlement | null;
  isLoading: boolean;
  error: string | null;
  loadEntitlement: () => Promise<SubscriptionEntitlement | null>;
  syncPurchase: (
    purchase: Purchase,
    platform: SubscriptionPlatform
  ) => Promise<SubscriptionEntitlement>;
  createCheckout: () => Promise<{
    checkoutId: string;
    checkoutToken: string;
  }>;
  verifyCheckoutPurchase: (
    checkoutToken: string,
    purchase: Purchase,
    platform: SubscriptionPlatform
  ) => Promise<void>;
  claimCheckout: (
    checkoutToken: string,
    purchase: Purchase,
    platform: SubscriptionPlatform
  ) => Promise<SubscriptionEntitlement>;
  reset: () => void;
};

const useBillingStoreBase = create<BillingState>((set, get) => ({
  entitlement: null,
  isLoading: false,
  error: null,
  loadEntitlement: async () => {
    if (get().isLoading) return get().entitlement;
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.billing.entitlement();
      if (response.status !== 200) {
        throw new Error('Unable to load subscription status');
      }
      set({ entitlement: response.body });
      return response.body;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to load subscription status';
      set({ error: message });
      return null;
    } finally {
      set({ isLoading: false });
    }
  },
  syncPurchase: async (purchase, platform) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.billing.sync({
        body: {
          platform,
          productId: purchase.productId,
          purchaseToken: purchase.purchaseToken,
          originalId: purchase.originalId ?? purchase.orderId,
          jwsRepresentation: purchase.jwsRepresentation,
          originalJson: purchase.originalJson || undefined,
          signature: purchase.signature || undefined,
        },
      });
      if (response.status !== 200) {
        throw new Error('The store purchase could not be verified');
      }
      set({ entitlement: response.body });
      return response.body;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The store purchase could not be verified';
      set({ error: message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  createCheckout: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.billing.createCheckout({ body: {} });
      if (response.status !== 201) {
        throw new Error('Unable to begin checkout');
      }
      return response.body;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to begin checkout';
      set({ error: message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  verifyCheckoutPurchase: async (checkoutToken, purchase, platform) => {
    const response = await apiClient.billing.verifyCheckoutPurchase({
      body: {
        checkoutToken,
        platform,
        productId: purchase.productId,
        purchaseToken: purchase.purchaseToken,
        originalId: purchase.originalId ?? purchase.orderId,
        jwsRepresentation: purchase.jwsRepresentation,
        originalJson: purchase.originalJson || undefined,
        signature: purchase.signature || undefined,
      },
    });
    if (response.status !== 200) {
      throw new Error('The store purchase does not belong to this checkout');
    }
  },
  claimCheckout: async (checkoutToken, purchase, platform) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.billing.claimCheckout({
        body: {
          checkoutToken,
          platform,
          productId: purchase.productId,
          purchaseToken: purchase.purchaseToken,
          originalId: purchase.originalId ?? purchase.orderId,
          jwsRepresentation: purchase.jwsRepresentation,
          originalJson: purchase.originalJson || undefined,
          signature: purchase.signature || undefined,
        },
      });
      if (response.status !== 200 || !response.body.active) {
        throw new Error('The subscription could not be linked to this account');
      }
      set({ entitlement: response.body });
      return response.body;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The subscription could not be linked to this account';
      set({ error: message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  reset: () => set({ entitlement: null, isLoading: false, error: null }),
}));

export const useBillingStore = createSelectors(useBillingStoreBase);
export { useBillingStoreBase };
