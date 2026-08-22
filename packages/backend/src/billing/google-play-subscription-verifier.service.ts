import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import { SyncSubscriptionDto } from './dto/sync-subscription.dto';
import { SubscriptionProductsService } from './subscription-products.service';
import type { VerifiedSubscription } from './verified-subscription';

type GoogleSubscriptionResponse = {
  subscriptionState?: string;
  externalAccountIdentifiers?: {
    obfuscatedExternalAccountId?: string;
  };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
  }>;
};

@Injectable()
export class GooglePlaySubscriptionVerifierService {
  constructor(
    private readonly config: ConfigService,
    private readonly products: SubscriptionProductsService
  ) {}

  async verify(
    body: SyncSubscriptionDto,
    expectedAccountToken: string
  ): Promise<VerifiedSubscription> {
    return this.verifyBoundPurchase(body, expectedAccountToken);
  }

  async verifyBoundPurchase(
    body: SyncSubscriptionDto,
    expectedAccountToken: string
  ): Promise<VerifiedSubscription> {
    const credentialsJson = this.config.get<string>(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'
    );
    const packageName =
      this.config.get<string>('GOOGLE_PLAY_PACKAGE_NAME') ??
      'app.pomi.community';
    if (!credentialsJson) {
      throw new ServiceUnavailableException(
        'Google Play subscription verification is not configured'
      );
    }
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(credentialsJson) as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException(
        'Google Play service account configuration is invalid'
      );
    }
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const client = await auth.getClient();
    const response = await client.request<GoogleSubscriptionResponse>({
      url:
        'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
        `${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/` +
        encodeURIComponent(body.purchaseToken),
    });
    if (
      response.data.externalAccountIdentifiers?.obfuscatedExternalAccountId !==
      expectedAccountToken.replace(/-/g, '')
    ) {
      throw new UnauthorizedException(
        'Google Play subscription belongs to another account'
      );
    }
    const lineItem = response.data.lineItems?.find(
      item => item.productId === body.productId
    );
    if (!lineItem?.expiryTime) {
      throw new BadRequestException('Google Play subscription is not valid');
    }
    const activeStates = new Set([
      'SUBSCRIPTION_STATE_ACTIVE',
      'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
    ]);
    const expiresAt = new Date(lineItem.expiryTime);
    return {
      platform: 'android',
      productId: body.productId,
      plan: this.products.planFor(body.productId),
      transactionId: body.purchaseToken,
      originalTransactionId: body.purchaseToken,
      state:
        activeStates.has(response.data.subscriptionState ?? '') &&
        expiresAt.getTime() > Date.now()
          ? 'active'
          : 'expired',
      expiresAt,
      autoRenews: lineItem.autoRenewingPlan?.autoRenewEnabled ?? null,
      environment: 'GooglePlay',
    };
  }
}
