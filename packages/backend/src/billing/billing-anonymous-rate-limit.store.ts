import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

const WINDOW_SECONDS = 10 * 60;
const CHECKOUT_CREATION_LIMIT = 10;
const CHECKOUT_CREATION_GLOBAL_LIMIT = 1_000;
const CHECKOUT_VERIFICATION_IP_LIMIT = 60;
const CHECKOUT_VERIFICATION_TOKEN_LIMIT = 30;
const CHECKOUT_VERIFICATION_GLOBAL_LIMIT = 5_000;

const CONSUME_RATE_LIMIT_SCRIPT = `
local windowSeconds = tonumber(ARGV[1])
local retryAfter = 0

for index, key in ipairs(KEYS) do
  local count = tonumber(redis.call('get', key) or '0')
  local ttl = redis.call('ttl', key)
  if count > 0 and ttl < 0 then
    redis.call('expire', key, windowSeconds)
    ttl = windowSeconds
  end
  if count >= tonumber(ARGV[index + 1]) then
    if ttl > retryAfter then
      retryAfter = ttl
    end
    return { 0, retryAfter }
  end
end

for _, key in ipairs(KEYS) do
  local count = redis.call('incr', key)
  local ttl = redis.call('ttl', key)
  if count == 1 or ttl < 0 then
    redis.call('expire', key, windowSeconds)
    ttl = windowSeconds
  end
  if ttl > retryAfter then
    retryAfter = ttl
  end
end

return { 1, retryAfter }
`;

@Injectable()
export class BillingAnonymousRateLimitStore {
  private readonly hashSecret: string | undefined;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService
  ) {
    this.hashSecret =
      config.get<string>('BILLING_RATE_LIMIT_HASH_SECRET')?.trim() ||
      config.get<string>('JWT_SECRET')?.trim();
  }

  async assertCheckoutCreationAllowed(
    clientAddress: string | undefined
  ): Promise<void> {
    await this.assertAllowed(
      [
        this.key('create:ip', this.hashIp(clientAddress)),
        this.key('create:global', 'all'),
      ],
      [CHECKOUT_CREATION_LIMIT, CHECKOUT_CREATION_GLOBAL_LIMIT]
    );
  }

  async assertCheckoutVerificationAllowed(
    clientAddress: string | undefined,
    checkoutToken: string
  ): Promise<void> {
    await this.assertAllowed(
      [
        this.key('verify:ip', this.hashIp(clientAddress)),
        this.key(
          'verify:checkout',
          this.hashIdentifier(`checkout:${checkoutToken}`)
        ),
        this.key('verify:global', 'all'),
      ],
      [
        CHECKOUT_VERIFICATION_IP_LIMIT,
        CHECKOUT_VERIFICATION_TOKEN_LIMIT,
        CHECKOUT_VERIFICATION_GLOBAL_LIMIT,
      ]
    );
  }

  private async assertAllowed(keys: string[], limits: number[]): Promise<void> {
    let result: unknown;
    try {
      result = await this.redis.eval(
        CONSUME_RATE_LIMIT_SCRIPT,
        keys.length,
        ...keys,
        WINDOW_SECONDS,
        ...limits
      );
    } catch {
      throw new ServiceUnavailableException(
        'Subscription checkout protection is unavailable'
      );
    }

    if (!Array.isArray(result) || result.length !== 2) {
      throw new ServiceUnavailableException(
        'Subscription checkout protection is unavailable'
      );
    }
    const allowed = Number(result[0]);
    const retryAfter = Number(result[1]);
    if (!Number.isInteger(allowed) || !Number.isFinite(retryAfter)) {
      throw new ServiceUnavailableException(
        'Subscription checkout protection is unavailable'
      );
    }
    if (allowed !== 1) {
      throw new HttpException(
        'Too many subscription checkout requests. Try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  private key(scope: string, identifierHash: string): string {
    return `pomi:billing:rate:{anonymous-checkout}:${scope}:${identifierHash}`;
  }

  private hashIp(clientAddress: string | undefined): string {
    return this.hashIdentifier(`ip:${normalizeClientAddress(clientAddress)}`);
  }

  private hashIdentifier(identifier: string): string {
    if (!this.hashSecret) {
      throw new ServiceUnavailableException(
        'Subscription checkout protection is unavailable'
      );
    }
    return createHmac('sha256', this.hashSecret)
      .update(identifier)
      .digest('hex');
  }
}

export function normalizeClientAddress(
  clientAddress: string | undefined
): string {
  const address = clientAddress
    ?.trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%[^%]+$/, '');
  if (!address) return 'unknown-client';
  if (isIP(address) === 4) return `ipv4:${address}`;

  const hextets = parseIpv6(address);
  if (!hextets) return 'unknown-client';
  if (
    hextets.slice(0, 5).every(value => value === 0) &&
    hextets[5] === 0xffff
  ) {
    return `ipv4:${hextets[6] >> 8}.${hextets[6] & 0xff}.${
      hextets[7] >> 8
    }.${hextets[7] & 0xff}`;
  }
  return `ipv6:${hextets
    .slice(0, 4)
    .map(value => value.toString(16).padStart(4, '0'))
    .join(':')}::/64`;
}

function parseIpv6(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let normalized = address;
  const ipv4Tail = address.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail && isIP(ipv4Tail) === 4) {
    const octets = ipv4Tail.split('.').map(Number);
    normalized = `${address.slice(0, -ipv4Tail.length)}${(
      (octets[0] << 8) |
      octets[1]
    ).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || omitted < 0) return null;

  const values = [
    ...left,
    ...Array.from({ length: omitted }, () => '0'),
    ...right,
  ].map(value => Number.parseInt(value, 16));
  return values.length === 8 && values.every(Number.isInteger) ? values : null;
}
