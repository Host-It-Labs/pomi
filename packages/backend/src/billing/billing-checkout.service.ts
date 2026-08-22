import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { BillingCheckout } from '@pomi/shared';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EntityManager, Repository } from 'typeorm';
import { SystemService } from '../system/system.service';
import { BillingCheckoutEntity } from './billing-checkout.entity';

@Injectable()
export class BillingCheckoutService {
  constructor(
    @InjectRepository(BillingCheckoutEntity)
    private readonly checkouts: Repository<BillingCheckoutEntity>,
    private readonly system: SystemService
  ) {}

  async create(): Promise<BillingCheckout> {
    if (this.system.isSelfHosted()) {
      throw new BadRequestException(
        'Subscriptions are not used by self-hosted Pomi servers'
      );
    }

    const checkoutId = randomUUID();
    const checkoutToken = randomBytes(32).toString('base64url');
    await this.checkouts.save(
      this.checkouts.create({
        id: checkoutId,
        tokenHash: this.hashToken(checkoutToken),
        userId: null,
        claimedAt: null,
      })
    );

    return { checkoutId, checkoutToken };
  }

  async verify(checkoutToken: string): Promise<string> {
    if (this.system.isSelfHosted()) {
      throw new BadRequestException(
        'Subscriptions are not used by self-hosted Pomi servers'
      );
    }

    const checkout = await this.checkouts.findOne({
      where: { tokenHash: this.hashToken(checkoutToken) },
    });
    if (!checkout) {
      throw new UnauthorizedException('The subscription checkout is invalid');
    }
    return checkout.id;
  }

  async bindToUser(
    checkoutId: string,
    userId: string,
    manager: EntityManager
  ): Promise<void> {
    if (this.system.isSelfHosted()) {
      throw new BadRequestException(
        'Subscriptions are not used by self-hosted Pomi servers'
      );
    }

    const checkouts = manager.getRepository(BillingCheckoutEntity);
    const checkout = await checkouts.findOne({
      where: { id: checkoutId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!checkout) {
      throw new UnauthorizedException('The subscription checkout is invalid');
    }
    if (checkout.userId && checkout.userId !== userId) {
      throw new UnauthorizedException(
        'Subscription checkout is linked to another Pomi account'
      );
    }
    if (!checkout.userId) {
      checkout.userId = userId;
      checkout.claimedAt = new Date();
      await checkouts.save(checkout);
    }
  }

  private hashToken(checkoutToken: string): string {
    return createHash('sha256').update(checkoutToken).digest('hex');
  }
}
