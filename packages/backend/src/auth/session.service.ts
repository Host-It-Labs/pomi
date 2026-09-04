import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { AuthSessionEntity } from './auth-session.entity';
import {
  decryptRefreshSecret,
  encryptRefreshSecret,
  hashRefreshSecret,
  refreshSecretsMatch,
} from './session-crypto';

export type AuthPlatform =
  'android' | 'ios' | 'web' | 'macos' | 'windows' | 'linux';

export type SessionPayload = {
  sub?: unknown;
  sid?: unknown;
  iat?: unknown;
  exp?: unknown;
};

export type CreatedSession = {
  sessionId: string;
  refreshToken: string;
};

export type RefreshedSession = CreatedSession & {
  userId: string;
};

type RefreshTransactionResult =
  { status: 'refreshed'; session: RefreshedSession } | { status: 'invalid' };

const SESSION_INACTIVITY_MS = 365 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_BYTES = 32;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFRESH_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REFRESH_COOKIE_KEY_CONTEXT = ':pomi-refresh-cookie-v1';

@Injectable()
export class SessionService {
  private readonly jwtSecret: string;
  private readonly legacyMigrationUntilMs: number | null;

  constructor(
    @InjectRepository(AuthSessionEntity)
    private readonly sessionRepository: Repository<AuthSessionEntity>,
    configService: ConfigService
  ) {
    this.jwtSecret = configService.getOrThrow<string>('JWT_SECRET');
    this.legacyMigrationUntilMs = this.parseLegacyMigrationDeadline(
      configService.get<string>('POMI_LEGACY_JWT_MIGRATION_UNTIL')
    );
  }

  async createSession(
    userId: string,
    platform: AuthPlatform,
    deviceId?: string
  ): Promise<CreatedSession> {
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const refreshSecret = this.createRefreshSecret();
    const now = new Date();
    const session = this.sessionRepository.create({
      id: sessionId,
      userId,
      familyId,
      refreshTokenHash: hashRefreshSecret(refreshSecret),
      currentRefreshTokenCiphertext: encryptRefreshSecret(
        refreshSecret,
        this.jwtSecret
      ),
      previousRefreshTokenHash: null,
      previousRefreshTokenExpiresAt: null,
      platform,
      deviceId: deviceId?.trim() || null,
      expiresAt: new Date(now.getTime() + SESSION_INACTIVITY_MS),
      lastUsedAt: now,
      revokedAt: null,
      revocationReason: null,
    });
    await this.sessionRepository.save(session);

    return {
      sessionId,
      refreshToken: this.formatRefreshToken(sessionId, refreshSecret),
    };
  }

  async refreshSession(
    rawRefreshToken: string,
    platform: AuthPlatform
  ): Promise<RefreshedSession> {
    const parsed = this.parseRefreshToken(rawRefreshToken);
    if (!parsed) throw new UnauthorizedException('Invalid session');

    const result =
      await this.sessionRepository.manager.transaction<RefreshTransactionResult>(
        async manager => {
          const repository = manager.getRepository(AuthSessionEntity);
          const session = await repository.findOne({
            where: { id: parsed.sessionId },
            lock: { mode: 'pessimistic_write' },
          });
          const now = new Date();

          if (!session || session.revokedAt || session.expiresAt <= now) {
            if (session && !session.revokedAt && session.expiresAt <= now) {
              await repository.update(session.id, {
                revokedAt: now,
                revocationReason: 'expired',
              });
            }
            return { status: 'invalid' };
          }

          const presentedHash = hashRefreshSecret(parsed.secret);
          if (refreshSecretsMatch(presentedHash, session.refreshTokenHash)) {
            const nextSecret = this.createRefreshSecret();
            const nextHash = hashRefreshSecret(nextSecret);
            const nextExpiresAt = new Date(
              now.getTime() + SESSION_INACTIVITY_MS
            );
            await repository.update(session.id, {
              refreshTokenHash: nextHash,
              currentRefreshTokenCiphertext: encryptRefreshSecret(
                nextSecret,
                this.jwtSecret
              ),
              previousRefreshTokenHash: session.refreshTokenHash,
              previousRefreshTokenExpiresAt: nextExpiresAt,
              platform,
              expiresAt: nextExpiresAt,
              lastUsedAt: now,
            });
            return {
              status: 'refreshed',
              session: {
                userId: session.userId,
                sessionId: session.id,
                refreshToken: this.formatRefreshToken(session.id, nextSecret),
              },
            };
          }

          const previousIsValid =
            session.previousRefreshTokenExpiresAt !== null &&
            session.previousRefreshTokenExpiresAt > now &&
            session.previousRefreshTokenHash !== null &&
            refreshSecretsMatch(
              presentedHash,
              session.previousRefreshTokenHash
            );
          if (previousIsValid) {
            try {
              const currentSecret = decryptRefreshSecret(
                session.currentRefreshTokenCiphertext,
                this.jwtSecret
              );
              return {
                status: 'refreshed',
                session: {
                  userId: session.userId,
                  sessionId: session.id,
                  refreshToken: this.formatRefreshToken(
                    session.id,
                    currentSecret
                  ),
                },
              };
            } catch {
              await this.revokeFamily(
                repository,
                session.familyId,
                now,
                'refresh-secret-corrupt'
              );
              return { status: 'invalid' };
            }
          }

          await this.revokeFamily(
            repository,
            session.familyId,
            now,
            'refresh-replay'
          );
          return { status: 'invalid' };
        }
      );

    if (result.status === 'invalid') {
      throw new UnauthorizedException('Invalid session');
    }
    return result.session;
  }

