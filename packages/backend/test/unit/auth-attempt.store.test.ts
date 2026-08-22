import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { AuthAttemptStore } from '../../src/auth/auth-attempt.store';
import { AuthRateLimitException } from '../../src/auth/auth-rate-limit.exception';

function createStore(results: Array<[number, number]>, values = {}) {
  const evalCommand = vi.fn();
  for (const result of results) {
    evalCommand.mockResolvedValueOnce(result);
  }
  const config = new ConfigService(values);
  return {
    evalCommand,
    store: new AuthAttemptStore({ eval: evalCommand } as never, config),
  };
}

describe('AuthAttemptStore', () => {
  it('counts origin and identity without storing their raw values', async () => {
    const { evalCommand, store } = createStore([
      [1, 60],
      [1, 60],
    ]);

    await store.assertAuthenticationAllowed('203.0.113.4', 'SecretUser');

    expect(evalCommand).toHaveBeenCalledTimes(2);
    const keys = evalCommand.mock.calls.map(call => String(call[2]));
    expect(keys.every(key => key.startsWith('pomi:auth-limits:'))).toBe(true);
    expect(keys.join(' ')).not.toContain('203.0.113.4');
    expect(keys.join(' ')).not.toContain('secretuser');
  });

  it('returns the longest blocked retry window', async () => {
    const { store } = createStore(
      [
        [3, 25],
        [2, 41],
      ],
      {
        AUTH_ATTEMPT_ORIGIN_LIMIT: '2',
        AUTH_ATTEMPT_IDENTITY_LIMIT: '1',
      }
    );

    await expect(
      store.assertAuthenticationAllowed('203.0.113.4', 'user')
    ).rejects.toMatchObject<AuthRateLimitException>({
      retryAfterSeconds: 41,
    });
  });

  it('does not renew a fixed window whose TTL is already zero', async () => {
    const { evalCommand, store } = createStore([
      [3, 0],
      [1, 0],
    ]);

    await store.assertAuthenticationAllowed('203.0.113.4', 'user');

    expect(String(evalCommand.mock.calls[0][0])).toContain('if ttl < 0 then');
    expect(String(evalCommand.mock.calls[0][0])).not.toContain(
      'if ttl < 1 then'
    );
  });

  it('bounds registration by origin and global capacity', async () => {
    const { store } = createStore(
      [
        [2, 800],
        [11, 1200],
      ],
      {
        AUTH_REGISTRATION_ORIGIN_LIMIT: '10',
        AUTH_REGISTRATION_GLOBAL_LIMIT: '10',
      }
    );

    await expect(
      store.assertRegistrationAllowed('203.0.113.4')
    ).rejects.toMatchObject<AuthRateLimitException>({
      retryAfterSeconds: 1200,
    });
  });

  it('rejects invalid capacity configuration', () => {
    expect(
      () =>
        new AuthAttemptStore(
          { eval: vi.fn() } as never,
          new ConfigService({ AUTH_ATTEMPT_IDENTITY_LIMIT: '0' })
        )
    ).toThrow('AUTH_ATTEMPT_IDENTITY_LIMIT must be a positive integer');
  });
});
