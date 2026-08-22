import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BillingCheckoutService } from '../../src/billing/billing-checkout.service';

type CheckoutRecord = {
  id: string;
  tokenHash: string;
  userId: string | null;
  claimedAt: Date | null;
};

function service(selfHosted = false) {
  const records = new Map<string, CheckoutRecord>();
  const create = vi.fn((value: CheckoutRecord) => ({ ...value }));
  const save = vi.fn(async (record: CheckoutRecord) => {
    records.set(record.id, record);
    return record;
  });
  const findOne = vi.fn(
    async ({ where }: { where: Partial<CheckoutRecord> }) =>
      [...records.values()].find(record =>
        Object.entries(where).every(
          ([key, value]) => record[key as keyof CheckoutRecord] === value
        )
      ) ?? null
  );
  const manager = {
    getRepository: vi.fn(() => ({ findOne, save })),
  };
  const repository = {
    create,
    save,
    findOne,
  };
  return {
    records,
    create,
    save,
    findOne,
    manager,
    checkouts: new BillingCheckoutService(
      repository as never,
      {
        isSelfHosted: vi.fn(() => selfHosted),
      } as never
    ),
  };
}

describe('BillingCheckoutService', () => {
  it('persists a durable hosted checkout with only a hash of its opaque token', async () => {
    const { checkouts, records } = service();

    const checkout = await checkouts.create();
    const stored = records.get(checkout.checkoutId);

    expect(checkout.checkoutId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(checkout.checkoutToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(checkout).not.toHaveProperty('expiresAt');
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toEqual(
      expect.objectContaining({ checkoutToken: checkout.checkoutToken })
    );
    expect(JSON.stringify(stored)).not.toContain(checkout.checkoutToken);
    await expect(checkouts.verify(checkout.checkoutToken)).resolves.toBe(
      checkout.checkoutId
    );
  });

  it('keeps an unclaimed checkout valid without time-based expiry', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
      const { checkouts } = service();
      const checkout = await checkouts.create();

      vi.setSystemTime(new Date('2036-08-12T00:00:00.000Z'));

      await expect(checkouts.verify(checkout.checkoutToken)).resolves.toBe(
        checkout.checkoutId
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects checkout creation, verification, and binding for self-hosted servers', async () => {
    const { checkouts, manager } = service(true);

    await expect(checkouts.create()).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(checkouts.verify('unused')).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(
      checkouts.bindToUser('checkout-id', 'user-1', manager as never)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid checkout tokens', async () => {
    const { checkouts } = service();

    await expect(checkouts.verify('unknown-token')).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('locks and binds to the first user while allowing that user to retry', async () => {
    const { checkouts, findOne, manager, records, save } = service();
    const checkout = await checkouts.create();
    save.mockClear();

    await checkouts.bindToUser(checkout.checkoutId, 'user-1', manager as never);
    const firstClaimedAt = records.get(checkout.checkoutId)?.claimedAt;
    await checkouts.bindToUser(checkout.checkoutId, 'user-1', manager as never);

    expect(manager.getRepository).toHaveBeenCalledTimes(2);
    expect(findOne).toHaveBeenCalledWith({
      where: { id: checkout.checkoutId },
      lock: { mode: 'pessimistic_write' },
    });
    expect(save).toHaveBeenCalledOnce();
    expect(records.get(checkout.checkoutId)).toMatchObject({
      userId: 'user-1',
      claimedAt: firstClaimedAt,
    });
  });

  it('rejects binding a checkout claimed by another user', async () => {
    const { checkouts, manager, records } = service();
    const checkout = await checkouts.create();
    await checkouts.bindToUser(checkout.checkoutId, 'user-1', manager as never);

    await expect(
      checkouts.bindToUser(checkout.checkoutId, 'user-2', manager as never)
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(records.get(checkout.checkoutId)?.userId).toBe('user-1');
  });
});
