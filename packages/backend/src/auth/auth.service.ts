import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppLanguage, normalizeAppLanguage } from '@pomi/shared';
import * as bcrypt from 'bcrypt';
import { PreferencesService } from '../preferences/preferences.service';
import { SystemService } from '../system/system.service';
import { UsersService } from '../users/users.service';
import type { UserEntity } from '../users/users.entity';
import { AuthAttemptStore } from './auth-attempt.store';
import type {
  AuthPlatform,
  CreatedSession,
  RefreshedSession,
} from './session.service';
import { SessionService } from './session.service';

const MIN_REGISTRATION_PASSWORD_LENGTH = 12;
const DUMMY_PASSWORD_HASH =
  '$2b$10$RGiLuMQiskoi294uyu4BIeBXLazhtQKBxwBaFXWi3uTlTQYSMT.zW';

export type AuthenticationOptions = {
  platform?: AuthPlatform;
  deviceId?: string;
  bootstrapToken?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private preferencesService: PreferencesService,
    private systemService: SystemService,
    private authAttemptStore: AuthAttemptStore,
    private sessionService: SessionService
  ) {}

  async signUp(
    username: string,
    password: string,
    language?: AppLanguage,
    options?: AuthenticationOptions
  ) {
    if (!username || !password) {
      throw new BadRequestException('Username and password are required');
    }
    const requestedLanguage = this.normalizeLanguage(language);

    const existingUser = await this.usersService.findUserByUsername(username);
    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const shouldClaimFirstAdmin =
      this.systemService.isSelfHosted() &&
      (await this.usersService.countAdmins()) === 0;
    if (shouldClaimFirstAdmin) {
      this.usersService.assertFirstAdminBootstrapToken(options?.bootstrapToken);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await this.usersService.createUser({
        username,
        password: hashedPassword,
        isAdmin: shouldClaimFirstAdmin,
        adminBootstrapToken: options?.bootstrapToken,
      });
    } catch (error: any) {
      if (error?.code === '23505') {
        return await this.login(username, password, requestedLanguage, options);
      }
      throw error;
    }

    const preferences = await this.preferencesService.getPreferences(
      user.id,
      requestedLanguage
    );

    return await this.createSessionResult(
      user,
      preferences.language,
      true,
      options
    );
  }

  async login(
    username: string,
    password: string,
    language?: AppLanguage,
    options?: AuthenticationOptions
  ) {
    if (!username || !password) {
      throw new BadRequestException('Username and password are required');
    }

    const user = await this.usersService.findUserByUsername(username);
    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return await this.loginWithUser(user, password, language, options);
  }

  private async loginWithUser(
    user: UserEntity,
    password: string,
    language?: AppLanguage,
    options?: AuthenticationOptions
  ) {
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const preferences = await this.preferencesService.getPreferences(
      user.id,
      this.normalizeLanguage(language)
    );

    return await this.createSessionResult(
      user,
      preferences.language,
      false,
      options
    );
  }

  async authenticateUser(
    username: string,
    password: string,
    origin: string,
    language?: AppLanguage,
    options?: AuthenticationOptions
  ) {
    if (!username || !password) {
      throw new BadRequestException('Username and password are required');
    }

    username = username.toLowerCase().trim();

    await this.authAttemptStore.assertAuthenticationAllowed(origin, username);

    const existingUser = await this.usersService.findUserByUsername(username);

    const requestedLanguage = this.normalizeLanguage(language);
    if (!existingUser) {
      if (!this.hasValidRegistrationPassword(password)) {
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      }
      this.assertRegistrationPassword(password);
      await this.authAttemptStore.assertRegistrationAllowed(origin);
      return await this.signUp(username, password, requestedLanguage, options);
    }
    try {
      return await this.loginWithUser(
        existingUser,
        password,
        requestedLanguage,
        options
      );
    } catch (error) {
      if (
        error instanceof UnauthorizedException &&
        !this.hasValidRegistrationPassword(password)
      ) {
        this.assertRegistrationPassword(password);
      }
      throw error;
    }
  }

  async createSessionForUser(
    user: UserEntity,
    options?: AuthenticationOptions
  ) {
    const preferences = await this.preferencesService.getPreferences(user.id);
    const session = await this.sessionService.createSession(
      user.id,
      options?.platform ?? 'web',
      options?.deviceId
    );
    return await this.formatSessionResult(
      user,
      preferences.language,
      false,
      session
    );
  }

  async refreshSession(
    rawRefreshToken: string,
    options?: AuthenticationOptions
  ) {
    const userId =
      await this.sessionService.getRefreshSessionUserId(rawRefreshToken);
    const user = await this.usersService.findUserById(userId);
    if (!user) {
      await this.sessionService.revokeRefreshSession(rawRefreshToken);
      throw new UnauthorizedException('Invalid session');
    }

    const preferences = await this.preferencesService.getPreferences(user.id);
    const refreshed = await this.sessionService.refreshSession(
      rawRefreshToken,
      options?.platform ?? 'web'
    );
    return await this.formatSessionResult(
      user,
      preferences.language,
      false,
      refreshed
    );
  }

  private assertRegistrationPassword(password: string): void {
    if (this.hasValidRegistrationPassword(password)) return;
    throw new BadRequestException(
      'Password must be at least 12 characters and contain a non-whitespace character'
    );
  }

  private hasValidRegistrationPassword(password: string): boolean {
    return (
      [...password].length >= MIN_REGISTRATION_PASSWORD_LENGTH &&
      /\S/.test(password)
    );
  }

  private normalizeLanguage(language?: AppLanguage): AppLanguage | undefined {
    if (language === undefined) return undefined;
    const normalized = normalizeAppLanguage(language);
    if (!normalized) {
      throw new BadRequestException('Unsupported language');
    }
    return normalized;
  }

  private async createSessionResult(
    user: UserEntity,
    language: AppLanguage,
    isNewUser: boolean,
    options?: AuthenticationOptions
  ) {
    const session = await this.sessionService.createSession(
      user.id,
      options?.platform ?? 'web',
      options?.deviceId
    );
    return await this.formatSessionResult(user, language, isNewUser, session);
  }

  private formatSessionResult(
    user: UserEntity,
    language: AppLanguage,
    isNewUser: boolean,
    session: CreatedSession | RefreshedSession
  ) {
    const token = this.jwtService.sign({
      sub: user.id,
      username: user.username,
      sid: session.sessionId,
    });

    const { password: _, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      token,
      refreshToken: session.refreshToken,
      isNewUser,
      language,
    };
  }
}