  async getRefreshSessionUserId(rawRefreshToken: string): Promise<string> {
    const parsed = this.parseRefreshToken(rawRefreshToken);
    if (!parsed) throw new UnauthorizedException('Invalid session');

    const userId = await this.sessionRepository.manager.transaction<
      string | null
    >(async manager => {
      const repository = manager.getRepository(AuthSessionEntity);
      const session = await repository.findOne({
        where: { id: parsed.sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date();
      if (!session || session.revokedAt) return null;
      if (session.expiresAt <= now) {
        await repository.update(session.id, {
          revokedAt: now,
          revocationReason: 'expired',
        });
        return null;
      }

      const presentedHash = hashRefreshSecret(parsed.secret);
      const currentMatches = refreshSecretsMatch(
        presentedHash,
        session.refreshTokenHash
      );
      const previousMatches =
        session.previousRefreshTokenHash !== null &&
        session.previousRefreshTokenExpiresAt !== null &&
        session.previousRefreshTokenExpiresAt > now &&
        refreshSecretsMatch(presentedHash, session.previousRefreshTokenHash);
      if (currentMatches || previousMatches) return session.userId;

      await this.revokeFamily(
        repository,
        session.familyId,
        now,
        'refresh-replay'
      );
      return null;
    });
    if (!userId) {
      throw new UnauthorizedException('Invalid session');
    }
    return userId;
  }

  async revokeAccessSession(sessionId: string, userId: string): Promise<void> {
    await this.sessionRepository.update(
      { id: sessionId, userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revocationReason: 'logout' }
    );
  }

  async revokeRefreshSession(rawRefreshToken: string): Promise<void> {
    const parsed = this.parseRefreshToken(rawRefreshToken);
    if (!parsed) return;
    await this.sessionRepository.update(
      { id: parsed.sessionId, revokedAt: IsNull() },
      { revokedAt: new Date(), revocationReason: 'logout' }
    );
  }

  protectRefreshCookie(refreshToken: string): string {
    return encryptRefreshSecret(
      refreshToken,
      `${this.jwtSecret}${REFRESH_COOKIE_KEY_CONTEXT}`
    );
  }

  readProtectedRefreshCookie(value: string): string | null {
    try {
      return decryptRefreshSecret(
        value,
        `${this.jwtSecret}${REFRESH_COOKIE_KEY_CONTEXT}`
      );
    } catch {
      return null;
    }
  }

  async isAccessSessionActive(
    sessionId: string,
    userId: string
  ): Promise<boolean> {
    if (!UUID_PATTERN.test(sessionId) || !UUID_PATTERN.test(userId)) {
      return false;
    }

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, userId },
    });
    return Boolean(
      session && !session.revokedAt && session.expiresAt > new Date()
    );
  }

  isLegacyTokenAllowed(payload: SessionPayload): boolean {
    if (
      typeof payload.sid === 'string' ||
      !this.legacyMigrationUntilMs ||
      Date.now() >= this.legacyMigrationUntilMs
    ) {
      return false;
    }
    const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    return expiresAt > Date.now();
  }

  private async revokeFamily(
    repository: Repository<AuthSessionEntity>,
    familyId: string,
    revokedAt: Date,
    reason: string
  ): Promise<void> {
    await repository.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt, revocationReason: reason }
    );
  }

  private createRefreshSecret(): string {
    return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  }

  private formatRefreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  private parseRefreshToken(
    rawRefreshToken: string
  ): { sessionId: string; secret: string } | null {
    if (typeof rawRefreshToken !== 'string') return null;
    const separator = rawRefreshToken.indexOf('.');
    if (separator <= 0 || separator === rawRefreshToken.length - 1) {
      return null;
    }
    if (rawRefreshToken.indexOf('.', separator + 1) !== -1) return null;
    const sessionId = rawRefreshToken.slice(0, separator);
    const secret = rawRefreshToken.slice(separator + 1);
    if (!UUID_PATTERN.test(sessionId) || !REFRESH_SECRET_PATTERN.test(secret)) {
      return null;
    }
    return { sessionId, secret };
  }

  private parseLegacyMigrationDeadline(value?: string): number | null {
    if (!value?.trim()) return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        'POMI_LEGACY_JWT_MIGRATION_UNTIL must be a valid ISO timestamp'
      );
    }
    return parsed;
  }
}
