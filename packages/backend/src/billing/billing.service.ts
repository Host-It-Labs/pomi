import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { SubscriptionEntitlement } from '@pomi/shared';
import { DataSource } from 'typeorm';
import { SystemService } from '../system/system.service';
import { AppleSubscriptionVerifierService } from './apple-subscription-verifier.service';
import { BillingCheckoutService } from './billing-checkout.service';
import { ClaimSubscriptionDto } from './dto/claim-subscription.dto';
import { SyncSubscriptionDto } from './dto/sync-subscription.dto';
import { GooglePlaySubscriptionVerifierService } from './google-play-subscription-verifier.service';
import { SubscriptionEntity } from './subscription.entity';
import { SubscriptionStore } from './subscription.store';
import type { VerifiedSubscription } from './verified-subscription';

@Injectable()
export class BillingService {
  private readonly googleRefreshes = new Map<
    string,
    Promise<SubscriptionEntity>
  >();
  private readonly googleRefreshAttempts = new Map<string, number>();

  constructor(
    private readonly store: SubscriptionStore,
    private readonly system: SystemService,
    private readonly apple: AppleSubscriptionVerifierService,
    private readonly googlePlay: GooglePlaySubscriptionVerifierService,
    private readonly checkouts: BillingCheckoutService,
    @InjectDataSource() private readonly dataSource: DataSource
  ) {}

  async hasProductAccess(userId: string): Promise<boolean> {
    if (this.system.isSelfHosted()) return true;
    const subscription = await this.resolveCurrentSubscription(userId);
    return this.isActive(subscription);
  }

  async getEntitlement(userId: string): Promise<SubscriptionEntitlement> {
    if (this.system.isSelfHosted()) {
      return {
        required: false,
        active: true,
        state: 'active',
        plan: null,
        productId: null,
        platform: null,
        expiresAt: null,
        autoRenews: null,
      };
    }

    const subscription = await this.resolveCurrentSubscription(userId);
    if (!subscription) return this.emptyEntitlement();
    const active = this.isActive(subscription);
    return {
      required: true,
      active,
      state: active ? 'active' : subscription.state,
      plan: subscription.plan,
      productId: subscription.productId,
      platform: subscription.platform,
      expiresAt: subscription.expiresAt?.toISOString() ?? null,
      autoRenews: subscription.autoRenews,
    };
  }

  async sync(userId: string, body: SyncSubscriptionDto) {
    if (this.system.isSelfHosted()) return this.getEntitlement(userId);
    const verified =
      body.platform === 'ios'
        ? await this.apple.verifyPurchase(body, userId)
        : await this.googlePlay.verify(body, userId);
    await this.store.saveVerified(userId, verified);
    return this.getEntitlement(userId);
  }

  async claim(
    userId: string,
    body: ClaimSubscriptionDto
  ): Promise<SubscriptionEntitlement> {
    const { checkoutId, verified } = await this.verifyBoundCheckout(body);
    await this.dataSource.transaction(async manager => {
      await this.checkouts.bindToUser(checkoutId, userId, manager);
      await this.store.saveVerifiedInTransaction(manager, userId, verified);
    });
    return this.getEntitlement(userId);
  }

  async verifyCheckoutPurchase(body: ClaimSubscriptionDto): Promise<void> {
    const { verified } = await this.verifyBoundCheckout(body);
    if (
      verified.state !== 'active' ||
      !verified.expiresAt ||
      verified.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException(
        'The subscription checkout does not contain an active purchase'
      );
    }
  }

  async processAppleNotification(signedPayload: string): Promise<void> {
    const verified = await this.apple.decodeNotification(signedPayload);
    if (!verified) return;
    const existing = await this.store.findByOriginal(
      'ios',
      verified.originalTransactionId
    );
    if (!existing) return;
    await this.store.saveVerified(existing.userId, verified);
  }

  private async resolveCurrentSubscription(
    userId: string
  ): Promise<SubscriptionEntity | null> {
    const stored = await this.store.findBestForEntitlement(userId);
    if (!stored) return null;
    const refreshed = await this.refreshGoogleSubscription(stored);
    if (this.isActive(refreshed)) return refreshed;
    return this.store.findBestForEntitlement(userId);
  }

  private async verifyBoundCheckout(body: ClaimSubscriptionDto): Promise<{
    checkoutId: string;
    verified: VerifiedSubscription;
  }> {
    const checkoutId = await this.checkouts.verify(body.checkoutToken);
    const verified =
      body.platform === 'ios'
        ? await this.apple.verifyBoundPurchase(body, checkoutId)
        : await this.googlePlay.verifyBoundPurchase(body, checkoutId);
    return { checkoutId, verified };
  }

  private async refreshGoogleSubscription(
    subscription: SubscriptionEntity
  ): Promise<SubscriptionEntity> {
    if (
      subscription.platform !== 'android' ||
      Date.now() - subscription.verifiedAt.getTime() < 15 * 60 * 1000
    ) {
      return subscription;
    }
    const lastAttempt = this.googleRefreshAttempts.get(subscription.id) ?? 0;
    if (Date.now() - lastAttempt < 5 * 60 * 1000) return subscription;
    const pending = this.googleRefreshes.get(subscription.id);
    if (pending) return pending;

    this.googleRefreshAttempts.set(subscription.id, Date.now());
    const refresh = this.googlePlay
      .verify(
        {
          platform: 'android',
          productId: subscription.productId,
          purchaseToken: subscription.transactionId,
          originalId: subscription.originalTransactionId,
        },
        subscription.userId
      )
      .then(verified => this.store.saveVerified(subscription.userId, verified))
      .catch(() => subscription)
      .finally(() => this.googleRefreshes.delete(subscription.id));
    this.googleRefreshes.set(subscription.id, refresh);
    return refresh;
  }

  private isActive(subscription: SubscriptionEntity | null): boolean {
    return Boolean(
      subscription?.state === 'active' &&
      subscription.expiresAt &&
      subscription.expiresAt.getTime() > Date.now()
    );
  }

  private emptyEntitlement(): SubscriptionEntitlement {
    return {
      required: true,
      active: false,
      state: 'none',
      plan: null,
      productId: null,
      platform: null,
      expiresAt: null,
      autoRenews: null,
    };
  }
}
