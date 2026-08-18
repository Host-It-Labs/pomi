import { TIMER_TYPES, TopIntentionsPeriod } from '@pomi/shared';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class TopIntentionsQueryDto {
  @IsIn(['today', 'week', 'month', 'year'])
  period: TopIntentionsPeriod;

  @IsOptional()
  @IsIn([TIMER_TYPES.WORK, TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK])
  type?:
    | typeof TIMER_TYPES.WORK
    | typeof TIMER_TYPES.BREAK
    | typeof TIMER_TYPES.LONG_BREAK;

  @IsOptional()
  @IsString()
  parentIntention?: string;

  @IsOptional()
  @IsIn(['hours', 'count'])
  metric?: 'hours' | 'count';
}
