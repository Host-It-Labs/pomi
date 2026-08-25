import {
  Body,
  Controller,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { apiContract, TASK_CREATION_SOURCES } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { AuthGuard } from '../auth/auth.guard';
import { CreateTaskDto } from './dto/create-task.dto';
import { ReorderTasksDto } from './dto/reorder-tasks.dto';
import { TaskImportDto } from './dto/task-import.dto';
import { TaskLogsQueryDto } from './dto/task-logs-query.dto';
import { TaskStatisticsQueryDto } from './dto/task-statistics-query.dto';
import { TaskEventLogParamDto } from './dto/task-event-log-param.dto';
import { TaskIdParamDto } from './dto/task-id.param';
import { TasksQueryDto } from './dto/tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskEntity } from './tasks.entity';
import { TasksService } from './tasks.service';

@Controller()
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private tasksService: TasksService) {}

  private formatTask(task: TaskEntity) {
    const { recurrenceSequenceIndex, followUpTaskId, ...publicTask } = task;
    void recurrenceSequenceIndex;
    void followUpTaskId;
    return {
      ...publicTask,
      followUpTaskId: null,
      followUpDefinition: task.followUpDefinition ?? null,
      followUpParent: task.followUpParent ?? null,
      itemKind: 'task' as const,
      pinnedAt:
        task.pinnedAt instanceof Date
          ? task.pinnedAt.toISOString()
          : task.pinnedAt
            ? String(task.pinnedAt)
            : null,
      createdAt:
        task.createdAt instanceof Date
          ? task.createdAt.toISOString()
          : String(task.createdAt),
      updatedAt:
        task.updatedAt instanceof Date
          ? task.updatedAt.toISOString()
          : String(task.updatedAt),
    };
  }

  @TsRestHandler(apiContract.tasks.importStatus)
  async getImportStatus(@Request() req): Promise<unknown> {
    return tsRestHandler(apiContract.tasks.importStatus, async () => ({
      status: 200,
      body: {
        hasImportedTasks: await this.tasksService.hasImportedTasks(
          req.user.sub
        ),
      },
    }));
  }

  @TsRestHandler(apiContract.tasks.statistics)
  async getTaskStatistics(
    @Request() req,
    @Query() query: TaskStatisticsQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.tasks.statistics, async () => {
      const statistics = await this.tasksService.getTaskStatistics(
        req.user.sub,
        query.filter,
        query.rankingPeriod
      );
      return {
        status: 200,
        body: statistics,
      };
    });
  }

  @TsRestHandler(apiContract.tasks.logs)
  async getTaskLogs(
    @Request() req,
    @Query() query: TaskLogsQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.tasks.logs, async () => {
      const logs = await this.tasksService.getTaskEventLogs(
        req.user.sub,
        query.limit ?? 20,
        query.offset ?? 0
      );
      return {
        status: 200,
        body: logs,
      };
    });
  }

  @TsRestHandler(apiContract.tasks.revertLog)
  async revertTaskLog(
    @Request() req,
    @Param() params: TaskEventLogParamDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.tasks.revertLog, async () => {
      const task = await this.tasksService.revertLatestTaskEvent(
        req.user.sub,
        params.id
      );
      return {
        status: 200,
        body: this.formatTask(task),
      };
    });
  }

  @TsRestHandler(apiContract.tasks.list)
  async listTasks(
    @Request() req,
    @Query() query: TasksQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.tasks.list, async () => {
      const tasks = await this.tasksService.getActiveTasks(
        req.user.sub,
        query.status
      );
      return {
        status: 200,
        body: tasks.map(task => this.formatTask(task)),
      };
    });
  }

  @TsRestHandler(apiContract.tasks.create)
  async createTask(
    @Request() req,
    @Body() data: CreateTaskDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.tasks.create, async () => {
      const task = await this.tasksService.createTask({
        userId: req.user.sub,
        title: data.title,
        description: data.description,
        dueDate: data.dueDate,
        dueTime: data.dueTime,
        priority: data.priority,
        timerType: data.timerType,
        pinned: data.pinned,
        intentionSlug: data.intentionSlug,
        subIntentionSlug: data.subIntentionSlug,
        recurrenceRule: data.recurrenceRule,
        recurrenceInterval: data.recurrenceInterval,
        recurrenceAnchorMode: data.recurrenceAnchorMode,
        followUpTaskId: data.followUpTaskId,
        followUpDefinition: data.followUpDefinition,
        followUpDelayDays: data.followUpDelayDays,
        vacationEligible: data.vacationEligible,
        creationSource: TASK_CREATION_SOURCES.MANUAL,
      });

      return {
        status: 201,
        body: this.formatTask(task),
      };
    });
  }

  @TsRestHandler(apiContract.tasks.import)
  async importTasks(
    @Request() req,
    @Body() body: TaskImportDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.tasks.import, async () => {
      const result = await this.tasksService.importTasks(
        req.user.sub,
        body.source,
        body.tasks
      );

      return {
        status: 200,
        body: {
          ...result,
          imported: result.imported.map(task => this.formatTask(task)),
          skipped: result.skipped,
        },
      };
    });
  }

  @TsRestHandler(apiContract.tasks.update)
  async updateTask(
    @Request() req,
    @Param() params: TaskIdParamDto,
    @Body() data: UpdateTaskDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.tasks.update, async () => {
      const task = await this.tasksService.updateTask(
        req.user.sub,
        params.id,
        data
      );

      return {
        status: 200,
        body: this.formatTask(task),
      };
    });
  }

  @TsRestHandler(apiContract.tasks.reorder)
  async reorderTasks(
    @Request() req,
    @Body() data: ReorderTasksDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.tasks.reorder, async () => {
      const tasks = await this.tasksService.reorderTasks(
        req.user.sub,
        data.tasks
      );

      return {
        status: 200,
        body: tasks.map(task => this.formatTask(task)),
      };
    });
  }
}
