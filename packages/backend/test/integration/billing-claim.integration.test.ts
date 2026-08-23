import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { BillingCheckoutEntity } from '../../src/billing/billing-checkout.entity';
import { BillingCheckoutService } from '../../src/billing/billing-checkout.service';
import { BillingService } from '../../src/billing/billing.service';
import { SubscriptionEntity } from '../../src/billing/subscription.entity';
import { SubscriptionStore } from '../../src/billing/subscription.store';
import type { VerifiedSubscription } from '../../src/billing/verified-subscription';
import { UserEntity } from '../../src/users/users.entity';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const USERNAME_PREFIX = 'vitest_billing_claim_';
const ORIGINAL_ID_PREFIX = 'vitest-billing-claim-';
const FIXTURES = {
  repeatedUser: 'ba110000-0000-4000-8000-000000000001',
  competingUserOne: 'ba110000-0000-4000-8000-000000000002',
  competingUserTwo: 'ba110000-0000-4000-8000-000000000003',
  rollbackUser: 'ba110000-0000-4000-8000-000000000004',
  repeatedCheckout: 'ba110000-0000-4000-8000-000000000101',
  competingCheckoutOne: 'ba110000-0000-4000-8000-000000000201',
  competingCheckoutTwo: 'ba110000-0000-4000-8000-000000000202',
  rollbackCheckout: 'ba110000-0000-4000-8000-000000000301',
} as const;

