import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

const CHALLENGE_TTL_SECONDS = 10 * 60;
const CONSUME_CHALLENGE_SCRIPT = `
local storedNonce = redis.call('get', KEYS[1])
if not storedNonce or storedNonce ~= ARGV[1] then
  return 0
end
redis.call('del', KEYS[1])
if redis.call('exists', KEYS[2]) == 1 then
  return 0
end
redis.call('set', KEYS[2], '1', 'EX', ARGV[2], 'NX')
return 1
`;

@Injectable()
export class SocialChallengeStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async create(state: string, nonce: string): Promise<void> {
    await this.redis.set(
      this.challengeKey(state),
      nonce,
      'EX',
      CHALLENGE_TTL_SECONDS,
      'NX'
    );
  }

  async consume(
    state: string,
    nonce: string,
    tokenFingerprint: string
  ): Promise<boolean> {
    const result = await this.redis.eval(
      CONSUME_CHALLENGE_SCRIPT,
      2,
      this.challengeKey(state),
      this.tokenKey(tokenFingerprint),
      nonce,
      CHALLENGE_TTL_SECONDS
    );
    return result === 1;
  }

  private challengeKey(state: string): string {
    return `pomi:auth:challenge:${state}`;
  }

  private tokenKey(fingerprint: string): string {
    return `pomi:auth:identity-token:${fingerprint}`;
  }
}
