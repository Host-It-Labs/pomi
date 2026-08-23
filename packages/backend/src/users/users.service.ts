import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PushPlatform } from '@pomi/shared';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { PushDeviceEntity } from './push-device.entity';
import { UserEntity } from './users.entity';

interface CreateUserDto {
  username: string;
  password: string;
  isAdmin?: boolean;
  email?: string | null;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly redis: Redis;
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @InjectRepository(PushDeviceEntity)
    private pushDevices: Repository<PushDeviceEntity>,
    @Inject(REDIS_CLIENT)
    redis: Redis
  ) {
    this.redis = redis;
  }

  async findUserByUsername(username: string): Promise<UserEntity | null> {
    return await this.userRepository.findOne({ where: { username } });
  }
  async findUserByEmail(email: string): Promise<UserEntity | null> {
    return await this.userRepository.findOne({ where: { email } });
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
    token: string,
    platform: PushPlatform
  ): Promise<void> {
    this.logger.warn('Updating a push token');
    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.pushDevices.upsert(
      { userId, token, platform, lastSeenAt: new Date() },
      { conflictPaths: ['token'], skipUpdateIfNoValuesChanged: false }
    );
  }

  async hasPushToken(userId: string): Promise<boolean> {
    return (await this.pushDevices.count({ where: { userId } })) > 0;
  }

  async getPushTokens(
    userId: string,
    platform: PushPlatform
  ): Promise<string[]> {
    const devices = await this.pushDevices.find({
      where: { userId, platform },
      order: { lastSeenAt: 'DESC' },
    });
    return devices.map(device => device.token);
  }

  async clearPushToken(
    userId: string,
    platform: PushPlatform,
    token?: string
  ): Promise<void> {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.pushDevices.delete(
      token ? { userId, platform, token } : { userId, platform }
    );
  }

  async clearAllPushTokens(userId: string): Promise<void> {
    await this.pushDevices.delete({ userId });
  }
}
