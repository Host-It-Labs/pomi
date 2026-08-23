import type { Purchase } from '@choochmeque/tauri-plugin-iap-api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import type { PendingCheckoutState } from './access/checkoutTypes';
import { Paywall } from './Paywall';

const CHECKOUT_ID = '550e8400-e29b-41d4-a716-446655440000';
const MONTHLY_PRODUCT_ID = 'app.pomi.community.pro.monthly';
const YEARLY_PRODUCT_ID = 'app.pomi.community.pro.yearly';

const state = vi.hoisted(() => ({
  createCheckout: vi.fn(async () => ({
    checkoutId: '550e8400-e29b-41d4-a716-446655440000',
    checkoutToken: 'checkout-token',
  })),
  getProducts: vi.fn(),
  syncPurchase: vi.fn(),
  verifyCheckoutPurchase: vi.fn(),
  purchase: vi.fn(),
  restorePurchases: vi.fn(),
  acknowledgePurchase: vi.fn(async () => undefined),
  unregister: vi.fn(async () => undefined),
  purchaseUpdated: null as ((purchase: Purchase) => void) | null,
  platform: 'apple' as 'android' | 'apple',
  user: { id: '55a2de54-f2c2-49f7-b927-91c70e1828c4' },
}));

vi.mock('@choochmeque/tauri-plugin-iap-api', () => ({
  PurchaseState: { PURCHASED: 0, CANCELED: 1, PENDING: 2 },
  getProducts: state.getProducts,
  purchase: state.purchase,
  restorePurchases: state.restorePurchases,
  acknowledgePurchase: state.acknowledgePurchase,
  onPurchaseUpdated: vi.fn(async (callback: (purchase: Purchase) => void) => {
    state.purchaseUpdated = callback;
    return { unregister: state.unregister };
  }),
}));

vi.mock('../utils/osUtils', () => ({
  get isAndroid() {
    return state.platform === 'android';
  },
  isIos: false,
  get isMac() {
    return state.platform === 'apple';
  },
  isTauri: true,
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    use: {
      user: () => state.user,
      signOut: () => vi.fn(),
    },
  },
}));

vi.mock('../stores/billingStore', () => ({
  useBillingStore: {
    use: {
      syncPurchase: () => state.syncPurchase,
      createCheckout: () => state.createCheckout,
      verifyCheckoutPurchase: () => state.verifyCheckoutPurchase,
      error: () => null,
    },
  },
}));

function makePurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    packageName: 'app.pomi.community',
    productId: YEARLY_PRODUCT_ID,
    purchaseTime: 1,
    purchaseToken: 'purchase-token',
    purchaseState: 0,
    isAutoRenewing: true,
    isAcknowledged: true,
    originalJson: '',
    signature: '',
    originalId: 'original-id',
    jwsRepresentation: 'signed-transaction',
    ...overrides,
  };
}

function makeCheckout(
  overrides: Partial<PendingCheckoutState> = {}
): PendingCheckoutState {
  return {
    checkoutId: CHECKOUT_ID,
    checkoutToken: 'checkout-token',
    productId: YEARLY_PRODUCT_ID,
    platform: 'ios',
    ...overrides,
  };
}

function makeProduct(productId = YEARLY_PRODUCT_ID) {
  return {
    productId,
    title: productId === YEARLY_PRODUCT_ID ? 'Yearly' : 'Monthly',
    description: 'Pomi membership',
    productType: 'subs',
    formattedPrice: productId === YEARLY_PRODUCT_ID ? '$24.99' : '$2.99',
  };
}

