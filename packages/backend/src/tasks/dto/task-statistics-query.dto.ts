import { IsIn, IsOptional } from 'class-validator';

const TASK_STATISTICS_FILTERS = ['created', 'completed', 'archived'] as const;

const TASK_RANKING_PERIODS = ['today', 'week', 'month', 'year'] as const;

export class TaskStatisticsQueryDto {
  @IsOptional()
  @IsIn(TASK_STATISTICS_FILTERS)
  filter?: (typeof TASK_STATISTICS_FILTERS)[number];

  @IsOptional()
  @IsIn(TASK_RANKING_PERIODS)
  rankingPeriod?: (typeof TASK_RANKING_PERIODS)[number];
}
