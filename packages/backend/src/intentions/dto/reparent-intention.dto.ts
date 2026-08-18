import { TIMER_TYPES } from '@pomi/shared';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReparentIntentionDto {
  @IsOptional()
  @IsIn([TIMER_TYPES.WORK, TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK])
  type?:
    | typeof TIMER_TYPES.WORK
    | typeof TIMER_TYPES.BREAK
    | typeof TIMER_TYPES.LONG_BREAK;

  @IsString()
  @IsNotEmpty()
  parentSlug: string;
}
