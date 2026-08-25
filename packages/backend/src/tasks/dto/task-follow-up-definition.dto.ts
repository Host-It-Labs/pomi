import {
  TASK_PRIORITIES,
  TaskPriority,
  TimerTypes,
  TIMER_TYPES,
} from '@pomi/shared';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_SLUG_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from '../task-input-limits';

export class TaskFollowUpDefinitionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  description: string | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dueTime: string | null;

  @IsEnum(TASK_PRIORITIES)
  priority: TaskPriority;

  @IsEnum(TIMER_TYPES)
  timerType: TimerTypes;

  @IsOptional()
  @IsString()
  @MaxLength(TASK_SLUG_MAX_LENGTH)
  intentionSlug: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TASK_SLUG_MAX_LENGTH)
  subIntentionSlug: string | null;

  @IsBoolean()
  vacationEligible: boolean;
}
