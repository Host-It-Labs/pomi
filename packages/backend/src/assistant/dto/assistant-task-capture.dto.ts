import {
  ASSISTANT_MAX_RECORDING_MINUTES,
  TASK_PRIORITIES,
  TaskPriority,
  TaskRecurrenceAnchorMode,
  TIMER_TYPES,
  TimerTypes,
} from '@pomi/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_RECURRENCE_RULE_MAX_LENGTH,
  TASK_SLUG_MAX_LENGTH,
} from '../../tasks/task-input-limits';

const ASSISTANT_AUDIO_BASE64_MAX_LENGTH = 8_000_000;

export class AssistantTaskDefaultsDto {
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
}

export class CreateAssistantTaskFromTextDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1_000_000)
  text: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AssistantTaskDefaultsDto)
  defaults?: AssistantTaskDefaultsDto;

  @IsOptional()
  @IsUUID()
  debugLogId?: string | null;
}

export class PrepareAssistantTaskFromTextDto extends CreateAssistantTaskFromTextDto {
  @IsUUID()
  preparationId: string;
}

export class AssistantAudioDto {
  @IsString()
  @MinLength(1)
  @MaxLength(ASSISTANT_AUDIO_BASE64_MAX_LENGTH)
  audioBase64: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  mimeType: string;
}

export class AssistantVoiceChunkManifestDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  audioSha256: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  mimeType: string;
}

export class TranscribeAssistantVoiceChunkDto extends AssistantAudioDto {
  @IsUUID()
  preparationId: string;

  @IsInt()
  @Min(0)
  index: number;

  @IsOptional()
  @IsUUID()
  debugLogId?: string | null;
}

export class RegisterAssistantVoiceChunksDto {
  @IsUUID()
  preparationId: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(ASSISTANT_MAX_RECORDING_MINUTES)
  @ValidateNested({ each: true })
  @Type(() => AssistantVoiceChunkManifestDto)
  manifest: AssistantVoiceChunkManifestDto[];
}

export class TranscribeAssistantTaskDto extends AssistantAudioDto {
  @IsOptional()
  @IsUUID()
  debugLogId?: string | null;
}

export class PrepareAssistantVoiceCommandDto {
  @IsUUID()
  preparationId: string;

  @IsIn(['audio', 'chunks', 'transcript'])
  kind: 'audio' | 'chunks' | 'transcript';

  @ValidateIf(value => value.kind === 'audio')
  @IsDefined({ message: 'audioBase64 is required when kind is audio' })
  @IsString()
  @MinLength(1)
  @MaxLength(ASSISTANT_AUDIO_BASE64_MAX_LENGTH)
  audioBase64?: string;

  @ValidateIf(value => value.kind === 'audio')
  @IsDefined({ message: 'mimeType is required when kind is audio' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  mimeType?: string;

  @ValidateIf(value => value.kind === 'transcript')
  @IsDefined({ message: 'transcript is required when kind is transcript' })
  @IsString()
  @MinLength(1)
  @MaxLength(1_000_000)
  transcript?: string;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  transcriptionCostUsd?: number;

  @IsOptional()
  @IsUUID()
  debugLogId?: string | null;
}

export class FinalizeAssistantVoiceCommandDto {
  @IsUUID()
  preparationId: string;
}
