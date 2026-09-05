import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';

export class TaskArchiveQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  cursor?: string;
}
