import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BillingService } from '../../src/billing/billing.service';
import { SubscriptionStore } from '../../src/billing/subscription.store';

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'subscription-1',
    userId: 'user-1',
    platform: 'ios',
    productId: 'app.pomi.community.pro.yearly',
    plan: 'yearly',
    transactionId: 'transaction-1',
    originalTransactionId: 'original-1',
    state: 'active',
    expiresAt: new Date(Date.now() + 86_400_000),
    autoRenews: true,
    environment: 'Sandbox',
    verifiedAt: new Date(),
    ...overrides,
  };
}

function dependencies(selfHosted = false) {
  const transactionManager = { id: 'billing-transaction-manager' };
  const store = {
    findBestForEntitlement: vi.fn(async () => null),
    findByOriginal: vi.fn(async () => null),
    saveVerified: vi.fn(async (_userId: string, value: object) => value),
    saveVerifiedInTransaction: vi.fn(
      async (_manager: object, _userId: string, value: object) => value
    ),
  };
  const apple = {
    verifyPurchase: vi.fn(),
    verifyBoundPurchase: vi.fn(),
    decodeNotification: vi.fn(),
  };
  const googlePlay = { verify: vi.fn(), verifyBoundPurchase: vi.fn() };
  const checkouts = { verify: vi.fn(), bindToUser: vi.fn() };
  const dataSource = {
    transaction: vi.fn(async (callback: (manager: object) => Promise<void>) =>
      callback(transactionManager)
    ),
  };
  return {
    store,
    apple,
    googlePlay,
    checkouts,
    dataSource,
    transactionManager,
    service: new BillingService(
      store as never,
      { isSelfHosted: vi.fn(() => selfHosted) } as never,
      apple as never,
      googlePlay as never,
      checkouts as never,
      dataSource as never
    ),
  };
}

