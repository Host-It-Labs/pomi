import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Environment,
  SignedDataVerifier,
  type JWSTransactionDecodedPayload,
} from '@apple/app-store-server-library';
import { readFileSync } from 'node:fs';
import { SyncSubscriptionDto } from './dto/sync-subscription.dto';
import { SubscriptionProductsService } from './subscription-products.service';
import type { VerifiedSubscription } from './verified-subscription';

@Injectable()
export class AppleSubscriptionVerifierService {
  private verifier: SignedDataVerifier | null | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly products: SubscriptionProductsService
  ) {}

  async verifyPurchase(
    body: SyncSubscriptionDto,
    expectedAccountToken: string
  ): Promise<VerifiedSubscription> {
    return this.verifyBoundPurchase(body, expectedAccountToken);
  }

  async verifyBoundPurchase(
    body: SyncSubscriptionDto,
    expectedAccountToken: string
  ): Promise<VerifiedSubscription> {
    if (!body.jwsRepresentation) {
      throw new BadRequestException('StoreKit signed transaction is required');
    }
    const transaction = await this.getVerifier().verifyAndDecodeTransaction(
      body.jwsRepresentation
    );
    if (transaction.productId !== body.productId) {
      throw new BadRequestException(
        'StoreKit product does not match the request'
      );
    }
    if (transaction.appAccountToken !== expectedAccountToken) {
      throw new UnauthorizedException(
        'StoreKit transaction belongs to another account'
      );
    }
    return this.toVerified(transaction);
  }

  async decodeNotification(
    signedPayload: string
  ): Promise<VerifiedSubscription | null> {
    const verifier = this.getVerifier();
    const decoded = await verifier.verifyAndDecodeNotification(signedPayload);
    const signedTransaction = decoded.data?.signedTransactionInfo;
    if (!signedTransaction) return null;
    return this.toVerified(
      await verifier.verifyAndDecodeTransaction(signedTransaction)
    );
  }

  private toVerified(
    transaction: JWSTransactionDecodedPayload
  ): VerifiedSubscription {
    const productId = transaction.productId;
    const transactionId = transaction.transactionId;
    const originalTransactionId = transaction.originalTransactionId;
    if (!productId || !transactionId || !originalTransactionId) {
      throw new BadRequestException('StoreKit transaction is incomplete');
    }
    const expiresAt = transaction.expiresDate
      ? new Date(transaction.expiresDate)
      : null;
    const revoked = transaction.revocationDate !== undefined;
    return {
      platform: 'ios',
      productId,
      plan: this.products.planFor(productId),
      transactionId,
      originalTransactionId,
      state: revoked
        ? 'revoked'
        : expiresAt && expiresAt.getTime() > Date.now()
          ? 'active'
          : 'expired',
      expiresAt,
      autoRenews: null,
      environment: transaction.environment ?? null,
    };
  }

  private getVerifier(): SignedDataVerifier {
    if (this.verifier) return this.verifier;
    if (this.verifier === null) {
      throw new ServiceUnavailableException(
        'Apple subscription verification is not configured'
      );
    }
    const rootPaths = (this.config.get<string>('APPLE_ROOT_CA_PATHS') ?? '')
      .split(',')
      .map(path => path.trim())
      .filter(Boolean);
    if (rootPaths.length === 0) {
      this.verifier = null;
      throw new ServiceUnavailableException(
        'Apple subscription verification is not configured'
      );
    }
    const environment =
      this.config.get<string>('APPLE_IAP_ENVIRONMENT')?.toLowerCase() ===
      'production'
        ? Environment.PRODUCTION
        : Environment.SANDBOX;
    const appAppleIdValue = this.config.get<string>('APPLE_APP_ID');
    const appAppleId = appAppleIdValue ? Number(appAppleIdValue) : undefined;
    this.verifier = new SignedDataVerifier(
      rootPaths.map(path => readFileSync(path)),
      environment === Environment.PRODUCTION,
      environment,
      this.config.get<string>('APPLE_BUNDLE_ID') ?? 'app.pomi.community',
      appAppleId
    );
    return this.verifier;
  }
}
