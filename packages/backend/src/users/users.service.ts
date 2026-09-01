import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PUSH_PLATFORMS, PushPlatform } from '@pomi/shared';
import { createHash, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';
import { DataSource, Repository } from 'typeorm';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { UserEntity } from './users.entity';

interface CreateUserDto {
  username: string;
  password: string;
  isAdmin?: boolean;
  adminBootstrapToken?: string;
}

const FIRST_ADMIN_LOCK_KEY = 'pomi:first-admin-claim';
const MIN_ADMIN_BOOTSTRAP_TOKEN_LENGTH = 32;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly redis: Redis;
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @Inject(REDIS_CLIENT)
    redis: Redis,
    private dataSource: DataSource,
    private configService: ConfigService
  ) {
    this.redis = redis;
  }

  async findUserByUsername(username: string): Promise<UserEntity | null> {
    return await this.userRepository.findOne({ where: { username } });
  }
  async findUserById(userId: string): Promise<UserEntity | null> {
    return await this.userRepository.findOne({ where: { id: userId } });
  }

  async userExists(userId: string): Promise<boolean> {
    return this.userRepository.existsBy({ id: userId });
  }

  async createUser(userData: CreateUserDto): Promise<UserEntity> {
    const { adminBootstrapToken: _adminBootstrapToken, ...persistedUserData } =
      userData;

    if (!persistedUserData.isAdmin) {
      const userEntity = this.userRepository.create(persistedUserData);
      return await this.userRepository.save(userEntity);
    }

    this.assertFirstAdminBootstrapToken(userData.adminBootstrapToken);

    return await this.dataSource.transaction(async manager => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [FIRST_ADMIN_LOCK_KEY]
      );

      const repository = manager.getRepository(UserEntity);
      const hasAdmin = await repository.exists({
        where: { isAdmin: true },
      });
      const userEntity = repository.create({
        ...persistedUserData,
        isAdmin: !hasAdmin,
      });
      return await repository.save(userEntity);
    });
  }

  assertFirstAdminBootstrapToken(token?: string): void {
    const configuredToken = this.configService
      .get<string>('POMI_ADMIN_BOOTSTRAP_TOKEN')
      ?.trim();

    if (
      !configuredToken ||
      configuredToken.length < MIN_ADMIN_BOOTSTRAP_TOKEN_LENGTH ||
      !token
    ) {
      throw new UnauthorizedException('Invalid admin bootstrap token');
    }

    const provided = Buffer.from(token);
    const expected = Buffer.from(configuredToken);
    if (
      !timingSafeEqual(
        createHash('sha256').update(provided).digest(),
        createHash('sha256').update(expected).digest()
      )
    ) {
      throw new UnauthorizedException('Invalid admin bootstrap token');
    }
  }

  async countAdmins(): Promise<number> {
    return await this.userRepository.count({ where: { isAdmin: true } });
  }
  async associateTimerWithUser(userId: string, timerId: string): Promise<void> {
    const key = `user:${userId}:timer`;
    const keyType = await this.redis.type(key);
    if (keyType !== 'set' && keyType !== 'none') {
      await this.redis.del(key);
    }
    await this.redis.sadd(key, timerId);
  }
  async getUserTimers(userId: string): Promise<string[]> {
    const key = `user:${userId}:timer`;
    const keyType = await this.redis.type(key);
    if (keyType === 'set') {
      return await this.redis.smembers(key);
    }
    if (keyType === 'string') {
      const value = await this.redis.get(key);
      return value ? [value] : [];
    }
    return [];
  }

  async updatePushToken(
    userId: string,
    token: string,
    platform: PushPlatform
  ): Promise<void> {
    this.logger.warn('Updating a push token');
    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (platform === PUSH_PLATFORMS.ANDROID) {
      user.fcmToken = token;
    } else if (platform === PUSH_PLATFORMS.IOS) {
      user.apnToken = token;
    }

    await this.userRepository.save(user);
  }

  async hasPushToken(userId: string): Promise<boolean> {
    const user = await this.findUserById(userId);
    if (!user) {
      return false;
    }
    return !!(user.fcmToken || user.apnToken);
  }

  async clearPushToken(userId: string, platform: PushPlatform): Promise<void> {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (platform === PUSH_PLATFORMS.ANDROID) {
      user.fcmToken = null;
    } else if (platform === PUSH_PLATFORMS.IOS) {
      user.apnToken = null;
    }

    await this.userRepository.save(user);
  }
}
