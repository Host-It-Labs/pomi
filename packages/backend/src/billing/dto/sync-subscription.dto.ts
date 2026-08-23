import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SyncSubscriptionDto {
  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  productId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  purchaseToken: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  originalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  jwsRepresentation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  originalJson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  signature?: string;
}
