import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SyncSubscriptionDto } from './sync-subscription.dto';

export class ClaimSubscriptionDto extends SyncSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000)
  checkoutToken: string;
}
