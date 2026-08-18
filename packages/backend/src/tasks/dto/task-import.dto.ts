import {
  TASK_IMPORT_SOURCES,
  TASK_PRIORITIES,
  TaskImportSource,
  TIMER_TYPES,
  TimerTypes,
} from '@pomi/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_IMPORT_MAX_ROWS,
  TASK_RECURRENCE_RULE_MAX_LENGTH,
  TASK_SLUG_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from '../task-input-limits';

export class TaskImportRowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  sourceId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dueTime?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @IsEnum(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[keyof typeof TASK_PRIORITIES];

  @IsOptional()
  @IsEnum(TIMER_TYPES)
  timerType?: TimerTypes;

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
  recurrenceAnchorMode?: 'planned' | 'completion';

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
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  newIntentionTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  newIntentionEmoji?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  newSubIntentionTitle?: string | null;

  @Transform(
    ({ obj, value }) =>
      typeof obj?.include === 'boolean' ? value : obj?.include,
    { toClassOnly: true }
  )
  @IsBoolean()
  include: boolean;
}

export class TaskImportDto {
  @IsIn(Object.values(TASK_IMPORT_SOURCES))
  source: TaskImportSource;

  @IsArray()
  @ArrayMaxSize(TASK_IMPORT_MAX_ROWS)
  @ValidateNested({ each: true })
  @Type(() => TaskImportRowDto)
  tasks: TaskImportRowDto[];
}
