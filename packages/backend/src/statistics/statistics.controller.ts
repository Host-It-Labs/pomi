import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { apiContract, TimerTypes } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { addDays, startOfDay } from 'date-fns';
import { AuthGuard } from '../auth/auth.guard';
import { User as UserDecorator } from '../users/users.decorator';
import { HeatmapQueryDto } from './dto/heatmap-query.dto';
import { StatisticsQueryDto } from './dto/statistics-query.dto';
import { TopIntentionsQueryDto } from './dto/top-intentions-query.dto';
import { UpdateWorkTimerLogDto } from './dto/update-work-timer-log.dto';
import { WorkTimerLogParamDto } from './dto/work-timer-log-param.dto';
import { WorkTimerLogsQueryDto } from './dto/work-timer-logs-query.dto';
import { StatisticsService } from './statistics.service';

@Controller()
@UseGuards(AuthGuard)
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  private resolveDailyCountRange(query: StatisticsQueryDto) {
    if (query.start === undefined && query.end === undefined) {
      const start = startOfDay(new Date()).getTime();
      return {
        start,
        end: addDays(start, 1).getTime(),
      };
    }

    if (query.start === undefined || query.end === undefined) {
      throw new BadRequestException('Daily count range is incomplete');
    }

    if (query.end <= query.start) {
      throw new BadRequestException('Daily count range is invalid');
    }

    return {
      start: query.start,
      end: query.end,
    };
  }

  @TsRestHandler(apiContract.statistics.summary)
  async getStatistics(
    @UserDecorator('sub') userId: string,
    @Query() query: StatisticsQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.statistics.summary, async () => {
      const summary = await this.statisticsService.getStatisticsSummary(
        userId,
        query.intention,
        query.type,
        query.subIntention
      );
      return {
        status: 200,
        body: summary,
      };
    });
  }

  @TsRestHandler(apiContract.workTimerLogs.list)
  async getWorkTimerLogs(
    @UserDecorator('sub') userId: string,
    @Query() query: WorkTimerLogsQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.workTimerLogs.list, async () => {
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 20;
      const logs = await this.statisticsService.getWorkTimerLogs(
        userId,
        limit,
        offset
      );
      const formattedLogs = logs.map(log => ({
        ...log,
        type: log.type as TimerTypes,
        intention: log.intention ?? undefined,
        intentionTitle: log.intentionTitle ?? undefined,
        intentionEmoji: log.intentionEmoji ?? undefined,
        intentions: log.intentions,
      }));
      return {
        status: 200,
        body: formattedLogs,
      };
    });
  }

  @TsRestHandler(apiContract.workTimerLogs.update)
  async updateWorkTimerLog(
    @UserDecorator('sub') userId: string,
    @Param() params: WorkTimerLogParamDto,
    @Body() body: UpdateWorkTimerLogDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.workTimerLogs.update, async () => {
      const log = await this.statisticsService.updateWorkTimerLog(
        userId,
        params.id,
        body
      );

      return {
        status: 200,
        body: {
          ...log,
          type: log.type as TimerTypes,
          intention: log.intention ?? undefined,
          intentionTitle: log.intentionTitle ?? undefined,
          intentionEmoji: log.intentionEmoji ?? undefined,
          intentions: log.intentions,
        },
      };
    });
  }

  @TsRestHandler(apiContract.workTimerLogs.delete)
  async deleteWorkTimerLog(
    @UserDecorator('sub') userId: string,
    @Param() params: WorkTimerLogParamDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.workTimerLogs.delete, async () => {
      await this.statisticsService.deleteWorkTimerLog(userId, params.id);

      return {
        status: 204,
        body: undefined,
      };
    });
  }

  @TsRestHandler(apiContract.statistics.intentionsToday)
  async getTodayIntentions(
    @UserDecorator('sub') userId: string,
    @Query() query: StatisticsQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.statistics.intentionsToday, async () => {
      const range = this.resolveDailyCountRange(query);
      const counts = await this.statisticsService.getTodayIntentionsCounts(
        userId,
        query.type,
        range.start,
        range.end
      );
      return {
        status: 200,
        body: counts,
      };
    });
  }

  @TsRestHandler(apiContract.statistics.topIntentions)
  async getTopIntentions(
    @UserDecorator('sub') userId: string,
    @Query() query: TopIntentionsQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.statistics.topIntentions, async () => {
      const topIntentions = await this.statisticsService.getTopIntentions(
        userId,
        query.period,
        query.type,
        query.parentIntention,
        query.metric
      );
      return {
        status: 200,
        body: topIntentions,
      };
    });
  }

  @TsRestHandler(apiContract.statistics.heatmap)
  async getHeatmap(
    @UserDecorator('sub') userId: string,
    @Query() query: HeatmapQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.statistics.heatmap, async () => {
      const result = await this.statisticsService.getHeatmapForYear(
        userId,
        query.year,
        query.type,
        query.intention,
        query.subIntention
      );
      return {
        status: 200,
        body: result,
      };
    });
  }
}
