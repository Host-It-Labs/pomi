import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class WatchStatusQueryDto {
  @IsOptional()
  @IsIn(['intention', 'general'])
  taskMode?: 'intention' | 'general';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(12)
  limit?: number;
}
