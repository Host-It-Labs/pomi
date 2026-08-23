import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { createHash, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { SocialChallengeStore } from './social-challenge.store';

export type VerifiedSocialIdentity = {
  provider: 'google' | 'apple';
  subject: string;
  email: string | null;
  emailVerified: boolean;
};

const MAX_GOOGLE_TOKEN_AGE_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 60;

@Injectable()
export class SocialTokenService {
  private readonly googleClient = new OAuth2Client();
  private readonly appleKeys = createRemoteJWKSet(
    new URL('https://appleid.apple.com/auth/keys')
  );

  constructor(
    private readonly config: ConfigService,
    private readonly challenges: SocialChallengeStore
  ) {}

  providerAvailability() {
    return {
      google: this.googleAudiences().length > 0,
      apple: this.appleAudiences().length > 0,
    };
  }

  async createChallenge() {
    const state = randomUUID();
    const nonce = randomUUID();
    await this.challenges.create(state, nonce);
    return { state, nonce };
  }

  async verify(
    provider: 'google' | 'apple',
    identityToken: string,
    state: string,
    nonce: string
  ): Promise<VerifiedSocialIdentity> {
    const identity =
      provider === 'google'
        ? await this.verifyGoogle(identityToken, nonce)
        : await this.verifyApple(identityToken, nonce);
    const tokenFingerprint = createHash('sha256')
      .update(identityToken)
      .digest('hex');
    if (!(await this.challenges.consume(state, nonce, tokenFingerprint))) {
      throw new UnauthorizedException(
        'Social sign-in challenge is invalid or expired'
      );
    }
    return identity;
  }

  private async verifyGoogle(identityToken: string, nonce: string) {
    const audience = this.googleAudiences();
    if (audience.length === 0) {
      throw new ServiceUnavailableException('Google sign-in is not configured');
    }

    let ticket;
    try {
      ticket = await this.googleClient.verifyIdToken({
        idToken: identityToken,
        audience,
      });
    } catch {
      throw new UnauthorizedException('Google identity token is invalid');
    }
    const payload = ticket.getPayload();
    const issuedAt = payload?.iat;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !payload?.sub ||
      typeof issuedAt !== 'number' ||
      issuedAt > nowSeconds + CLOCK_SKEW_SECONDS ||
      nowSeconds - issuedAt >
        MAX_GOOGLE_TOKEN_AGE_SECONDS + CLOCK_SKEW_SECONDS ||
      (payload.nonce !== undefined && payload.nonce !== nonce)
    ) {
      throw new UnauthorizedException('Google identity token is invalid');
    }

    return {
      provider: 'google' as const,
      subject: payload.sub,
      email: payload.email?.toLowerCase() ?? null,
      emailVerified: payload.email_verified === true,
    };
  }

  private async verifyApple(identityToken: string, nonce: string) {
    const audience = this.appleAudiences();
    if (audience.length === 0) {
      throw new ServiceUnavailableException('Apple sign-in is not configured');
    }

    const hashedNonce = createHash('sha256').update(nonce).digest('hex');
    let payload;
    try {
      ({ payload } = await jwtVerify(identityToken, this.appleKeys, {
        issuer: 'https://appleid.apple.com',
        audience,
        algorithms: ['RS256'],
      }));
    } catch {
      throw new UnauthorizedException('Apple identity token is invalid');
    }
    if (
      !payload.sub ||
      typeof payload.nonce !== 'string' ||
      (payload.nonce !== nonce && payload.nonce !== hashedNonce)
    ) {
      throw new UnauthorizedException('Apple identity token is invalid');
    }

    return {
      provider: 'apple' as const,
      subject: payload.sub,
      email:
        typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      emailVerified:
        payload.email_verified === true || payload.email_verified === 'true',
    };
  }

  private googleAudiences() {
    return this.csv('GOOGLE_AUTH_CLIENT_IDS');
  }

  private appleAudiences() {
    return this.csv('APPLE_AUTH_CLIENT_IDS');
  }

  private csv(key: string) {
    return (this.config.get<string>(key) ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
  }
}
