import {
  TASK_PRIORITIES,
  TaskPriority,
  TaskRecurrenceAnchorMode,
  TimerTypes,
  TIMER_TYPES,
} from '@pomi/shared';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_FOLLOW_UP_DELAY_MAX_DAYS,
  TASK_RECURRENCE_RULE_MAX_LENGTH,
  TASK_SLUG_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from '../task-input-limits';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dueTime?: string | null;

  @IsOptional()
  @IsEnum(TASK_PRIORITIES)
  priority?: TaskPriority;

  @IsOptional()
  @IsEnum(TIMER_TYPES)
  timerType?: TimerTypes;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(TASK_SLUG_MAX_LENGTH)
  intentionSlug?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TASK_SLUG_MAX_LENGTH)
  subIntentionSlug?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TASK_RECURRENCE_RULE_MAX_LENGTH)
  recurrenceRule?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(1)
  recurrenceInterval?: number | null;

  @IsOptional()
  @IsIn(['planned', 'completion'])
  recurrenceAnchorMode?: TaskRecurrenceAnchorMode;

  @IsOptional()
  @IsUUID()
  followUpTaskId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TASK_FOLLOW_UP_DELAY_MAX_DAYS)
  followUpDelayDays?: number | null;

  @IsOptional()
  @IsBoolean()
  vacationEligible?: boolean;
}
