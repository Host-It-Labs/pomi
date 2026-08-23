import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  BillingAnonymousRateLimitStore,
  normalizeClientAddress,
} from '../../src/billing/billing-anonymous-rate-limit.store';

type Bucket = { count: number; expiresAt: number };

class FakeRedis {
  private now = 0;
  private readonly buckets = new Map<string, Bucket>();

  readonly eval = vi.fn(
    async (
      _script: string,
      numberOfKeys: number,
      ...args: Array<string | number>
    ) => {
      const keys = args.slice(0, numberOfKeys).map(String);
      const windowSeconds = Number(args[numberOfKeys]);
      const limits = args
        .slice(numberOfKeys + 1, numberOfKeys * 2 + 1)
        .map(Number);
      let retryAfter = 0;

      for (const [index, key] of keys.entries()) {
        const current = this.buckets.get(key);
        if (
          current &&
          this.now < current.expiresAt &&
          current.count >= limits[index]
        ) {
          return [0, current.expiresAt - this.now];
        }
      }

      keys.forEach(key => {
        const current = this.buckets.get(key);
        const bucket =
          !current || this.now >= current.expiresAt
            ? { count: 0, expiresAt: this.now + windowSeconds }
            : current;
        bucket.count += 1;
        this.buckets.set(key, bucket);
        retryAfter = Math.max(retryAfter, bucket.expiresAt - this.now);
      });

      return [1, retryAfter];
    }
  );

  advance(seconds: number): void {
    this.now += seconds;
  }
}

function rateLimits(redis: FakeRedis): BillingAnonymousRateLimitStore {
  return new BillingAnonymousRateLimitStore(
    redis as never,
    {
      get: vi.fn((key: string) =>
        key === 'JWT_SECRET' ? 'test-rate-limit-secret' : undefined
      ),
    } as never
  );
}

describe('BillingAnonymousRateLimitStore', () => {
  it('allows the creation threshold, rejects the next request, and resets after the window', async () => {
    const redis = new FakeRedis();
    const limits = rateLimits(redis);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await limits.assertCheckoutCreationAllowed('203.0.113.10');
    }
    await expect(
      limits.assertCheckoutCreationAllowed('203.0.113.10')
    ).rejects.toMatchObject<HttpException>({ status: 429 });

    redis.advance(600);

    await expect(
      limits.assertCheckoutCreationAllowed('203.0.113.10')
    ).resolves.toBeUndefined();
  });

  it('isolates creation limits by client address', async () => {
    const redis = new FakeRedis();
    const limits = rateLimits(redis);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await limits.assertCheckoutCreationAllowed('203.0.113.20');
    }

    await expect(
      limits.assertCheckoutCreationAllowed('203.0.113.21')
    ).resolves.toBeUndefined();
  });

  it('bounds aggregate checkout growth without charging rejected client retries', async () => {
    const redis = new FakeRedis();
    const limits = rateLimits(redis);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await limits.assertCheckoutCreationAllowed('198.51.100.1');
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(
        limits.assertCheckoutCreationAllowed('198.51.100.1')
      ).rejects.toMatchObject<HttpException>({ status: 429 });
    }
    for (let attempt = 0; attempt < 990; attempt += 1) {
      await limits.assertCheckoutCreationAllowed(
        `203.${Math.floor(attempt / 256)}.${attempt % 256}.1`
      );
    }

    await expect(
      limits.assertCheckoutCreationAllowed('192.0.2.200')
    ).rejects.toMatchObject<HttpException>({ status: 429 });
  });

  it('groups IPv6 rotations by /64 and normalizes mapped IPv4 clients', async () => {
    expect(normalizeClientAddress('2001:db8:abcd:12::1')).toBe(
      'ipv6:2001:0db8:abcd:0012::/64'
    );
    expect(normalizeClientAddress('2001:db8:abcd:12:ffff::9')).toBe(
      'ipv6:2001:0db8:abcd:0012::/64'
    );
    expect(normalizeClientAddress('::ffff:192.0.2.15')).toBe('ipv4:192.0.2.15');

    const redis = new FakeRedis();
    const limits = rateLimits(redis);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await limits.assertCheckoutCreationAllowed(
        `2001:db8:abcd:12::${attempt + 1}`
      );
    }
    await expect(
      limits.assertCheckoutCreationAllowed('2001:db8:abcd:12:ffff::1')
    ).rejects.toMatchObject<HttpException>({ status: 429 });
    await expect(
      limits.assertCheckoutCreationAllowed('2001:db8:abcd:13::1')
    ).resolves.toBeUndefined();
  });

  it('limits verification independently by checkout token and client address', async () => {
    const redis = new FakeRedis();
    const limits = rateLimits(redis);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await limits.assertCheckoutVerificationAllowed(
        `198.51.100.${attempt + 1}`,
        'checkout-token-a'
      );
    }
    await expect(
      limits.assertCheckoutVerificationAllowed(
        '198.51.100.100',
        'checkout-token-a'
      )
    ).rejects.toMatchObject<HttpException>({ status: 429 });
    await expect(
      limits.assertCheckoutVerificationAllowed(
        '198.51.100.100',
        'checkout-token-b'
      )
    ).resolves.toBeUndefined();

    for (let attempt = 0; attempt < 59; attempt += 1) {
      await limits.assertCheckoutVerificationAllowed(
        '192.0.2.10',
        `isolated-token-${attempt}`
      );
    }
    await limits.assertCheckoutVerificationAllowed(
      '192.0.2.10',
      'isolated-token-59'
    );
    await expect(
      limits.assertCheckoutVerificationAllowed(
        '192.0.2.10',
        'isolated-token-60'
      )
    ).rejects.toMatchObject<HttpException>({ status: 429 });
    await expect(
      limits.assertCheckoutVerificationAllowed(
        '192.0.2.11',
        'isolated-token-60'
      )
    ).resolves.toBeUndefined();
  });

  it('stores only keyed hashes of client and checkout identifiers', async () => {
    const redis = new FakeRedis();
    const limits = rateLimits(redis);

    await limits.assertCheckoutVerificationAllowed(
      '2001:db8::1234',
      'opaque-checkout-secret'
    );

    const evaluatedArguments = redis.eval.mock.calls[0].slice(2).map(String);
    const evaluatedKeys = evaluatedArguments.slice(0, 3);
    expect(evaluatedKeys.join(' ')).not.toContain('2001:db8::1234');
    expect(evaluatedKeys.join(' ')).not.toContain('opaque-checkout-secret');
    expect(evaluatedKeys).toEqual([
      expect.stringMatching(/:verify:ip:[a-f0-9]{64}$/),
      expect.stringMatching(/:verify:checkout:[a-f0-9]{64}$/),
      expect.stringMatching(/:verify:global:all$/),
    ]);
  });

  it('fails closed when Redis cannot enforce the limit', async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
    };
    const limits = new BillingAnonymousRateLimitStore(
      redis as never,
      {
        get: vi.fn(() => 'test-rate-limit-secret'),
      } as never
    );

    await expect(
      limits.assertCheckoutCreationAllowed('203.0.113.10')
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      limits.assertCheckoutVerificationAllowed('203.0.113.10', 'checkout-token')
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed when no key-hashing secret is configured', async () => {
    const redis = new FakeRedis();
    const limits = new BillingAnonymousRateLimitStore(
      redis as never,
      {
        get: vi.fn(() => undefined),
      } as never
    );

    await expect(
      limits.assertCheckoutCreationAllowed('203.0.113.10')
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(redis.eval).not.toHaveBeenCalled();
  });
});
