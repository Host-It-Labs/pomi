import type { SubscriptionEntity } from './subscription.entity';

export type VerifiedSubscription = Pick<
  SubscriptionEntity,
  | 'platform'
  | 'productId'
  | 'plan'
  | 'transactionId'
  | 'originalTransactionId'
  | 'state'
  | 'expiresAt'
  | 'autoRenews'
  | 'environment'
>;
