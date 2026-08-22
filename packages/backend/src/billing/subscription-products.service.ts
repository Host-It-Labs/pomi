import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SubscriptionProductsService {
  constructor(private readonly config: ConfigService) {}

  planFor(productId: string): 'monthly' | 'yearly' {
    if (productId === this.productId('monthly')) return 'monthly';
    if (productId === this.productId('yearly')) return 'yearly';
    throw new BadRequestException('Subscription product is not recognized');
  }

  private productId(plan: 'monthly' | 'yearly'): string {
    const key =
      plan === 'monthly'
        ? 'POMI_SUBSCRIPTION_MONTHLY_PRODUCT_ID'
        : 'POMI_SUBSCRIPTION_YEARLY_PRODUCT_ID';
    return this.config.get<string>(key) ?? `app.pomi.community.pro.${plan}`;
  }
}
