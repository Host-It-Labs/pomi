import { Type } from 'class-transformer';
import { ASSISTANT_MAX_RECORDING_MINUTES } from '@pomi/shared';
import {
  Max,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateAssistantSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  textModel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  transcriptionModel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  speechModel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  speechVoice?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ASSISTANT_MAX_RECORDING_MINUTES)
  assistantRecordingMaxMinutes?: number | null;

  @IsOptional()
  @IsIn(['daily', 'monthly'])
  usageBudgetPeriod?: 'daily' | 'monthly';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  usageBudgetCapUsd?: number | null;
}
