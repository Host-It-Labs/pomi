import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Purchase } from '@choochmeque/tauri-plugin-iap-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../i18n';
import { AccessCoordinator } from './AccessCoordinator';
import {
  clearPendingCheckout,
  readPendingCheckout,
  savePendingCheckout,
} from './pendingCheckoutStorage';
import type { PendingCheckoutState } from './checkoutTypes';

const state = vi.hoisted(() => ({
  claimCheckout: vi.fn(async () => ({ active: true })),
  loadSystemInfo: vi.fn(async () => undefined),
  clearSystemInfo: vi.fn(),
}));

const PURCHASE = {
  packageName: 'app.pomi.community',
  productId: 'app.pomi.community.pro.yearly',
  purchaseTime: 1,
  purchaseToken: 'purchase-token',
  purchaseState: 0,
  isAutoRenewing: true,
  isAcknowledged: true,
  originalJson: '',
  signature: '',
  originalId: 'original-id',
  jwsRepresentation: 'signed-transaction',
} as Purchase;

vi.mock('../../stores/billingStore', () => ({
  useBillingStore: {
    use: { claimCheckout: () => state.claimCheckout },
  },
}));

vi.mock('../../stores/systemStore', () => ({
  useSystemStore: {
    use: {
      loadSystemInfo: () => state.loadSystemInfo,
      clearSystemInfo: () => state.clearSystemInfo,
    },
  },
}));

vi.mock('../Paywall', () => ({
  Paywall: ({
    resumeCheckout,
    onCheckoutChanged,
    onPurchased,
  }: {
    resumeCheckout?: PendingCheckoutState | null;
    onCheckoutChanged: (value: PendingCheckoutState) => void;
    onPurchased: (value: {
      checkoutId: string;
      checkoutToken: string;
      productId: string;
      purchase: Purchase;
      platform: 'ios';
    }) => void;
  }) => (
    <div>
      <span>Resume checkout: {resumeCheckout?.checkoutToken ?? 'none'}</span>
      <button
        type="button"
        onClick={() =>
          onCheckoutChanged({
            checkoutId: '550e8400-e29b-41d4-a716-446655440000',
            checkoutToken: 'checkout-token',
            productId: PURCHASE.productId,
            platform: 'ios',
          })
        }
      >
        Begin test checkout
      </button>
      <button
        type="button"
        onClick={() =>
          onPurchased({
            checkoutId: '550e8400-e29b-41d4-a716-446655440000',
            checkoutToken: 'checkout-token',
            productId: PURCHASE.productId,
            purchase: PURCHASE,
            platform: 'ios',
          })
        }
      >
        Complete test purchase
      </button>
    </div>
  ),
}));

vi.mock('../Login', () => ({
  Login: ({
    mode,
    onSession,
  }: {
    mode: string;
    onSession?: (session: object) => Promise<void>;
  }) => (
    <div>
      <span>Login mode: {mode}</span>
      <button type="button" onClick={() => void onSession?.({})}>
        Complete test login
      </button>
    </div>
  ),
}));

vi.mock('./SelfHostSetup', () => ({
  SelfHostSetup: () => <div>Self-host setup</div>,
}));

beforeEach(() => {
  clearPendingCheckout();
  setLanguage('en', { persist: false });
  state.claimCheckout.mockClear();
  state.loadSystemInfo.mockClear();
  state.clearSystemInfo.mockClear();
});

describe('AccessCoordinator', () => {
  it('launches on the polished entry surface and keeps self host secondary', () => {
    render(<AccessCoordinator />);

    expect(
      screen.getByRole('heading', {
        name: 'Pick the task. Give it 25.',
      })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Get started' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Self host' })).toBeVisible();
    expect(
      document.querySelector('[data-product-scene="welcome"]')?.className
    ).toContain('h-[300px]');
    expect(screen.getByTestId('welcome-content').className).toContain('pt-5');
  });

  it('moves purchase before account login and claims it after authentication', async () => {
    const user = userEvent.setup();
    render(<AccessCoordinator />);

    await user.click(screen.getByRole('button', { name: 'Get started' }));
    expect(
      screen.getByRole('heading', {
        name: 'The clock clears the room.',
      })
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Skip to plans' }));
    await user.click(
      screen.getByRole('button', { name: 'Complete test purchase' })
    );

    expect(screen.getByText('Login mode: hosted')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Complete test login' })
    );
    expect(state.claimCheckout).toHaveBeenCalledWith(
      'checkout-token',
      PURCHASE,
      'ios'
    );
    expect(readPendingCheckout()).toBeNull();
  });

  it('resumes an unclaimed purchase at login after relaunch', async () => {
    savePendingCheckout({
      checkoutId: '550e8400-e29b-41d4-a716-446655440000',
      checkoutToken: 'resumed-checkout-token',
      productId: PURCHASE.productId,
      purchase: PURCHASE,
      platform: 'ios',
    });
    const user = userEvent.setup();

    render(<AccessCoordinator />);

    expect(screen.getByText('Payment complete')).toBeVisible();
    expect(screen.getByText('Login mode: hosted')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Complete test login' })
    );
    expect(state.claimCheckout).toHaveBeenCalledWith(
      'resumed-checkout-token',
      PURCHASE,
      'ios'
    );
  });

  it('resumes durable checkout identity on the payment screen', async () => {
    savePendingCheckout({
      checkoutId: '550e8400-e29b-41d4-a716-446655440000',
      checkoutToken: 'durable-checkout-token',
      productId: PURCHASE.productId,
      platform: 'ios',
    });

    render(<AccessCoordinator />);

    expect(
      screen.getByText('Resume checkout: durable-checkout-token')
    ).toBeVisible();
  });

  it('does not discard durable checkout identity when leaving hosted onboarding', async () => {
    savePendingCheckout({
      checkoutId: '550e8400-e29b-41d4-a716-446655440000',
      checkoutToken: 'durable-checkout-token',
      productId: PURCHASE.productId,
      platform: 'ios',
    });
    const user = userEvent.setup();
    render(<AccessCoordinator />);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Self host' }));

    expect(readPendingCheckout()).toMatchObject({
      checkoutToken: 'durable-checkout-token',
    });
  });
});
