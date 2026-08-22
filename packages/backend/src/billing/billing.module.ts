import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '../redis/redis.module';
import { SystemModule } from '../system/system.module';
import { UsersModule } from '../users/users.module';
import { BillingAnonymousRateLimitStore } from './billing-anonymous-rate-limit.store';
import { BillingController } from './billing.controller';
import { BillingCheckoutEntity } from './billing-checkout.entity';
import { BillingCheckoutService } from './billing-checkout.service';
import { BillingService } from './billing.service';
import { SubscriptionEntity } from './subscription.entity';
import { AppleSubscriptionVerifierService } from './apple-subscription-verifier.service';
import { GooglePlaySubscriptionVerifierService } from './google-play-subscription-verifier.service';
import { SubscriptionProductsService } from './subscription-products.service';
import { SubscriptionStore } from './subscription.store';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([BillingCheckoutEntity, SubscriptionEntity]),
    RedisModule,
    SystemModule,
    UsersModule,
  ],
  providers: [
    BillingService,
    BillingCheckoutService,
    BillingAnonymousRateLimitStore,
    SubscriptionStore,
    SubscriptionProductsService,
    AppleSubscriptionVerifierService,
    GooglePlaySubscriptionVerifierService,
  ],
  controllers: [BillingController],
  exports: [BillingService],
})
export class BillingModule {}