describe.runIf(hasDatabase)('Billing claim PostgreSQL integration', () => {
  let dataSource: DataSource;
  let checkouts: BillingCheckoutService;
  let store: SubscriptionStore;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [BillingCheckoutEntity, SubscriptionEntity, UserEntity],
    });
    await dataSource.initialize();
    checkouts = new BillingCheckoutService(
      dataSource.getRepository(BillingCheckoutEntity),
      { isSelfHosted: () => false } as never
    );
    store = new SubscriptionStore(dataSource.getRepository(SubscriptionEntity));
    await cleanTestData();
  });

  beforeEach(cleanTestData);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await cleanTestData();
      await dataSource.destroy();
    }
  });

  it('lets concurrent claims for one checkout and user converge on one subscription', async () => {
    await createUser(FIXTURES.repeatedUser, 'repeated');
    const checkoutToken = await createCheckout(
      FIXTURES.repeatedCheckout,
      'repeated-checkout-token'
    );
    const verified = subscription('same-user');
    const verifier = concurrentVerifier(verified, 2);
    const service = billingService(verifier);

    const entitlements = await Promise.all([
      service.claim(FIXTURES.repeatedUser, claim(checkoutToken)),
      service.claim(FIXTURES.repeatedUser, claim(checkoutToken)),
    ]);

    expect(entitlements).toEqual([
      expect.objectContaining({ active: true, plan: 'yearly' }),
      expect.objectContaining({ active: true, plan: 'yearly' }),
    ]);
    expect(verifier).toHaveBeenCalledTimes(2);
    await expect(subscriptionOwner('same-user')).resolves.toEqual({
      count: 1,
      userId: FIXTURES.repeatedUser,
    });
    await expect(checkoutOwner(FIXTURES.repeatedCheckout)).resolves.toEqual({
      userId: FIXTURES.repeatedUser,
      claimed: true,
    });
  });

  it('allows only one owner when different users concurrently claim one purchase', async () => {
    const userIds = [
      FIXTURES.competingUserOne,
      FIXTURES.competingUserTwo,
    ] as const;
    const checkoutIds = [
      FIXTURES.competingCheckoutOne,
      FIXTURES.competingCheckoutTwo,
    ] as const;
    await createUser(userIds[0], 'competing-one');
    await createUser(userIds[1], 'competing-two');
    const checkoutTokens = await Promise.all([
      createCheckout(checkoutIds[0], 'competing-checkout-token-one'),
      createCheckout(checkoutIds[1], 'competing-checkout-token-two'),
    ]);
    const verifier = concurrentVerifier(subscription('competing-users'), 2);
    const service = billingService(verifier);

    const results = await Promise.allSettled([
      service.claim(userIds[0], claim(checkoutTokens[0])),
      service.claim(userIds[1], claim(checkoutTokens[1])),
    ]);
    const winnerIndex = results.findIndex(
      result => result.status === 'fulfilled'
    );
    const loserIndex = results.findIndex(
      result => result.status === 'rejected'
    );

    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(loserIndex).toBeGreaterThanOrEqual(0);
    expect(
      results.filter(result => result.status === 'fulfilled')
    ).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(
      1
    );
    const rejected = results[loserIndex];
    expect(rejected.status).toBe('rejected');
    if (rejected.status !== 'rejected') throw new Error('Expected a loser');
    expect(rejected.reason).toBeInstanceOf(UnauthorizedException);
    expect((rejected.reason as UnauthorizedException).getStatus()).toBe(401);
    await expect(subscriptionOwner('competing-users')).resolves.toEqual({
      count: 1,
      userId: userIds[winnerIndex],
    });
    await expect(checkoutOwner(checkoutIds[winnerIndex])).resolves.toEqual({
      userId: userIds[winnerIndex],
      claimed: true,
    });
    await expect(checkoutOwner(checkoutIds[loserIndex])).resolves.toEqual({
      userId: null,
      claimed: false,
    });
  });

  it('rolls back checkout binding when subscription persistence fails', async () => {
    await createUser(FIXTURES.rollbackUser, 'rollback');
    const checkoutToken = await createCheckout(
      FIXTURES.rollbackCheckout,
      'rollback-checkout-token'
    );
    const verified = subscription('rollback');
    const persist = store.saveVerifiedInTransaction.bind(store);
    const persistenceError = new Error(
      'injected subscription persistence failure'
    );
    const persistence = vi
      .spyOn(store, 'saveVerifiedInTransaction')
      .mockImplementationOnce(async (...args) => {
        await persist(...args);
        throw persistenceError;
      });
    const service = billingService(vi.fn(async () => verified));

    await expect(
      service.claim(FIXTURES.rollbackUser, claim(checkoutToken))
    ).rejects.toBe(persistenceError);

    expect(persistence).toHaveBeenCalledOnce();
    await expect(checkoutOwner(FIXTURES.rollbackCheckout)).resolves.toEqual({
      userId: null,
      claimed: false,
    });
    await expect(subscriptionOwner('rollback')).resolves.toEqual({
      count: 0,
      userId: null,
    });
  });

  function billingService(
    verifyBoundPurchase: () => Promise<VerifiedSubscription>
  ): BillingService {
    return new BillingService(
      store,
      { isSelfHosted: () => false } as never,
      {
        verifyPurchase: vi.fn(),
        verifyBoundPurchase,
        decodeNotification: vi.fn(),
      } as never,
      { verify: vi.fn(), verifyBoundPurchase: vi.fn() } as never,
      checkouts,
      dataSource
    );
  }

  function concurrentVerifier(
    verified: VerifiedSubscription,
    expectedCalls: number
  ) {
    let arrivals = 0;
    let release!: () => void;
    const allArrived = new Promise<void>(resolve => {
      release = resolve;
    });
    return vi.fn(async () => {
      arrivals += 1;
      if (arrivals === expectedCalls) release();
      await allArrived;
      return verified;
    });
  }

  function subscription(suffix: string): VerifiedSubscription {
    return {
      platform: 'ios',
      productId: 'app.pomi.community.pro.yearly',
      plan: 'yearly',
      transactionId: `${ORIGINAL_ID_PREFIX}${suffix}-transaction`,
      originalTransactionId: `${ORIGINAL_ID_PREFIX}${suffix}`,
      state: 'active',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      autoRenews: true,
      environment: 'Sandbox',
    };
  }

  function claim(checkoutToken: string) {
    return {
      checkoutToken,
      platform: 'ios' as const,
      productId: 'app.pomi.community.pro.yearly',
      purchaseToken: 'signed-transaction',
      jwsRepresentation: 'signed-transaction',
    };
  }

  async function createUser(id: string, suffix: string): Promise<void> {
    await dataSource.getRepository(UserEntity).insert({
      id,
      username: `${USERNAME_PREFIX}${suffix}`,
      password: 'not-used',
      isAdmin: false,
      email: null,
      fcmToken: null,
      apnToken: null,
    });
  }

  async function createCheckout(id: string, token: string): Promise<string> {
    await dataSource.getRepository(BillingCheckoutEntity).insert({
      id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId: null,
      claimedAt: null,
    });
    return token;
  }

  async function subscriptionOwner(suffix: string) {
    const rows = (await dataSource.query(
      `
        SELECT COUNT(*)::int AS "count", MIN("userId"::text) AS "userId"
        FROM "subscriptions"
        WHERE "platform" = 'ios' AND "originalTransactionId" = $1
      `,
      [`${ORIGINAL_ID_PREFIX}${suffix}`]
    )) as Array<{ count: number; userId: string | null }>;
    return rows[0];
  }

  async function checkoutOwner(id: string) {
    const rows = (await dataSource.query(
      `
        SELECT "userId", "claimedAt" IS NOT NULL AS "claimed"
        FROM "billing_checkouts"
        WHERE "id" = $1
      `,
      [id]
    )) as Array<{ userId: string | null; claimed: boolean }>;
    return rows[0];
  }

  async function cleanTestData(): Promise<void> {
    await dataSource.query(
      `DELETE FROM "billing_checkouts" WHERE "id" = ANY($1::uuid[])`,
      [
        [
          FIXTURES.repeatedCheckout,
          FIXTURES.competingCheckoutOne,
          FIXTURES.competingCheckoutTwo,
          FIXTURES.rollbackCheckout,
        ],
      ]
    );
    await dataSource.query(
      `DELETE FROM "subscriptions" WHERE "originalTransactionId" LIKE $1`,
      [`${ORIGINAL_ID_PREFIX}%`]
    );
    await dataSource.query(`DELETE FROM "users" WHERE "username" LIKE $1`, [
      `${USERNAME_PREFIX}%`,
    ]);
  }
});
