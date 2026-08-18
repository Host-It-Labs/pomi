import { TIMER_TYPES } from '@pomi/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class HeatmapQueryDto {
  @Type(() => Number)
  @IsInt()
  year: number;

  @IsOptional()
  @IsIn([TIMER_TYPES.WORK, TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK])
  type?:
    | typeof TIMER_TYPES.WORK
    | typeof TIMER_TYPES.BREAK
    | typeof TIMER_TYPES.LONG_BREAK;

  @IsOptional()
  @IsString()
  intention?: string;

  @IsOptional()
  @IsString()
  subIntention?: string;
}
