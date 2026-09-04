import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PUSH_PLATFORMS, PushPlatform } from '@pomi/shared';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { UserEntity } from './users.entity';

interface CreateUserDto {
  username: string;
  password: string;
  isAdmin?: boolean;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly redis: Redis;
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @Inject(REDIS_CLIENT)
    redis: Redis
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
    const userEntity = this.userRepository.create(userData);
    return await this.userRepository.save(userEntity);
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
    token: string | null,
    platform: PushPlatform
  ): Promise<void> {
    this.logger.warn('Updating a push token');
    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (platform === PUSH_PLATFORMS.ANDROID) {
      if (!token) throw new BadRequestException('Push token is required');
      user.fcmToken = token;
    } else if (platform === PUSH_PLATFORMS.IOS) {
      if (!token) throw new BadRequestException('Push token is required');
      user.apnToken = token;
    } else if (platform === PUSH_PLATFORMS.IOS_LIVE_ACTIVITY) {
      user.liveActivityToken = token;
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

  async getLiveActivityToken(userId: string): Promise<string | null> {
    const user = await this.findUserById(userId);
    return user?.liveActivityToken ?? null;
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
    } else if (platform === PUSH_PLATFORMS.IOS_LIVE_ACTIVITY) {
      user.liveActivityToken = null;
    }

    await this.userRepository.save(user);
  }
}
