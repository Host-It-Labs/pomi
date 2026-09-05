import { TIMER_TYPES } from '@pomi/shared';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateIntentionDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  emoji: string;

  @IsOptional()
  @IsIn([TIMER_TYPES.WORK, TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK])
  type?:
    | typeof TIMER_TYPES.WORK
    | typeof TIMER_TYPES.BREAK
    | typeof TIMER_TYPES.LONG_BREAK;

  @IsOptional()
  @IsBoolean()
  hasCustomDuration?: boolean;

  @ValidateIf(data => data.hasCustomDuration === true)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customDuration?: number;

  @IsOptional()
  @IsBoolean()
  keepScreenAwake?: boolean;

  @IsOptional()
  @IsBoolean()
  isHabit?: boolean;

  @IsOptional()
  @IsIn(['off', 'daily', 'weekly'])
  habitCadence?: 'off' | 'daily' | 'weekly';

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsTasks?: boolean;

  @IsOptional()
  @IsUUID()
  parentIntentionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}
