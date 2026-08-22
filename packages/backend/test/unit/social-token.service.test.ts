import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SocialTokenService } from '../../src/auth/social-token.service';

const nonce = '49f85a1d-0cf9-4ccd-b292-976b376801b9';

function service() {
  const challenges = {
    create: vi.fn(async () => undefined),
    consume: vi.fn(async () => true),
  };
  const socialTokens = new SocialTokenService(
    {
      get: vi.fn((key: string) =>
        key === 'GOOGLE_AUTH_CLIENT_IDS' ? 'google-client-id' : ''
      ),
    } as never,
    challenges as never
  );
  const verifyIdToken = vi.fn(async () => ({
    getPayload: () => ({
      sub: 'google-user',
      email: 'FOCUS@example.com',
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
    }),
  }));
  (socialTokens as any).googleClient.verifyIdToken = verifyIdToken;
  return { challenges, socialTokens, verifyIdToken };
}

describe('SocialTokenService Google replay protection', () => {
  it('atomically binds a fresh verified token fingerprint to the challenge', async () => {
    const { challenges, socialTokens } = service();

    await expect(
      socialTokens.verify('google', 'fresh-token', 'challenge-state', nonce)
    ).resolves.toMatchObject({
      provider: 'google',
      subject: 'google-user',
      email: 'focus@example.com',
    });
    expect(challenges.consume).toHaveBeenCalledWith(
      'challenge-state',
      nonce,
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
  });

  it('rejects an identity token already consumed by another challenge', async () => {
    const { challenges, socialTokens } = service();
    challenges.consume.mockResolvedValue(false);

    await expect(
      socialTokens.verify('google', 'replayed-token', 'challenge-state', nonce)
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects stale Google identity tokens', async () => {
    const { socialTokens, verifyIdToken } = service();
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'google-user',
        iat: Math.floor(Date.now() / 1000) - 12 * 60,
      }),
    });

    await expect(
      socialTokens.verify('google', 'stale-token', 'challenge-state', nonce)
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