describe('BillingService', () => {
  it('bypasses store billing for self-hosted installations', async () => {
    const { service, store } = dependencies(true);

    await expect(service.getEntitlement('user-1')).resolves.toMatchObject({
      required: false,
      active: true,
    });
    expect(store.findBestForEntitlement).not.toHaveBeenCalled();
  });

  it('persists only a verified hosted transaction before unlocking', async () => {
    const { apple, service, store } = dependencies();
    const verified = subscription();
    apple.verifyPurchase.mockResolvedValue(verified);
    store.saveVerified.mockResolvedValue(verified);
    store.findBestForEntitlement.mockResolvedValue(verified);

    await expect(
      service.sync('user-1', {
        platform: 'ios',
        productId: 'app.pomi.community.pro.yearly',
        purchaseToken: 'transaction-1',
        jwsRepresentation: 'signed',
      })
    ).resolves.toMatchObject({ required: true, active: true, plan: 'yearly' });
    expect(store.saveVerified).toHaveBeenCalledWith('user-1', verified);
  });

  it('claims a checkout-bound purchase for the authenticated user', async () => {
    const { apple, checkouts, dataSource, service, store, transactionManager } =
      dependencies();
    const verified = subscription();
    checkouts.verify.mockResolvedValue('a3d025a0-4168-40b1-9ef1-bde9b613597b');
    apple.verifyBoundPurchase.mockResolvedValue(verified);
    store.saveVerified.mockResolvedValue(verified);
    store.findBestForEntitlement.mockResolvedValue(verified);

    await expect(
      service.claim('user-1', {
        checkoutToken: 'signed-checkout',
        platform: 'ios',
        productId: 'app.pomi.community.pro.yearly',
        purchaseToken: 'transaction-1',
        jwsRepresentation: 'signed-transaction',
      })
    ).resolves.toMatchObject({ required: true, active: true, plan: 'yearly' });
    expect(checkouts.verify).toHaveBeenCalledWith('signed-checkout');
    expect(apple.verifyBoundPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutToken: 'signed-checkout' }),
      'a3d025a0-4168-40b1-9ef1-bde9b613597b'
    );
    expect(checkouts.bindToUser).toHaveBeenCalledWith(
      'a3d025a0-4168-40b1-9ef1-bde9b613597b',
      'user-1',
      transactionManager
    );
    expect(apple.verifyBoundPurchase.mock.invocationCallOrder[0]).toBeLessThan(
      checkouts.bindToUser.mock.invocationCallOrder[0]
    );
    expect(dataSource.transaction).toHaveBeenCalledOnce();
    expect(store.saveVerifiedInTransaction).toHaveBeenCalledWith(
      transactionManager,
      'user-1',
      verified
    );
    expect(store.saveVerified).not.toHaveBeenCalled();
  });

  it('delegates checkout binding validation to the platform verifier', async () => {
    const { checkouts, googlePlay, service, store } = dependencies();
    const bindingError = new UnauthorizedException(
      'Google Play subscription belongs to another account'
    );
    checkouts.verify.mockResolvedValue('a3d025a0-4168-40b1-9ef1-bde9b613597b');
    googlePlay.verifyBoundPurchase.mockRejectedValue(bindingError);

    await expect(
      service.claim('user-1', {
        checkoutToken: 'signed-checkout',
        platform: 'android',
        productId: 'app.pomi.community.pro.monthly',
        purchaseToken: 'purchase-token',
      })
    ).rejects.toBe(bindingError);
    expect(googlePlay.verifyBoundPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'android' }),
      'a3d025a0-4168-40b1-9ef1-bde9b613597b'
    );
    expect(checkouts.bindToUser).not.toHaveBeenCalled();
    expect(store.saveVerifiedInTransaction).not.toHaveBeenCalled();
    expect(store.saveVerified).not.toHaveBeenCalled();
  });

  it('verifies an active checkout purchase without claiming it', async () => {
    const { checkouts, googlePlay, service, store } = dependencies();
    const verified = subscription({
      platform: 'android',
      productId: 'app.pomi.community.pro.monthly',
      plan: 'monthly',
    });
    checkouts.verify.mockResolvedValue('a3d025a0-4168-40b1-9ef1-bde9b613597b');
    googlePlay.verifyBoundPurchase.mockResolvedValue(verified);

    await expect(
      service.verifyCheckoutPurchase({
        checkoutToken: 'signed-checkout',
        platform: 'android',
        productId: 'app.pomi.community.pro.monthly',
        purchaseToken: 'purchase-token',
      })
    ).resolves.toBeUndefined();
    expect(checkouts.bindToUser).not.toHaveBeenCalled();
    expect(store.saveVerifiedInTransaction).not.toHaveBeenCalled();
  });

  it('rejects an inactive checkout purchase during pre-auth verification', async () => {
    const { apple, checkouts, service } = dependencies();
    checkouts.verify.mockResolvedValue('a3d025a0-4168-40b1-9ef1-bde9b613597b');
    apple.verifyBoundPurchase.mockResolvedValue(
      subscription({ state: 'expired', expiresAt: new Date(Date.now() - 1) })
    );

    await expect(
      service.verifyCheckoutPurchase({
        checkoutToken: 'signed-checkout',
        platform: 'ios',
        productId: 'app.pomi.community.pro.yearly',
        purchaseToken: 'transaction-1',
        jwsRepresentation: 'signed-transaction',
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps a repeated same-user claim idempotent while refreshing its state', async () => {
    const { apple, checkouts, service, store, transactionManager } =
      dependencies();
    const existing = subscription({ userId: 'user-1' });
    checkouts.verify.mockResolvedValue('a3d025a0-4168-40b1-9ef1-bde9b613597b');
    apple.verifyBoundPurchase.mockResolvedValue(existing);
    store.saveVerified.mockResolvedValue(existing);
    store.findBestForEntitlement.mockResolvedValue(existing);

    await expect(
      service.claim('user-1', {
        checkoutToken: 'signed-checkout',
        platform: 'ios',
        productId: 'app.pomi.community.pro.yearly',
        purchaseToken: 'transaction-1',
        jwsRepresentation: 'signed-transaction',
      })
    ).resolves.toMatchObject({ active: true, plan: 'yearly' });
    expect(checkouts.bindToUser).toHaveBeenCalledWith(
      'a3d025a0-4168-40b1-9ef1-bde9b613597b',
      'user-1',
      transactionManager
    );
    expect(store.saveVerifiedInTransaction).toHaveBeenCalledWith(
      transactionManager,
      'user-1',
      existing
    );
  });

  it('keeps checkout binding and subscription persistence in the same failing transaction', async () => {
    const { apple, checkouts, dataSource, service, store, transactionManager } =
      dependencies();
    const persistenceError = new Error('subscription write failed');
    const verified = subscription();
    checkouts.verify.mockResolvedValue('a3d025a0-4168-40b1-9ef1-bde9b613597b');
    apple.verifyBoundPurchase.mockResolvedValue(verified);
    store.saveVerifiedInTransaction.mockRejectedValue(persistenceError);

    await expect(
      service.claim('user-1', {
        checkoutToken: 'signed-checkout',
        platform: 'ios',
        productId: 'app.pomi.community.pro.yearly',
        purchaseToken: 'transaction-1',
        jwsRepresentation: 'signed-transaction',
      })
    ).rejects.toBe(persistenceError);
    expect(dataSource.transaction).toHaveBeenCalledOnce();
    expect(checkouts.bindToUser).toHaveBeenCalledWith(
      'a3d025a0-4168-40b1-9ef1-bde9b613597b',
      'user-1',
      transactionManager
    );
    expect(store.saveVerifiedInTransaction).toHaveBeenCalledWith(
      transactionManager,
      'user-1',
      verified
    );
  });

  it('refreshes stale Google Play subscriptions before enforcing access', async () => {
    const { googlePlay, service, store } = dependencies();
    const stale = subscription({
      platform: 'android',
      productId: 'app.pomi.community.pro.monthly',
      plan: 'monthly',
      transactionId: 'purchase-token',
      originalTransactionId: 'purchase-token',
      state: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
      environment: 'GooglePlay',
      verifiedAt: new Date(Date.now() - 20 * 60 * 1000),
    });
    const active = subscription({
      ...stale,
      state: 'active',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      verifiedAt: new Date(),
    });
    store.findBestForEntitlement.mockResolvedValue(stale);
    googlePlay.verify.mockResolvedValue(active);
    store.saveVerified.mockResolvedValue(active);

    await expect(service.hasProductAccess('user-1')).resolves.toBe(true);
    expect(store.saveVerified).toHaveBeenCalledWith('user-1', active);
  });
});

describe('SubscriptionStore entitlement selection', () => {
  it('prefers an active replacement over a later-expiring revoked purchase', async () => {
    const activeMonthly = subscription({
      id: 'monthly',
      plan: 'monthly',
      expiresAt: new Date(Date.now() + 20 * 86_400_000),
    });
    const repository = {
      findOne: vi.fn(async options =>
        options.where.state === 'active'
          ? activeMonthly
          : subscription({
              id: 'revoked-yearly',
              state: 'revoked',
              expiresAt: new Date(Date.now() + 200 * 86_400_000),
            })
      ),
    };
    const store = new SubscriptionStore(repository as never);

    await expect(store.findBestForEntitlement('user-1')).resolves.toBe(
      activeMonthly
    );
    expect(repository.findOne).toHaveBeenCalledOnce();
  });

  it('rejects linking an existing purchase to another Pomi account', async () => {
    const existing = subscription({ userId: 'user-1' });
    const execute = vi.fn(async () => undefined);
    const builder = {
      insert: vi.fn(),
      values: vi.fn(),
      orIgnore: vi.fn(),
      execute,
    };
    builder.insert.mockReturnValue(builder);
    builder.values.mockReturnValue(builder);
    builder.orIgnore.mockReturnValue(builder);
    const transactionalRepository = {
      create: vi.fn(value => value),
      createQueryBuilder: vi.fn(() => builder),
      findOne: vi.fn(async () => existing),
      save: vi.fn(),
    };
    const manager = {
      getRepository: vi.fn(() => transactionalRepository),
    };
    const store = new SubscriptionStore({} as never);

    await expect(
      store.saveVerifiedInTransaction(
        manager as never,
        'user-2',
        subscription({ userId: undefined })
      )
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(builder.orIgnore).toHaveBeenCalledOnce();
    expect(transactionalRepository.findOne).toHaveBeenCalledWith({
      where: { platform: 'ios', originalTransactionId: 'original-1' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(transactionalRepository.save).not.toHaveBeenCalled();
  });

  it('refreshes a same-user conflict after a conflict-safe insert', async () => {
    const existing = subscription({ userId: 'user-1', state: 'expired' });
    const refreshed = subscription({
      userId: undefined,
      transactionId: 'renewal-2',
    });
    const execute = vi.fn(async () => undefined);
    const builder = {
      insert: vi.fn(),
      values: vi.fn(),
      orIgnore: vi.fn(),
      execute,
    };
    builder.insert.mockReturnValue(builder);
    builder.values.mockReturnValue(builder);
    builder.orIgnore.mockReturnValue(builder);
    const transactionalRepository = {
      create: vi.fn(value => value),
      createQueryBuilder: vi.fn(() => builder),
      findOne: vi.fn(async () => existing),
      save: vi.fn(async value => value),
    };
    const manager = {
      getRepository: vi.fn(() => transactionalRepository),
    };
    const store = new SubscriptionStore({} as never);

    await expect(
      store.saveVerifiedInTransaction(manager as never, 'user-1', refreshed)
    ).resolves.toMatchObject({
      userId: 'user-1',
      transactionId: 'renewal-2',
      state: 'active',
    });
    expect(builder.orIgnore).toHaveBeenCalledOnce();
    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'subscription-1',
        userId: 'user-1',
        transactionId: 'renewal-2',
      })
    );
  });
});
