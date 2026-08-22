import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, MoreThan, Repository } from 'typeorm';
import { SubscriptionEntity } from './subscription.entity';
import type { VerifiedSubscription } from './verified-subscription';

@Injectable()
export class SubscriptionStore {
  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>
  ) {}

  async findBestForEntitlement(
    userId: string
  ): Promise<SubscriptionEntity | null> {
    const active = await this.subscriptions.findOne({
      where: {
        userId,
        state: 'active',
        expiresAt: MoreThan(new Date()),
      },
      order: { expiresAt: 'DESC', verifiedAt: 'DESC' },
    });
    if (active) return active;
    return this.subscriptions.findOne({
      where: { userId },
      order: { verifiedAt: 'DESC', expiresAt: 'DESC' },
    });
  }

  findByOriginal(
    platform: SubscriptionEntity['platform'],
    originalTransactionId: string
  ): Promise<SubscriptionEntity | null> {
    return this.subscriptions.findOne({
      where: { platform, originalTransactionId },
    });
  }

  async saveVerified(
    userId: string,
    verified: VerifiedSubscription
  ): Promise<SubscriptionEntity> {
    return this.subscriptions.manager.transaction(manager =>
      this.saveVerifiedInTransaction(manager, userId, verified)
    );
  }

  async saveVerifiedInTransaction(
    manager: EntityManager,
    userId: string,
    verified: VerifiedSubscription
  ): Promise<SubscriptionEntity> {
    const subscriptions = manager.getRepository(SubscriptionEntity);
    const verifiedAt = new Date();
    await subscriptions
      .createQueryBuilder()
      .insert()
      .values(
        subscriptions.create({
          ...verified,
          userId,
          verifiedAt,
        })
      )
      .orIgnore()
      .execute();

    const existing = await subscriptions.findOne({
      where: {
        platform: verified.platform,
        originalTransactionId: verified.originalTransactionId,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!existing) {
      throw new InternalServerErrorException(
        'Unable to persist the verified subscription'
      );
    }
    if (existing.userId !== userId) {
      throw new UnauthorizedException(
        'Subscription is linked to another Pomi account'
      );
    }
    return subscriptions.save(
      subscriptions.create({
        ...existing,
        ...verified,
        userId,
        verifiedAt,
      })
    );
  }
}
