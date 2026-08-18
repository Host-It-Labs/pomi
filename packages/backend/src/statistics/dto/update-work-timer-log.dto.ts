import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateWorkTimerLogDto {
  @IsOptional()
  @IsString()
  intention?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  intentions?: string[];

  @IsOptional()
  @IsObject()
  subIntentions?: Record<string, string>;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60 * 60 * 1000)
  duration: number;
}
