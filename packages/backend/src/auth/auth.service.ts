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

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private preferencesService: PreferencesService,
    private systemService: SystemService
  ) {}

  async signUp(username: string, password: string, language?: AppLanguage) {
    if (!username || !password) {
      throw new BadRequestException('Username and password are required');
    }
    const requestedLanguage = this.normalizeLanguage(language);

    const existingUser = await this.usersService.findUserByUsername(username);
    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const shouldAssignAdmin =
      this.systemService.isSelfHosted() &&
      (await this.usersService.countAdmins()) === 0;
    const hashedPassword = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await this.usersService.createUser({
        username,
        password: hashedPassword,
        isAdmin: shouldAssignAdmin,
      });
    } catch (error: any) {
      if (error?.code === '23505') {
        return await this.login(username, password, requestedLanguage);
      }
      throw error;
    }

    const preferences = await this.preferencesService.getPreferences(
      user.id,
      requestedLanguage
    );

    const token = this.jwtService.sign({
      sub: user.id,
      username: user.username,
    });

    const { password: _, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      token,
      isNewUser: true,
      language: preferences.language,
    };
  }

  async login(username: string, password: string, language?: AppLanguage) {
    if (!username || !password) {
      throw new BadRequestException('Username and password are required');
    }

    const user = await this.usersService.findUserByUsername(username);
    if (!user) {
      throw new UnauthorizedException('Cannot find user');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid password');
    }

    const preferences = await this.preferencesService.getPreferences(
      user.id,
      this.normalizeLanguage(language)
    );

    const token = this.jwtService.sign({
      sub: user.id,
      username: user.username,
    });

    const { password: _, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      token,
      isNewUser: false,
      language: preferences.language,
    };
  }

  async authenticateUser(
    username: string,
    password: string,
    language?: AppLanguage
  ) {
    if (!username || !password) {
      throw new BadRequestException('Username and password are required');
    }

    username = username.toLowerCase().trim();

    const existingUser = await this.usersService.findUserByUsername(username);

    const requestedLanguage = this.normalizeLanguage(language);
    if (!existingUser) {
      return await this.signUp(username, password, requestedLanguage);
    }
    return await this.login(username, password, requestedLanguage);
  }

  private normalizeLanguage(language?: AppLanguage): AppLanguage | undefined {
    if (language === undefined) return undefined;
    const normalized = normalizeAppLanguage(language);
    if (!normalized) {
      throw new BadRequestException('Unsupported language');
    }
    return normalized;
  }
}
