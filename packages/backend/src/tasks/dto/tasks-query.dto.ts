import { TASK_STATUSES, TaskStatus } from '@pomi/shared';
import { IsEnum, IsOptional } from 'class-validator';

export class TasksQueryDto {
  @IsOptional()
  @IsEnum(TASK_STATUSES)
  status?: TaskStatus;
}
