import { TIMER_TYPES } from '@pomi/shared';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class IntentionsQueryDto {
  @IsOptional()
  @IsIn([TIMER_TYPES.WORK, TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK])
  type?:
    | typeof TIMER_TYPES.WORK
    | typeof TIMER_TYPES.BREAK
    | typeof TIMER_TYPES.LONG_BREAK;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isArchived?: boolean;

  @IsOptional()
  @IsString()
  parentSlug?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeSubIntentions?: boolean;
}