async function getEnabledSubscribeButton(name = 'Start subscription') {
  const button = screen.getByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

function appleJws(appAccountToken: string) {
  const payload = btoa(JSON.stringify({ appAccountToken }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

beforeEach(() => {
  setLanguage('en', { persist: false });
  vi.clearAllMocks();
  state.platform = 'apple';
  state.purchaseUpdated = null;
  state.getProducts.mockResolvedValue({ products: [makeProduct()] });
  state.purchase.mockResolvedValue(makePurchase());
  state.restorePurchases.mockResolvedValue({ purchases: [] });
  state.syncPurchase.mockResolvedValue({ active: true });
  state.verifyCheckoutPurchase.mockResolvedValue(undefined);
});

describe('pre-auth paywall', () => {
  it('persists checkout identity before opening StoreKit', async () => {
    let resolvePurchase!: (value: Purchase) => void;
    state.purchase.mockReturnValue(
      new Promise(resolve => {
        resolvePurchase = resolve;
      })
    );
    const onCheckoutChanged = vi.fn();
    const onPurchased = vi.fn();
    render(
      <Paywall
        mode="pre-auth"
        onCheckoutChanged={onCheckoutChanged}
        onPurchased={onPurchased}
      />
    );

    fireEvent.click(await getEnabledSubscribeButton());

    await waitFor(() => expect(state.purchase).toHaveBeenCalledOnce());
    expect(onCheckoutChanged).toHaveBeenCalledWith(makeCheckout());
    expect(onPurchased).not.toHaveBeenCalled();
    expect(state.purchase).toHaveBeenCalledWith(
      YEARLY_PRODUCT_ID,
      'subs',
      expect.objectContaining({ appAccountToken: CHECKOUT_ID })
    );

    resolvePurchase(makePurchase());
    await waitFor(() =>
      expect(onPurchased).toHaveBeenCalledWith(
        expect.objectContaining({
          checkoutToken: 'checkout-token',
          platform: 'ios',
          purchase: expect.objectContaining({
            purchaseToken: 'purchase-token',
          }),
        })
      )
    );
    expect(state.syncPurchase).not.toHaveBeenCalled();
  });

  it('persists a pending transaction without opening login', async () => {
    const pendingPurchase = makePurchase({
      purchaseState: 2,
      purchaseToken: 'pending-token',
    });
    state.purchase.mockResolvedValue(pendingPurchase);
    const onCheckoutChanged = vi.fn();
    const onPurchased = vi.fn();
    const user = userEvent.setup();
    render(
      <Paywall
        mode="pre-auth"
        onCheckoutChanged={onCheckoutChanged}
        onPurchased={onPurchased}
      />
    );

    await user.click(await getEnabledSubscribeButton());

    expect(onCheckoutChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ purchase: pendingPurchase })
    );
    expect(onPurchased).not.toHaveBeenCalled();
    expect(
      screen.getByText('Your purchase is pending store approval.')
    ).toBeVisible();
  });

  it('recovers a completed StoreKit transaction after relaunch', async () => {
    const restoredPurchase = makePurchase({
      purchaseToken: 'restored-token',
      jwsRepresentation: appleJws(CHECKOUT_ID),
    });
    state.restorePurchases.mockResolvedValue({ purchases: [restoredPurchase] });
    const onCheckoutChanged = vi.fn();
    const onPurchased = vi.fn();

    render(
      <Paywall
        mode="pre-auth"
        resumeCheckout={makeCheckout()}
        onCheckoutChanged={onCheckoutChanged}
        onPurchased={onPurchased}
      />
    );

    await waitFor(() =>
      expect(onPurchased).toHaveBeenCalledWith(
        expect.objectContaining({ purchase: restoredPurchase })
      )
    );
    expect(onCheckoutChanged).toHaveBeenCalledWith(
      expect.objectContaining({ purchase: restoredPurchase })
    );
  });

  it('listens for a pending transaction becoming purchased', async () => {
    const pendingPurchase = makePurchase({
      purchaseState: 2,
      purchaseToken: 'pending-token',
    });
    const checkout = makeCheckout({ purchase: pendingPurchase });
    const onCheckoutChanged = vi.fn();
    const onPurchased = vi.fn();
    render(
      <Paywall
        mode="pre-auth"
        resumeCheckout={checkout}
        onCheckoutChanged={onCheckoutChanged}
        onPurchased={onPurchased}
      />
    );
    await waitFor(() => expect(state.purchaseUpdated).not.toBeNull());

    state.purchaseUpdated?.(
      makePurchase({ purchaseToken: 'pending-token', purchaseState: 0 })
    );

    await waitFor(() => expect(onPurchased).toHaveBeenCalledOnce());
  });

  it('server-verifies an Android restore before attaching it to checkout', async () => {
    state.platform = 'android';
    const arbitraryPurchase = makePurchase({
      purchaseTime: 50,
      purchaseToken: 'another-checkout-token',
    });
    state.restorePurchases.mockResolvedValue({
      purchases: [arbitraryPurchase],
    });
    const onCheckoutChanged = vi.fn();
    const onPurchased = vi.fn();
    render(
      <Paywall
        mode="pre-auth"
        resumeCheckout={makeCheckout({ platform: 'android' })}
        onCheckoutChanged={onCheckoutChanged}
        onPurchased={onPurchased}
      />
    );

    await waitFor(() => expect(state.restorePurchases).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(state.verifyCheckoutPurchase).toHaveBeenCalledWith(
        'checkout-token',
        arbitraryPurchase,
        'android'
      )
    );
    await waitFor(() =>
      expect(onPurchased).toHaveBeenCalledWith(
        expect.objectContaining({ purchase: arbitraryPurchase })
      )
    );
  });

  it('does not attach an Android restore rejected by checkout verification', async () => {
    state.platform = 'android';
    const wrongPurchase = makePurchase({ purchaseToken: 'wrong-checkout' });
    state.restorePurchases.mockResolvedValue({ purchases: [wrongPurchase] });
    state.verifyCheckoutPurchase.mockRejectedValue(
      new Error('The store purchase does not belong to this checkout')
    );
    const onCheckoutChanged = vi.fn();
    const onPurchased = vi.fn();

    render(
      <Paywall
        mode="pre-auth"
        resumeCheckout={makeCheckout({ platform: 'android' })}
        onCheckoutChanged={onCheckoutChanged}
        onPurchased={onPurchased}
      />
    );

    await waitFor(() =>
      expect(state.verifyCheckoutPurchase).toHaveBeenCalledOnce()
    );
    expect(onCheckoutChanged).not.toHaveBeenCalled();
    expect(onPurchased).not.toHaveBeenCalled();
  });

  it('recovers Android only when the restored purchase token was persisted', async () => {
    state.platform = 'android';
    const persistedPendingPurchase = makePurchase({
      purchaseState: 2,
      purchaseToken: 'persisted-token',
    });
    const matchingPurchase = makePurchase({
      purchaseTime: 10,
      purchaseToken: 'persisted-token',
    });
    const newerArbitraryPurchase = makePurchase({
      purchaseTime: 20,
      purchaseToken: 'newer-arbitrary-token',
    });
    state.restorePurchases.mockResolvedValue({
      purchases: [newerArbitraryPurchase, matchingPurchase],
    });
    const onCheckoutChanged = vi.fn();
    const onPurchased = vi.fn();

    render(
      <Paywall
        mode="pre-auth"
        resumeCheckout={makeCheckout({
          platform: 'android',
          purchase: persistedPendingPurchase,
        })}
        onCheckoutChanged={onCheckoutChanged}
        onPurchased={onPurchased}
      />
    );

    await waitFor(() =>
      expect(onPurchased).toHaveBeenCalledWith(
        expect.objectContaining({ purchase: matchingPurchase })
      )
    );
    expect(onCheckoutChanged).toHaveBeenCalledWith(
      expect.objectContaining({ purchase: matchingPurchase })
    );
    expect(onCheckoutChanged).not.toHaveBeenCalledWith(
      expect.objectContaining({ purchase: newerArbitraryPurchase })
    );
  });
});

describe('store products', () => {
  it('keeps checkout disabled when the store returns no requested products', async () => {
    state.getProducts.mockResolvedValue({ products: [] });
    render(<Paywall mode="pre-auth" />);

    expect(
      await screen.findByText('The store is not available right now.')
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Start subscription' })
    ).toBeDisabled();
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(state.purchase).not.toHaveBeenCalled();
    expect(state.createCheckout).not.toHaveBeenCalled();
  });

  it('requires selecting a product that the store actually returned', async () => {
    state.getProducts.mockResolvedValue({
      products: [makeProduct(MONTHLY_PRODUCT_ID)],
    });
    const user = userEvent.setup();
    render(<Paywall mode="pre-auth" />);

    const subscribe = screen.getByRole('button', {
      name: 'Start subscription',
    });
    await waitFor(() =>
      expect(screen.getByText('Yearly').closest('button')).toBeDisabled()
    );
    expect(subscribe).toBeDisabled();

    await user.click(screen.getByText('Monthly').closest('button')!);
    expect(subscribe).toBeEnabled();
    await user.click(subscribe);

    expect(state.purchase).toHaveBeenCalledWith(
      MONTHLY_PRODUCT_ID,
      'subs',
      expect.any(Object)
    );
  });
});

describe('authenticated paywall', () => {
  it('uses the Apple backend platform for a macOS purchase', async () => {
    const user = userEvent.setup();
    render(<Paywall />);

    await user.click(await getEnabledSubscribeButton());

    expect(state.purchase).toHaveBeenCalledWith(
      YEARLY_PRODUCT_ID,
      'subs',
      expect.objectContaining({ appAccountToken: state.user.id })
    );
    expect(state.syncPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseToken: 'purchase-token' }),
      'ios'
    );
  });

  it('ignores pending restores and tries purchased candidates until one is active', async () => {
    const pending = makePurchase({
      purchaseTime: 30,
      purchaseState: 2,
      purchaseToken: 'pending-token',
    });
    const inactive = makePurchase({
      purchaseTime: 20,
      purchaseToken: 'inactive-token',
    });
    const active = makePurchase({
      purchaseTime: 10,
      purchaseToken: 'active-token',
    });
    state.restorePurchases.mockResolvedValue({
      purchases: [active, pending, inactive],
    });
    state.syncPurchase
      .mockResolvedValueOnce({ active: false })
      .mockResolvedValueOnce({ active: true });
    const user = userEvent.setup();
    render(<Paywall />);

    await user.click(screen.getByRole('button', { name: 'Restore purchases' }));

    expect(state.syncPurchase).toHaveBeenCalledTimes(2);
    expect(
      state.syncPurchase.mock.calls.map(call => call[0].purchaseToken)
    ).toEqual(['inactive-token', 'active-token']);
  });
});
