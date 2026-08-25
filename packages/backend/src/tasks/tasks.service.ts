import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  TASK_CREATION_SOURCES,
  TASK_FOLLOW_UP_DELAY_MAX_DAYS,
  TASK_PRIORITIES,
  TASK_MANUAL_ORDER_BOTTOM,
  TASK_STATUSES,
  TIMER_TYPE_VALUES,
  TIMER_TYPES,
  TaskImportSkippedTask,
  TaskEventLog,
  TaskFollowUpDefinition,
  TaskCreationSource,
  TaskImportSource,
  TaskPriority,
  TaskLifecycleEventType,
  TaskRecurrenceAnchorMode,
  TaskStatisticsFilter,
  TaskStatisticsSummary,
  TaskStatus,
  TimerTypes,
  TopIntentionsPeriod,
  Preferences,
} from '@pomi/shared';
import {
  In,
  IsNull,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { IntentionsService } from '../intentions/intentions.service';
import { PreferencesService } from '../preferences/preferences.service';
import { RealtimeEvents } from '../realtime/realtime-events';
import { TimerService } from '../timer/timer.service';
import {
  TaskEntity,
  TaskEventEntity,
  TaskImportRunEntity,
} from './tasks.entity';

const TASK_DEFAULT_DUE_TIME = '10:00';
const NO_INTENTION_TASK_RANKING_KEY = '[no-intention]';

const WEEKDAY_INDEX = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

type ParsedRecurrence = {
  frequency: RecurrenceFrequency;
  interval: number;
  count: number | null;
  until: Date | null;
  byDay: number[] | null;
  byMonthDay: number[] | null;
  exDates: Set<string>;
};

type TaskRankingRow = {
  slug: string;
  timerType: TimerTypes | null;
  intentionSlug: string | null;
  count: string;
};

type TaskStatisticsPeriodKey =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'previousWeek'
  | 'month'
  | 'previousMonth'
  | 'year'
  | 'previousYear';
type TaskStatisticsPeriodRange = { start: Date; end?: Date };
type TaskStatisticsPeriodCounts = Record<TaskStatisticsPeriodKey, number>;

type ImportTaskRow = {
  sourceId: string;
  title: string;
  dueDate: string | null | undefined;
  dueTime: string | null | undefined;
  description: string | null;
  priority: TaskPriority | undefined;
  timerType: TimerTypes;
  recurrenceRule: string | null;
  recurrenceInterval: number | null;
  recurrenceAnchorMode: TaskRecurrenceAnchorMode | undefined;
  intentionSlug: string | null;
  subIntentionSlug: string | null;
  newIntentionTitle: string | null;
  newIntentionEmoji: string | null;
  newSubIntentionTitle: string | null;
};

type CreateTaskInput = {
  userId: string;
  title: string;
  description?: string | null;
  sourceTranscript?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  timerType?: TimerTypes;
  pinned?: boolean;
  intentionSlug?: string | null;
  subIntentionSlug?: string | null;
  recurrenceRule?: string | null;
  recurrenceInterval?: number | null;
  recurrenceAnchorMode?: TaskRecurrenceAnchorMode;
  followUpTaskId?: string | null;
  followUpDefinition?: TaskFollowUpDefinition | null;
  followUpDelayDays?: number | null;
  vacationEligible?: boolean;
  importSource?: TaskImportSource;
  importSourceTaskId?: string;
  creationSource: TaskCreationSource;
};

export type PreparedTaskCreation = {
  task: TaskEntity;
  preferences: Preferences;
};

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private tasksRepository: Repository<TaskEntity>,
    @InjectRepository(TaskEventEntity)
    private taskEventsRepository: Repository<TaskEventEntity>,
    @InjectRepository(TaskImportRunEntity)
    private taskImportRunsRepository: Repository<TaskImportRunEntity>,
    private intentionsService: IntentionsService,
    private preferencesService: PreferencesService,
    private timerService: TimerService,
    private realtimeEvents: RealtimeEvents
  ) {}

  async getActiveTasks(userId: string, status?: TaskStatus) {
    const tasks = await this.tasksRepository.find({
      where: {
        userId,
        status: status ?? TASK_STATUSES.ACTIVE,
        itemKind: In(['task', 'followUp']),
      },
      order: {
        dueDate: 'ASC',
        manualOrder: 'ASC',
        createdAt: 'ASC',
      },
    });
    await this.attachFollowUpParents(userId, tasks, this.tasksRepository);
    return tasks;
  }

  private async attachFollowUpParents(
    userId: string,
    tasks: TaskEntity[],
    taskRepository: Repository<TaskEntity>
  ) {
    for (const task of tasks) task.followUpParent = null;
    const sourceIds = [
      ...new Set(
        tasks.map(task => task.followUpSourceTaskId).filter(Boolean) as string[]
      ),
    ];
    if (sourceIds.length === 0) return;
    const parents = await taskRepository.find({
      where: { id: In(sourceIds), userId, itemKind: In(['task', 'listItem']) },
    });
    const parentById = new Map(parents.map(parent => [parent.id, parent]));
    for (const task of tasks) {
      const parent = task.followUpSourceTaskId
        ? parentById.get(task.followUpSourceTaskId)
        : null;
      task.followUpParent = parent
        ? { id: parent.id, title: parent.title }
        : null;
    }
  }

  async hasImportedTasks(userId: string) {
    return (
      (await this.taskImportRunsRepository.count({ where: { userId } })) > 0
    );
  }

  async getTaskStatistics(
    userId: string,
    filter: TaskStatisticsFilter = 'completed',
    rankingPeriod: TopIntentionsPeriod = 'week'
  ): Promise<TaskStatisticsSummary> {
    const now = new Date();
    const preferences = await this.preferencesService.getPreferences(userId);
    const timeZone = this.normalizeTimeZone(preferences.timeZone);
    const todayDate = this.formatDateInTimeZone(now, timeZone);
    const todayStart = this.getDateStartInTimeZone(todayDate, timeZone);
    const yesterdayStart = this.getDateStartInTimeZone(
      this.addDaysToDateString(todayDate, -1),
      timeZone
    );
    const weekStart = this.getDateStartInTimeZone(
      this.addDaysToDateString(todayDate, -6),
      timeZone
    );
    const prevWeekStart = this.getDateStartInTimeZone(
      this.addDaysToDateString(todayDate, -13),
      timeZone
    );
    const prevWeekEnd = this.getDateStartInTimeZone(
      this.addDaysToDateString(todayDate, -7),
      timeZone
    );
    const monthStartDate = this.addDaysToDateString(todayDate, -29);
    const monthStart = this.getDateStartInTimeZone(monthStartDate, timeZone);
    const prevMonthStart = this.getDateStartInTimeZone(
      this.addDaysToDateString(todayDate, -59),
      timeZone
    );
    const prevMonthEnd = this.getDateStartInTimeZone(
      this.addDaysToDateString(todayDate, -30),
      timeZone
    );
    const yearStartDate = this.addDaysToDateString(todayDate, -364);
    const yearStart = this.getDateStartInTimeZone(yearStartDate, timeZone);
    const prevYearStart = this.getDateStartInTimeZone(
      this.addDaysToDateString(todayDate, -729),
      timeZone
    );
    const prevYearEnd = this.getDateStartInTimeZone(
      this.addDaysToDateString(todayDate, -365),
      timeZone
    );
    const periods: Record<TaskStatisticsPeriodKey, TaskStatisticsPeriodRange> =
      {
        today: { start: todayStart },
        yesterday: { start: yesterdayStart, end: todayStart },
        week: { start: weekStart },
        previousWeek: { start: prevWeekStart, end: prevWeekEnd },
        month: { start: monthStart },
        previousMonth: { start: prevMonthStart, end: prevMonthEnd },
        year: { start: yearStart },
        previousYear: { start: prevYearStart, end: prevYearEnd },
      };

    const [overview, periodCounts, heatmap, firstLog, ranking] =
      await Promise.all([
        this.getTaskOverview(userId, now, timeZone),
        this.getTaskPeriodCounts(userId, filter, periods),
        this.getTaskHeatmap(
          userId,
          filter,
          yearStart,
          yearStartDate,
          todayDate,
          timeZone
        ),
        this.getFirstTaskEvent(userId, filter),
        this.getTaskRanking(userId, filter, rankingPeriod, todayDate, timeZone),
      ]);
    const firstLogTime = firstLog?.occurredAt?.getTime() ?? null;
    const hasCompletePreviousPeriod = {
      today: firstLogTime !== null && firstLogTime <= yesterdayStart.getTime(),
      week: firstLogTime !== null && firstLogTime <= prevWeekStart.getTime(),
      month: firstLogTime !== null && firstLogTime <= prevMonthStart.getTime(),
      year: firstLogTime !== null && firstLogTime <= prevYearStart.getTime(),
    };

    return {
      overview,
      today: this.toTaskPeriod(
        periodCounts.today,
        periodCounts.yesterday,
        hasCompletePreviousPeriod.today
      ),
      week: this.toTaskPeriod(
        periodCounts.week,
        periodCounts.previousWeek,
        hasCompletePreviousPeriod.week
      ),
      month: this.toTaskPeriod(
        periodCounts.month,
        periodCounts.previousMonth,
        hasCompletePreviousPeriod.month
      ),
      year: this.toTaskPeriod(
        periodCounts.year,
        periodCounts.previousYear,
        hasCompletePreviousPeriod.year
      ),
      heatmap,
      heatmapThresholds: this.calculateHeatmapThresholds(heatmap),
      ranking,
      firstLogDate: firstLog
        ? this.formatDateInTimeZone(firstLog.occurredAt, timeZone)
        : null,
    };
  }

  private async getTaskOverview(userId: string, now: Date, timeZone: string) {
    const row = await this.tasksRepository
      .createQueryBuilder('task')
      .select('COUNT(*)', 'active')
      .addSelect(
        'COUNT(*) FILTER (WHERE task."recurrenceRule" IS NOT NULL)',
        'recurring'
      )
      .addSelect('COUNT(*) FILTER (WHERE task."dueDate" IS NULL)', 'undated')
      .addSelect(
        'COUNT(*) FILTER (WHERE task."pinnedAt" IS NOT NULL)',
        'pinned'
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE task."dueDate" IS NOT NULL AND CASE
          WHEN task."dueTime" IS NULL THEN
            ((task."dueDate" + INTERVAL '1 day')::timestamp AT TIME ZONE :timeZone) < :now
          ELSE
            ((task."dueDate"::text || ' ' || task."dueTime")::timestamp AT TIME ZONE :timeZone) < :now
        END)`,
        'overdue'
      )
      .where('task."userId" = :userId', { userId })
      .andWhere('task.status = :status', { status: TASK_STATUSES.ACTIVE })
      .andWhere('task.itemKind IN (:...itemKinds)', {
        itemKinds: ['task', 'followUp'],
      })
      .setParameters({ now, timeZone })
      .getRawOne<Record<string, string>>();

    return {
      active: Number(row?.active ?? 0),
      recurring: Number(row?.recurring ?? 0),
      overdue: Number(row?.overdue ?? 0),
      undated: Number(row?.undated ?? 0),
      pinned: Number(row?.pinned ?? 0),
    };
  }

  async getTaskEventLogs(
    userId: string,
    limit: number,
    offset: number
  ): Promise<TaskEventLog[]> {
    const [events, preferences] = await Promise.all([
      this.taskEventsRepository.find({
        where: {
          userId,
          eventType: In([TASK_STATUSES.COMPLETED, TASK_STATUSES.ARCHIVED]),
        },
        order: { occurredAt: 'DESC' },
        take: limit,
        skip: offset,
      }),
      this.preferencesService.getPreferences(userId),
    ]);
    const timeZone = this.normalizeTimeZone(preferences.timeZone);
    const latestEventIdsByTaskId = await this.getLatestTaskEventIds(
      userId,
      events.map(event => event.taskId)
    );

    return events.map(event => ({
      id: event.id,
      taskId: event.taskId,
      eventType: event.eventType as 'completed' | 'archived',
      title: event.titleSnapshot,
      priority: event.prioritySnapshot,
      timerType: event.timerTypeSnapshot,
      intentionSlug: event.intentionSlugSnapshot,
      subIntentionSlug: event.subIntentionSlugSnapshot,
      dueDate: event.dueDate,
      dueTime: event.dueTime,
      isOverdue: event.isOverdue,
      occurredAt: event.occurredAt.getTime(),
      date: this.formatDateInTimeZone(event.occurredAt, timeZone),
      canRevert: latestEventIdsByTaskId[event.taskId] === event.id,
    }));
  }

  async revertLatestTaskEvent(userId: string, eventId: string) {
    const savedTask = await this.tasksRepository.manager.transaction(
      async manager => {
        const taskRepository = manager.getRepository(TaskEntity);
        const eventRepository = manager.getRepository(TaskEventEntity);
        const event = await eventRepository.findOne({
          where: { id: eventId, userId },
        });
        if (!event) {
          throw new NotFoundException('Task log not found');
        }

        const latestEvent = await eventRepository.findOne({
          where: { userId, taskId: event.taskId },
          order: { occurredAt: 'DESC' },
        });
        if (!latestEvent || latestEvent.id !== event.id) {
          throw new BadRequestException(
            'Only the latest task log can be reverted'
          );
        }

        const task = await taskRepository.findOne({
          where: {
            id: event.taskId,
            userId,
            itemKind: In(['task', 'followUp']),
          },
        });
        if (!task) {
          throw new NotFoundException('Task not found');
        }

        const generatedFollowUp = await taskRepository.findOne({
          where: {
            userId,
            followUpSourceTaskId: task.id,
            status: TASK_STATUSES.ACTIVE,
            itemKind: 'followUp',
          },
        });
        if (generatedFollowUp && generatedFollowUp.id !== task.id) {
          await eventRepository.delete({
            userId,
            taskId: generatedFollowUp.id,
          });
          await taskRepository.delete(generatedFollowUp.id);
        }

        task.status = TASK_STATUSES.ACTIVE;
        task.title = event.titleSnapshot;
        task.priority = event.prioritySnapshot;
        task.timerType = event.timerTypeSnapshot;
        task.intentionSlug = event.intentionSlugSnapshot;
        task.subIntentionSlug = event.subIntentionSlugSnapshot;
        task.dueDate = event.dueDate;
        task.dueTime = event.dueTime;
        task.recurrenceSequenceIndex = event.recurrenceSequenceIndex;
        task.recurrenceRule = event.recurrenceRuleSnapshot;
        task.recurrenceInterval = event.recurrenceIntervalSnapshot;
        task.recurrenceAnchorMode = event.recurrenceAnchorModeSnapshot;
        task.manualOrder = null;
        task.manualOrderOverride = false;
        await this.seedPastDueReminderKeyIfNeeded(userId, task);

        const saved = await taskRepository.save(task);
        await eventRepository.delete(event.id);
        return saved;
      }
    );
    await this.attachFollowUpParents(userId, [savedTask], this.tasksRepository);
    this.realtimeEvents.emitTasksUpdate(userId);
    return savedTask;
  }

  private async getLatestTaskEventIds(userId: string, taskIds: string[]) {
    const uniqueTaskIds = [...new Set(taskIds)];
    if (uniqueTaskIds.length === 0) {
      return {};
    }

    const events = await this.taskEventsRepository
      .createQueryBuilder('event')
      .distinctOn(['event.taskId'])
      .where('event.userId = :userId', { userId })
      .andWhere('event.taskId IN (:...taskIds)', { taskIds: uniqueTaskIds })
      .orderBy('event.taskId', 'ASC')
      .addOrderBy('event.occurredAt', 'DESC')
      .addOrderBy('event.createdAt', 'DESC')
      .addOrderBy('event.id', 'DESC')
      .getMany();
    const latestByTaskId: Record<string, string> = {};
    for (const event of events) {
      latestByTaskId[event.taskId] ??= event.id;
    }
    return latestByTaskId;
  }

  private createFilteredTaskEventQuery(
    userId: string,
    filter: TaskStatisticsFilter
  ) {
    const query = this.taskEventsRepository
      .createQueryBuilder('event')
      .where('event.userId = :userId', { userId });

    switch (filter) {
      case 'created':
        query.andWhere('event.eventType = :eventType', {
          eventType: 'created',
        });
        break;
      case 'completed':
        query.andWhere('event.eventType = :eventType', {
          eventType: TASK_STATUSES.COMPLETED,
        });
        break;
      case 'archived':
        query.andWhere('event.eventType = :eventType', {
          eventType: TASK_STATUSES.ARCHIVED,
        });
        break;
      case 'overdue':
        query
          .andWhere('event.eventType = :eventType', {
            eventType: TASK_STATUSES.COMPLETED,
          })
          .andWhere('event."isOverdue" = true');
        break;
      case 'onTime':
        query
          .andWhere('event.eventType = :eventType', {
            eventType: TASK_STATUSES.COMPLETED,
          })
          .andWhere('event."dueDate" IS NOT NULL')
          .andWhere('event."isOverdue" = false');
        break;
    }

    return query;
  }

  private applyTaskEventRange(
    query: SelectQueryBuilder<TaskEventEntity>,
    start?: Date,
    end?: Date
  ) {
    if (start) {
      query.andWhere('event."occurredAt" >= :start', { start });
    }
    if (end) {
      query.andWhere('event."occurredAt" < :end', { end });
    }
  }

  private async getTaskPeriodCounts(
    userId: string,
    filter: TaskStatisticsFilter,
    periods: Record<TaskStatisticsPeriodKey, TaskStatisticsPeriodRange>
  ): Promise<TaskStatisticsPeriodCounts> {
    const periodEntries = Object.entries(periods) as Array<
      [TaskStatisticsPeriodKey, TaskStatisticsPeriodRange]
    >;
    const earliestStart = new Date(
      Math.min(...periodEntries.map(([, period]) => period.start.getTime()))
    );
    const firstPeriod = periodEntries[0]!;
    const firstCondition = this.getTaskPeriodCondition(
      firstPeriod[0],
      firstPeriod[1]
    );
    const query = this.createFilteredTaskEventQuery(userId, filter)
      .select(
        `COUNT(*) FILTER (WHERE ${firstCondition})`,
        `${firstPeriod[0]}Count`
      )
      .andWhere('event."occurredAt" >= :periodStart', {
        periodStart: earliestStart,
      })
      .setParameter(`${firstPeriod[0]}Start`, firstPeriod[1].start);

    if (firstPeriod[1].end) {
      query.setParameter(`${firstPeriod[0]}End`, firstPeriod[1].end);
    }

    periodEntries.slice(1).forEach(([period, range]) => {
      query
        .addSelect(
          `COUNT(*) FILTER (WHERE ${this.getTaskPeriodCondition(period, range)})`,
          `${period}Count`
        )
        .setParameter(`${period}Start`, range.start);
      if (range.end) {
        query.setParameter(`${period}End`, range.end);
      }
    });

    const raw = await query.getRawOne<Record<string, string>>();
    return Object.fromEntries(
      periodEntries.map(([period]) => [
        period,
        Number(raw?.[`${period}Count`] ?? 0),
      ])
    ) as TaskStatisticsPeriodCounts;
  }

  private getTaskPeriodCondition(
    period: TaskStatisticsPeriodKey,
    range: TaskStatisticsPeriodRange
  ) {
    return range.end
      ? `event."occurredAt" >= :${period}Start AND event."occurredAt" < :${period}End`
      : `event."occurredAt" >= :${period}Start`;
  }

  private async getFirstTaskEvent(
    userId: string,
    filter: TaskStatisticsFilter
  ) {
    return this.createFilteredTaskEventQuery(userId, filter)
      .orderBy('event."occurredAt"', 'ASC')
      .getOne();
  }

  private getRankingStart(
    period: TopIntentionsPeriod,
    todayDate: string,
    timeZone: string
  ) {
    if (period === 'today') {
      return this.getDateStartInTimeZone(todayDate, timeZone);
    }
    if (period === 'month') {
      return this.getDateStartInTimeZone(
        this.addDaysToDateString(todayDate, -29),
        timeZone
      );
    }
    if (period === 'year') {
      return this.getDateStartInTimeZone(
        this.addDaysToDateString(todayDate, -364),
        timeZone
      );
    }
    return this.getDateStartInTimeZone(
      this.addDaysToDateString(todayDate, -6),
      timeZone
    );
  }

  private async getTaskRanking(
    userId: string,
    filter: TaskStatisticsFilter,
    period: TopIntentionsPeriod,
    todayDate: string,
    timeZone: string
  ) {
    const rankingKeyExpression = `CASE WHEN event."intentionSlugSnapshot" IS NULL THEN :noIntention ELSE CONCAT(event."timerTypeSnapshot", ':', event."intentionSlugSnapshot") END`;
    const rankingTypeExpression =
      'CASE WHEN event."intentionSlugSnapshot" IS NULL THEN NULL ELSE event."timerTypeSnapshot" END';
    const query = this.createFilteredTaskEventQuery(userId, filter)
      .select(rankingKeyExpression, 'slug')
      .addSelect(rankingTypeExpression, 'timerType')
      .addSelect('event."intentionSlugSnapshot"', 'intentionSlug')
      .addSelect('COUNT(*)', 'count')
      .setParameter('noIntention', NO_INTENTION_TASK_RANKING_KEY)
      .groupBy(rankingKeyExpression)
      .addGroupBy(rankingTypeExpression)
      .addGroupBy('event."intentionSlugSnapshot"')
      .orderBy('COUNT(*)', 'DESC')
      .addOrderBy(rankingKeyExpression, 'ASC')
      .limit(10);
    this.applyTaskEventRange(
      query,
      this.getRankingStart(period, todayDate, timeZone)
    );
    const rows = await query.getRawMany<TaskRankingRow>();
    const labels = await this.getTaskRankingLabels(userId, rows);

    return rows.map(row => ({
      slug: row.slug,
      label:
        row.intentionSlug === null
          ? 'No Intention'
          : (labels[row.slug] ?? row.slug),
      count: Number(row.count),
      duration: 0,
    }));
  }

  private async getTaskRankingLabels(userId: string, rows: TaskRankingRow[]) {
    const wantedByType = new Map<TimerTypes, Set<string>>();
    for (const row of rows) {
      if (!row.timerType || !row.intentionSlug) continue;
      const wanted = wantedByType.get(row.timerType) ?? new Set<string>();
      wanted.add(row.intentionSlug);
      wantedByType.set(row.timerType, wanted);
    }
    if (wantedByType.size === 0) {
      return {};
    }

    return this.intentionsService.getIntentionLabelsByTypeAndSlug(
      userId,
      TIMER_TYPE_VALUES.filter(type => wantedByType.has(type)).map(type => ({
        type,
        slugs: Array.from(wantedByType.get(type) ?? []),
      }))
    );
  }

  private async getTaskHeatmap(
    userId: string,
    filter: TaskStatisticsFilter,
    start: Date,
    startDate: string,
    endDate: string,
    timeZone: string
  ) {
    const dateExpression = `TO_CHAR(event."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE :timeZone, 'YYYY-MM-DD')`;
    const rows = await this.createFilteredTaskEventQuery(userId, filter)
      .select(dateExpression, 'date')
      .addSelect('COUNT(*)', 'count')
      .andWhere('event."occurredAt" >= :start', { start })
      .setParameter('timeZone', timeZone)
      .groupBy(dateExpression)
      .getRawMany<{ date: string; count: string }>();
    const countByDate = new Map(rows.map(row => [row.date, Number(row.count)]));
    const days = this.getDateRangeLength(startDate, endDate);

    return Array.from({ length: days }, (_, index) => {
      const key = this.addDaysToDateString(startDate, index);
      return {
        date: key,
        count: countByDate.get(key) ?? 0,
        duration: 0,
      };
    });
  }

  private toTaskPeriod(
    currentCount: number,
    previousCount: number,
    hasCompletePreviousPeriod: boolean
  ) {
    return {
      count: currentCount,
      duration: 0,
      change: this.calculatePercentageChangeOrNull(
        currentCount,
        previousCount,
        hasCompletePreviousPeriod
      ),
      durationChange: null,
    };
  }

  private calculatePercentageChangeOrNull(
    current: number,
    previous: number,
    hasCompletePreviousPeriod: boolean
  ) {
    if (!hasCompletePreviousPeriod) {
      return null;
    }
    if (previous === 0) {
      return current === 0 ? 0 : 100;
    }
    return Math.round(((current - previous) / previous) * 100);
  }

  private calculateHeatmapThresholds(
    heatmap: { date: string; count: number }[]
  ) {
    const counts = heatmap
      .map(day => day.count)
      .filter(count => count > 0)
      .sort((a, b) => a - b);
    if (counts.length === 0) {
      return { low: 1, medium: 2, high: 4, max: 6 };
    }

    return {
      low: counts[0],
      medium: counts[Math.floor(counts.length * 0.25)] ?? counts[0],
      high: counts[Math.floor(counts.length * 0.5)] ?? counts[0],
      max: counts[Math.floor(counts.length * 0.75)] ?? counts[0],
    };
  }

  async validateTaskCreation(input: CreateTaskInput) {
    return this.prepareTaskCreation(input);
  }

  async createTask(input: CreateTaskInput) {
    const prepared = await this.prepareTaskCreation(input);
    const savedTask = await this.persistPreparedTask(
      prepared,
      this.tasksRepository,
      this.taskEventsRepository
    );
    this.realtimeEvents.emitTasksUpdate(input.userId);
    return savedTask;
  }

  async createPreparedTasks(preparedTasks: PreparedTaskCreation[]) {
    if (preparedTasks.length === 0) return [];
    const userId = preparedTasks[0].task.userId;
    if (preparedTasks.some(prepared => prepared.task.userId !== userId)) {
      throw new BadRequestException('Prepared Task batch must have one owner');
    }
    const tasks = await this.tasksRepository.manager.transaction(
      async manager => {
        const taskRepository = manager.getRepository(TaskEntity);
        const eventRepository = manager.getRepository(TaskEventEntity);
        const saved: TaskEntity[] = [];
        for (const prepared of preparedTasks) {
          saved.push(
            await this.persistPreparedTask(
              prepared,
              taskRepository,
              eventRepository
            )
          );
        }
        return saved;
      }
    );
    if (tasks.length > 0) {
      this.realtimeEvents.emitTasksUpdate(userId);
    }
    return tasks;
  }

  private async persistPreparedTask(
    { task, preferences }: PreparedTaskCreation,
    taskRepository: Pick<Repository<TaskEntity>, 'save' | 'update'>,
    eventRepository: Pick<Repository<TaskEventEntity>, 'save'>
  ) {
    const savedTask = await taskRepository.save(task);
    await this.recordCreatedTaskEvent(savedTask, eventRepository);
    if (this.shouldSeedPastDueReminderKey(savedTask, preferences)) {
      savedTask.lastReminderKey = this.getDueReminderKey(savedTask);
      await taskRepository.update(savedTask.id, {
        lastReminderKey: savedTask.lastReminderKey,
      });
    }

    return savedTask;
  }

  private async recordCreatedTaskEvent(
    task: TaskEntity,
    eventRepository: Pick<Repository<TaskEventEntity>, 'save'>
  ) {
    const event = {
      userId: task.userId,
      taskId: task.id,
      eventType: 'created',
      titleSnapshot: task.title,
      prioritySnapshot: task.priority,
      timerTypeSnapshot: task.timerType,
      intentionSlugSnapshot: task.intentionSlug,
      subIntentionSlugSnapshot: task.subIntentionSlug,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      recurrenceSequenceIndex: task.recurrenceSequenceIndex,
      recurrenceRuleSnapshot: task.recurrenceRule,
      recurrenceIntervalSnapshot: task.recurrenceInterval,
      recurrenceAnchorModeSnapshot: task.recurrenceAnchorMode,
      isOverdue: false,
      occurredAt: task.createdAt,
    } as TaskEventEntity;
    await eventRepository.save(event);
  }

  private async prepareTaskCreation(
    input: CreateTaskInput
  ): Promise<PreparedTaskCreation> {
    const {
      userId,
      title,
      description,
      sourceTranscript,
      dueDate,
      dueTime,
      priority,
      timerType,
      pinned,
      intentionSlug,
      subIntentionSlug,
      recurrenceRule,
      recurrenceInterval,
      recurrenceAnchorMode,
      followUpTaskId,
      followUpDefinition,
      followUpDelayDays,
      vacationEligible,
      importSource,
      importSourceTaskId,
      creationSource,
    } = input;
    const resolvedTitle = this.requireTitle(title);
    const resolvedPriority = priority ?? TASK_PRIORITIES.NORMAL;
    const resolvedTimerType = timerType ?? TIMER_TYPES.WORK;
    const preferences = await this.preferencesService.getPreferences(userId);
    const link = await this.resolveTaskLink(
      userId,
      resolvedTimerType,
      intentionSlug ?? null,
      subIntentionSlug ?? null
    );
    const linkedIntentions = link.intentionSlug
      ? await this.intentionsService.getIntentionsBySlug(
          userId,
          [link.intentionSlug],
          resolvedTimerType
        )
      : {};
    const normalizedRecurrenceRule = this.normalizeOptionalSlug(recurrenceRule);
    const resolvedDueDate = dueDate ?? null;
    this.validateDueDate(resolvedDueDate);
    this.validateRecurrenceAnchor(normalizedRecurrenceRule, resolvedDueDate);
    const parsedRecurrence = this.parseRecurrenceRule(normalizedRecurrenceRule);
    this.validateFractionalRecurrence(parsedRecurrence, recurrenceInterval);
    const followUp = await this.validateFollowUpConfiguration(
      userId,
      followUpTaskId,
      followUpDefinition,
      followUpDelayDays
    );

    const resolvedDueTime = this.resolveDueTime(dueTime);
    const task = this.tasksRepository.create({
      userId,
      title: resolvedTitle,
      description: this.normalizeOptionalText(description),
      sourceTranscript: this.normalizeOptionalText(sourceTranscript),
      creationSource,
      dueDate: resolvedDueDate,
      dueTime: resolvedDueTime,
      manualOrder: null,
      manualOrderOverride: false,
      priority: resolvedPriority,
      status: TASK_STATUSES.ACTIVE,
      timerType: resolvedTimerType,
      pinnedAt: pinned ? new Date() : null,
      intentionSlug: link.intentionSlug,
      subIntentionSlug: link.subIntentionSlug,
      recurrenceRule: normalizedRecurrenceRule,
      recurrenceInterval: recurrenceInterval ?? null,
      recurrenceSequenceIndex: 0,
      recurrenceAnchorMode: recurrenceAnchorMode ?? 'planned',
      followUpTaskId: null,
      followUpDefinition: followUp.definition,
      followUpDelayDays: followUp.delayDays,
      followUpSourceTaskId: null,
      vacationEligible:
        vacationEligible ??
        linkedIntentions[link.intentionSlug ?? '']?.vacationDefault === true,
      importSource,
      importSourceTaskId:
        importSourceTaskId === undefined ? null : importSourceTaskId,
    });

    return { task, preferences };
  }

  async importTasks(
    userId: string,
    source: TaskImportSource,
    rows: unknown[]
  ): Promise<{ imported: TaskEntity[]; skipped: TaskImportSkippedTask[] }> {
    const result: { imported: TaskEntity[]; skipped: TaskImportSkippedTask[] } =
      { imported: [], skipped: [] };
    if (!Array.isArray(rows)) {
      return result;
    }

    const preparedRows: ImportTaskRow[] = [];
    const seenSourceIds = new Set<string>();
    const inFileDuplicates = new Map<string, string>();

    for (const row of rows) {
      if (!this.shouldImportRow(row)) {
        continue;
      }

      try {
        const normalized = this.normalizeImportTaskRow(
          row as Record<string, unknown>
        );
        if (seenSourceIds.has(normalized.sourceId)) {
          inFileDuplicates.set(normalized.sourceId, normalized.title);
          continue;
        }

        seenSourceIds.add(normalized.sourceId);
        preparedRows.push(normalized);
      } catch (error) {
        const skipped = this.normalizeSkippedError(row, error);
        result.skipped.push(skipped);
      }
    }

    for (const [sourceId, title] of inFileDuplicates) {
      result.skipped.push({
        sourceId,
        title,
        reason: 'duplicate',
        message: 'Duplicate task in import payload.',
      });
    }

    if (preparedRows.length === 0) {
      return result;
    }

    const existingSourceIds = await this.getImportedSourceIds(
      userId,
      source,
      preparedRows.map(row => row.sourceId)
    );
    const newIntentionLinks = await this.resolveImportNewIntentionLinks(
      userId,
      preparedRows.filter(row => !existingSourceIds.has(row.sourceId))
    );

    for (const row of preparedRows) {
      if (existingSourceIds.has(row.sourceId)) {
        result.skipped.push({
          sourceId: row.sourceId,
          title: row.title,
          reason: 'duplicate',
          message: 'Task was already imported.',
        });
        continue;
      }

      try {
        const newIntentionLink = newIntentionLinks.get(row.sourceId);
        const task = await this.createTask({
          userId,
          title: row.title,
          description: row.description,
          dueDate: row.dueDate,
          dueTime: row.dueTime,
          priority: row.priority,
          timerType: row.timerType,
          intentionSlug: row.intentionSlug ?? newIntentionLink?.intentionSlug,
          subIntentionSlug:
            row.subIntentionSlug ?? newIntentionLink?.subIntentionSlug,
          recurrenceRule: row.recurrenceRule,
          recurrenceInterval: row.recurrenceInterval,
          recurrenceAnchorMode: row.recurrenceAnchorMode,
          importSource: source,
          importSourceTaskId: row.sourceId,
          creationSource: TASK_CREATION_SOURCES.MANUAL,
        });
        result.imported.push(task);
      } catch (error) {
        if (this.isImportDuplicateError(error)) {
          result.skipped.push({
            sourceId: row.sourceId,
            title: row.title,
            reason: 'duplicate',
            message: 'Task was already imported.',
          });
          continue;
        }

        result.skipped.push({
          sourceId: row.sourceId,
          title: row.title,
          reason: 'invalid',
          message: this.normalizeImportErrorMessage(error),
        });
      }
    }

    if (result.imported.length > 0) {
      await this.taskImportRunsRepository.save(
        this.taskImportRunsRepository.create({
          userId,
          source,
          importedCount: result.imported.length,
          skippedCount: result.skipped.length,
        })
      );
    }

    return result;
  }

  private shouldImportRow(row: unknown) {
    return (
      typeof row === 'object' &&
      row !== null &&
      (row as { include?: unknown }).include === true
    );
  }

  private normalizeImportTaskRow(row: Record<string, unknown>): ImportTaskRow {
    const sourceId = this.normalizeImportTaskString(row.sourceId);
    const title = this.normalizeImportTaskString(row.title);
    if (!sourceId || !title) {
      throw new BadRequestException('Task source id and title are required');
    }

    const dueDate = this.normalizeImportDate(row.dueDate);
    const recurrenceRule = this.normalizeImportRecurrenceRule(
      row.recurrenceRule,
      dueDate
    );
    const recurrenceInterval = this.normalizeImportRecurrenceInterval(
      row.recurrenceInterval
    );

    return {
      sourceId,
      title,
      dueDate,
      dueTime: this.normalizeImportTime(row.dueTime),
      description: this.normalizeOptionalText(
        this.normalizeImportTaskStringOrNull(row.description)
      ),
      priority: this.normalizeImportPriority(row.priority),
      timerType: this.normalizeImportTimerType(row.timerType),
      recurrenceRule,
      recurrenceInterval,
      recurrenceAnchorMode: dueDate
        ? this.normalizeImportRecurrenceAnchorMode(row.recurrenceAnchorMode)
        : undefined,
      intentionSlug: this.normalizeImportTaskStringOrNull(row.intentionSlug),
      subIntentionSlug: this.normalizeImportTaskStringOrNull(
        row.subIntentionSlug
      ),
      newIntentionTitle: this.normalizeImportTaskStringOrNull(
        row.newIntentionTitle
      ),
      newIntentionEmoji: this.normalizeImportTaskStringOrNull(
        row.newIntentionEmoji
      ),
      newSubIntentionTitle: this.normalizeImportTaskStringOrNull(
        row.newSubIntentionTitle
      ),
    };
  }

  private async resolveImportNewIntentionLinks(
    userId: string,
    rows: ImportTaskRow[]
  ) {
    const links = new Map<
      string,
      { intentionSlug: string | null; subIntentionSlug: string | null }
    >();
    const rowsWithNewIntentions = rows.filter(
      row => !row.intentionSlug && row.newIntentionTitle
    );
    if (rowsWithNewIntentions.length === 0) {
      return links;
    }

    const intentionsByType = new Map<
      TimerTypes,
      Awaited<ReturnType<IntentionsService['getAllIntentions']>>
    >();

    for (const row of rowsWithNewIntentions) {
      let intentions = intentionsByType.get(row.timerType);
      if (!intentions) {
        intentions = await this.intentionsService.getAllIntentions(
          userId,
          row.timerType,
          undefined,
          { includeSubIntentions: true }
        );
        intentionsByType.set(row.timerType, intentions);
      }
      const activeIntentions = intentions.filter(
        intention => !intention.isArchived
      );
      const topByKey = new Map(
        activeIntentions
          .filter(intention => !intention.parentIntentionId)
          .map(intention => [
            this.getImportNewIntentionKey(intention.title),
            intention,
          ])
      );
      const subByKey = new Map<string, (typeof activeIntentions)[number]>();
      for (const intention of activeIntentions) {
        if (intention.parentIntentionId) {
          subByKey.set(
            this.getImportNewSubIntentionKey(
              intention.parentIntentionId,
              intention.title
            ),
            intention
          );
        }
      }
      const title = row.newIntentionTitle;
      if (!title) {
        continue;
      }

      const intentionKey = this.getImportNewIntentionKey(title);
      let parent = topByKey.get(intentionKey);
      if (!parent) {
        parent = await this.intentionsService.createIntention(
          userId,
          title,
          row.newIntentionEmoji || this.getDefaultImportIntentionEmoji(title),
          row.timerType,
          false
        );
        intentions.push(parent);
        topByKey.set(intentionKey, parent);
      }

      if (!row.newSubIntentionTitle) {
        links.set(row.sourceId, {
          intentionSlug: parent.slug,
          subIntentionSlug: null,
        });
        continue;
      }

      const subKey = this.getImportNewSubIntentionKey(
        parent.id,
        row.newSubIntentionTitle
      );
      let subIntention = subByKey.get(subKey);
      if (!subIntention) {
        subIntention = await this.intentionsService.createIntention(
          userId,
          row.newSubIntentionTitle,
          row.newIntentionEmoji ||
            this.getDefaultImportIntentionEmoji(row.newSubIntentionTitle),
          row.timerType,
          false,
          undefined,
          undefined,
          undefined,
          parent.id
        );
        intentions.push(subIntention);
        subByKey.set(subKey, subIntention);
      }

      links.set(row.sourceId, {
        intentionSlug: parent.slug,
        subIntentionSlug: subIntention.slug,
      });
    }

    return links;
  }

  private getImportNewIntentionKey(title: string) {
    return this.normalizeImportGroupTitle(title);
  }

  private getImportNewSubIntentionKey(parentId: string, title: string) {
    return `${parentId}:${this.normalizeImportGroupTitle(title)}`;
  }

  private normalizeImportGroupTitle(title: string) {
    return title.trim().toLowerCase();
  }

  private getDefaultImportIntentionEmoji(title: string) {
    const normalizedTitle = title.toLowerCase();
    if (/(health|doctor|clinic|medical|sport|fitness)/.test(normalizedTitle)) {
      return '🏥';
    }
    if (/(home|house|clean|chores|groceries)/.test(normalizedTitle)) {
      return '🏠';
    }
    if (/(money|finance|bank|rent|tax|crypto)/.test(normalizedTitle)) {
      return '💰';
    }
    if (/(computer|code|pomi|work|project)/.test(normalizedTitle)) {
      return '💻';
    }
    return '✨';
  }

  private getImportedSourceIds(
    userId: string,
    source: TaskImportSource,
    sourceIds: string[]
  ) {
    const uniqueSourceIds = [...new Set(sourceIds)];
    if (uniqueSourceIds.length === 0) {
      return Promise.resolve(new Set<string>());
    }

    return this.tasksRepository
      .find({
        where: {
          userId,
          importSource: source,
          importSourceTaskId: In(uniqueSourceIds),
          itemKind: 'task',
        },
        select: { importSourceTaskId: true },
      })
      .then(
        records =>
          new Set(
            records
              .map(task => task.importSourceTaskId)
              .filter((id): id is string => Boolean(id))
          )
      );
  }

  private normalizeImportTaskString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  private normalizeImportTaskStringOrNull(value: unknown) {
    return this.normalizeImportTaskString(value) || null;
  }

  private normalizeImportDate(value: unknown) {
    if (value === undefined || value === null) {
      return null;
    }

    const rawValue = this.normalizeImportTaskString(value);
    if (!rawValue) {
      return null;
    }

    return rawValue;
  }

  private normalizeImportTime(value: unknown) {
    if (value === undefined || value === null) {
      return null;
    }

    const rawValue = this.normalizeImportTaskString(value);
    if (!rawValue) {
      return null;
    }

    return rawValue;
  }

  private normalizeImportPriority(value: unknown) {
    const textValue = this.normalizeImportTaskString(value);
    if (!textValue) {
      return undefined;
    }

    if (
      ![
        TASK_PRIORITIES.LOW,
        TASK_PRIORITIES.NORMAL,
        TASK_PRIORITIES.HIGH,
        TASK_PRIORITIES.URGENT,
      ].includes(textValue as TaskPriority)
    ) {
      throw new BadRequestException('Task priority is invalid');
    }

    return textValue as TaskPriority;
  }

  private normalizeImportTimerType(value: unknown): TimerTypes {
    const textValue = this.normalizeImportTaskString(value);
    if (!textValue) {
      return TIMER_TYPES.WORK;
    }
    if (
      ![TIMER_TYPES.WORK, TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK].includes(
        textValue as TimerTypes
      )
    ) {
      throw new BadRequestException('Task Timer type is invalid');
    }

    return textValue as TimerTypes;
  }

  private normalizeImportRecurrenceAnchorMode(
    value: unknown
  ): TaskRecurrenceAnchorMode | undefined {
    const textValue = this.normalizeImportTaskString(value);
    if (!textValue) {
      return undefined;
    }

    if (!['planned', 'completion'].includes(textValue)) {
      throw new BadRequestException('Task recurrence anchor is invalid');
    }

    return textValue as TaskRecurrenceAnchorMode;
  }

  private normalizeImportBoolean(value: unknown) {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'boolean') {
      return undefined;
    }

    return value;
  }

  private normalizeImportNumber(value: unknown) {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return undefined;
    }

    return value;
  }

  private normalizeImportRecurrenceRule(
    value: unknown,
    dueDate: string | null
  ) {
    const recurrenceRule = this.normalizeImportTaskStringOrNull(value);
    if (!recurrenceRule || !dueDate) {
      return null;
    }

    try {
      this.parseRecurrenceRule(recurrenceRule);
      return this.normalizeOptionalSlug(recurrenceRule);
    } catch {
      return null;
    }
  }

  private normalizeImportRecurrenceInterval(value: unknown) {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
      return null;
    }
    return value;
  }

  private normalizeSkippedError(
    row: unknown,
    error: unknown
  ): TaskImportSkippedTask {
    const rawRow = typeof row === 'object' && row !== null ? row : {};
    return {
      sourceId:
        this.normalizeImportTaskString(
          (rawRow as { sourceId?: unknown }).sourceId
        ) || 'Unknown',
      title:
        this.normalizeImportTaskString((rawRow as { title?: unknown }).title) ||
        'Unknown',
      reason: 'invalid',
      message: this.normalizeImportErrorMessage(error),
    };
  }

  private isImportDuplicateError(error: unknown) {
    return (
      error instanceof QueryFailedError &&
      ((error as { code?: string }).code === '23505' ||
        (error as { errno?: string }).errno === '23505')
    );
  }

  private normalizeImportErrorMessage(error: unknown) {
    if (error instanceof BadRequestException) {
      const raw = error.getResponse();
      if (typeof raw === 'string') {
        return raw;
      }
      if (typeof raw === 'object' && raw !== null && 'message' in raw) {
        return String(raw.message);
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Task is invalid';
  }

  async reorderTasks(
    userId: string,
    updates: Array<{
      id: string;
      manualOrder: number;
      manualOrderOverride?: boolean;
    }>
  ) {
    const ids = updates.map(update => update.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Task reorder contains duplicate tasks');
    }

    const bottomAnchors = updates.filter(
      update => update.manualOrder === TASK_MANUAL_ORDER_BOTTOM
    );
    if (bottomAnchors.length > 1) {
      throw new BadRequestException(
        'Task reorder can contain only one bottom manual order anchor'
      );
    }
    const orderedManualOrders = updates
      .map(update => update.manualOrder)
      .filter(order => order !== TASK_MANUAL_ORDER_BOTTOM)
      .sort((a, b) => a - b);
    if (orderedManualOrders.some((order, index) => order !== index)) {
      throw new BadRequestException(
        'Task reorder must use contiguous manual order values'
      );
    }

    const reordered = await this.tasksRepository.manager.transaction(
      async manager => {
        const tasksRepository = manager.getRepository(TaskEntity);
        const firstTask = await tasksRepository.findOne({
          where: {
            id: ids[0],
            userId,
            status: TASK_STATUSES.ACTIVE,
            pinnedAt: IsNull(),
            itemKind: 'task',
          },
        });
        if (!firstTask?.intentionSlug) {
          throw new BadRequestException(
            'Only tasks in an Intention family can be manually ordered'
          );
        }

        const activeUnpinnedTasks = await tasksRepository.find({
          where: {
            userId,
            status: TASK_STATUSES.ACTIVE,
            pinnedAt: IsNull(),
            timerType: firstTask.timerType,
            intentionSlug: firstTask.intentionSlug,
            itemKind: 'task',
          },
          order: {
            manualOrder: 'ASC',
            createdAt: 'ASC',
            id: 'ASC',
          },
        });

        if (activeUnpinnedTasks.length !== updates.length) {
          throw new BadRequestException(
            'Task reorder must include every active unpinned Task in the Intention family'
          );
        }

        const tasksById = new Map(
          activeUnpinnedTasks.map(task => [task.id, task])
        );
        if (updates.some(update => !tasksById.has(update.id))) {
          throw new BadRequestException(
            'Only active unpinned tasks can be manually ordered'
          );
        }

        for (const update of updates) {
          const task = tasksById.get(update.id)!;
          task.manualOrder = update.manualOrder;
          task.manualOrderOverride = update.manualOrderOverride ?? true;
        }

        await tasksRepository.save(activeUnpinnedTasks);

        return [...activeUnpinnedTasks].sort(
          (a, b) => (a.manualOrder ?? 0) - (b.manualOrder ?? 0)
        );
      }
    );
    this.realtimeEvents.emitTasksUpdate(userId);
    return reordered;
  }

  async updateTask(
    userId: string,
    id: string,
    updates: {
      title?: string;
      description?: string | null;
      dueDate?: string | null;
      dueTime?: string | null;
      manualOrder?: number | null;
      manualOrderOverride?: boolean;
      priority?: TaskPriority;
      timerType?: TimerTypes;
      pinned?: boolean;
      status?: TaskStatus;
      intentionSlug?: string | null;
      subIntentionSlug?: string | null;
      recurrenceRule?: string | null;
      recurrenceInterval?: number | null;
      recurrenceAnchorMode?: TaskRecurrenceAnchorMode;
      expectedDueDate?: string | null;
      expectedDueTime?: string | null;
      followUpTaskId?: string | null;
      followUpDefinition?: TaskFollowUpDefinition | null;
      followUpDelayDays?: number | null;
      vacationEligible?: boolean;
    }
  ) {
    if (updates.status === TASK_STATUSES.COMPLETED) {
      const hasOtherUpdates = Object.keys(updates).some(
        key =>
          key !== 'status' &&
          key !== 'expectedDueDate' &&
          key !== 'expectedDueTime'
      );
      if (hasOtherUpdates) {
        throw new BadRequestException(
          'Task completion cannot include other updates'
        );
      }
      return this.completeTask(
        userId,
        id,
        updates.expectedDueDate,
        updates.expectedDueTime
      );
    }

    const task = await this.tasksRepository.findOne({
      where: { id, userId, itemKind: In(['task', 'followUp']) },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (
      task.followUpSourceTaskId &&
      (updates.pinned === true ||
        (updates.manualOrder !== undefined && updates.manualOrder !== null) ||
        updates.manualOrderOverride === true ||
        (updates.recurrenceRule !== undefined &&
          updates.recurrenceRule !== null) ||
        (updates.recurrenceInterval !== undefined &&
          updates.recurrenceInterval !== null))
    ) {
      throw new BadRequestException(
        'Contextual follow-up Tasks cannot be pinned, reordered, or recurring'
      );
    }

    const previousStatus = task.status;
    const previousDueDate = task.dueDate;
    const previousRecurrenceRule = task.recurrenceRule;
    const previousTimerType = task.timerType;
    const previousIntentionSlug = task.intentionSlug;
    const previousSubIntentionSlug = task.subIntentionSlug;

    if (updates.title !== undefined) {
      task.title = this.requireTitle(updates.title);
    }
    if (updates.description !== undefined) {
      task.description = this.normalizeOptionalText(updates.description);
    }
    if (updates.dueDate !== undefined) {
      this.validateDueDate(updates.dueDate);
      task.dueDate = updates.dueDate;
    }
    if (updates.dueTime !== undefined) {
      task.dueTime = this.normalizeOptionalSlug(updates.dueTime);
    }
    if (updates.manualOrder !== undefined) {
      const nextManualOrderStatus = updates.status ?? task.status;
      if (
        nextManualOrderStatus !== TASK_STATUSES.ACTIVE &&
        updates.manualOrder !== null
      ) {
        throw new BadRequestException(
          'Only active tasks can be manually ordered'
        );
      }
      task.manualOrder =
        nextManualOrderStatus !== TASK_STATUSES.ACTIVE
          ? null
          : updates.manualOrder;
    }
    if (updates.manualOrderOverride !== undefined) {
      task.manualOrderOverride = updates.manualOrderOverride;
      if (!updates.manualOrderOverride) {
        task.manualOrder = null;
      }
    }
    if (updates.priority !== undefined) {
      task.priority = updates.priority;
    }
    if (updates.timerType !== undefined) {
      task.timerType = updates.timerType;
    }
    if (updates.pinned !== undefined) {
      task.pinnedAt = updates.pinned ? task.pinnedAt || new Date() : null;
    }
    if (updates.vacationEligible !== undefined) {
      task.vacationEligible = updates.vacationEligible;
    }
    let recurrenceChanged = false;
    if (updates.recurrenceRule !== undefined) {
      const recurrenceRule = this.normalizeOptionalSlug(updates.recurrenceRule);
      recurrenceChanged = recurrenceRule !== task.recurrenceRule;
      task.recurrenceRule = recurrenceRule;
      if (recurrenceRule === null && updates.recurrenceInterval === undefined) {
        task.recurrenceInterval = null;
      }
    }
    if (updates.recurrenceInterval !== undefined) {
      recurrenceChanged =
        recurrenceChanged ||
        updates.recurrenceInterval !== task.recurrenceInterval;
      task.recurrenceInterval = updates.recurrenceInterval;
    }
    if (recurrenceChanged) {
      task.recurrenceSequenceIndex = 0;
    }
    if (updates.recurrenceAnchorMode !== undefined) {
      task.recurrenceAnchorMode = updates.recurrenceAnchorMode;
    }
    if (
      updates.followUpTaskId !== undefined ||
      updates.followUpDefinition !== undefined ||
      updates.followUpDelayDays !== undefined
    ) {
      if (
        task.followUpSourceTaskId &&
        (updates.followUpTaskId || updates.followUpDefinition)
      ) {
        throw new BadRequestException(
          'Generated follow-up Tasks cannot trigger another follow-up'
        );
      }
      const followUp = await this.validateFollowUpConfiguration(
        userId,
        updates.followUpTaskId !== undefined
          ? updates.followUpTaskId
          : task.followUpTaskId,
        updates.followUpDefinition !== undefined
          ? updates.followUpDefinition
          : task.followUpDefinition,
        updates.followUpDelayDays !== undefined
          ? updates.followUpDelayDays
          : updates.followUpTaskId === null ||
              updates.followUpDefinition === null
            ? null
            : task.followUpDelayDays
      );
      task.followUpTaskId = null;
      task.followUpDefinition = followUp.definition;
      task.followUpDelayDays = followUp.delayDays;
    }
    this.validateRecurrenceAnchor(task.recurrenceRule, task.dueDate);
    const parsedRecurrence = this.parseRecurrenceRule(task.recurrenceRule);
    this.validateFractionalRecurrence(
      parsedRecurrence,
      task.recurrenceInterval
    );
    if (updates.status !== undefined) {
      if (
        updates.status === TASK_STATUSES.ARCHIVED &&
        previousStatus !== updates.status
      ) {
        await this.recordTaskEvent(
          userId,
          task,
          updates.status,
          task.recurrenceSequenceIndex ?? 0,
          new Date()
        );
        task.pinnedAt = null;
        task.manualOrder = null;
        task.manualOrderOverride = false;
      }
      if (
        updates.status === TASK_STATUSES.ACTIVE &&
        previousStatus !== TASK_STATUSES.ACTIVE
      ) {
        await this.deleteLatestTaskEvent(userId, task.id);
      } else if (
        updates.status === TASK_STATUSES.ACTIVE &&
        previousRecurrenceRule &&
        updates.dueDate !== undefined &&
        updates.dueDate !== previousDueDate
      ) {
        await this.deleteLatestTaskEvent(userId, task.id, {
          eventType: TASK_STATUSES.COMPLETED,
          dueDate: updates.dueDate,
          dueTime: task.dueTime,
        });
      }
      task.status = updates.status;
    }
    if (
      updates.intentionSlug !== undefined ||
      updates.subIntentionSlug !== undefined ||
      updates.timerType !== undefined
    ) {
      let link: {
        intentionSlug: string | null;
        subIntentionSlug: string | null;
      };
      try {
        link = await this.resolveTaskLink(
          userId,
          task.timerType,
          updates.intentionSlug !== undefined
            ? updates.intentionSlug
            : task.intentionSlug,
          updates.subIntentionSlug !== undefined
            ? updates.subIntentionSlug
            : task.subIntentionSlug
        );
      } catch (error) {
        if (
          updates.timerType === undefined ||
          updates.intentionSlug !== undefined ||
          updates.subIntentionSlug !== undefined ||
          !(error instanceof BadRequestException)
        ) {
          throw error;
        }
        link = { intentionSlug: null, subIntentionSlug: null };
      }
      task.intentionSlug = link.intentionSlug;
      task.subIntentionSlug = link.subIntentionSlug;
    }

    if (
      previousTimerType !== task.timerType ||
      previousIntentionSlug !== task.intentionSlug ||
      previousSubIntentionSlug !== task.subIntentionSlug
    ) {
      task.manualOrder = null;
      task.manualOrderOverride = false;
    }

    if (task.status !== TASK_STATUSES.ACTIVE) {
      task.manualOrder = null;
      task.manualOrderOverride = false;
    } else if (previousStatus !== TASK_STATUSES.ACTIVE) {
      task.manualOrder = null;
      task.manualOrderOverride = false;
    }

    await this.seedPastDueReminderKeyIfNeeded(userId, task);
    const savedTask = await this.tasksRepository.save(task);
    if (
      previousStatus !== updates.status &&
      updates.status === TASK_STATUSES.ARCHIVED
    ) {
      await this.timerService.removeFocusedTask(userId, savedTask.id);
    }
    if (previousTimerType !== savedTask.timerType) {
      await this.timerService.removeFocusedTask(userId, savedTask.id);
    }

    await this.attachFollowUpParents(userId, [savedTask], this.tasksRepository);
    this.realtimeEvents.emitTasksUpdate(userId);
    return savedTask;
  }

  private async completeTask(
    userId: string,
    id: string,
    expectedDueDate: string | null | undefined,
    expectedDueTime: string | null | undefined
  ) {
    const completion = await this.tasksRepository.manager.transaction(
      async manager => {
        const taskRepository = manager.getRepository(TaskEntity);
        const eventRepository = manager.getRepository(TaskEventEntity);
        const task = await taskRepository.findOne({
          where: { id, userId, itemKind: In(['task', 'followUp']) },
          lock: { mode: 'pessimistic_write' },
        });

        if (!task) {
          throw new NotFoundException('Task not found');
        }

        if (task.status !== TASK_STATUSES.ACTIVE) {
          return { task, focusedTaskIds: [] as string[] };
        }

        if (
          (expectedDueDate !== undefined && task.dueDate !== expectedDueDate) ||
          (expectedDueTime !== undefined && task.dueTime !== expectedDueTime)
        ) {
          return { task, focusedTaskIds: [] as string[] };
        }

        const occurredAt = new Date();
        const recurrenceSequenceIndex = task.recurrenceSequenceIndex ?? 0;
        const nextDueDate = await this.getNextRecurringDueDate(
          userId,
          task,
          eventRepository
        );
        await this.recordTaskEvent(
          userId,
          task,
          TASK_STATUSES.COMPLETED,
          recurrenceSequenceIndex,
          occurredAt,
          eventRepository
        );

        if (nextDueDate) {
          task.dueDate = nextDueDate;
          task.status = TASK_STATUSES.ACTIVE;
        } else {
          task.status = TASK_STATUSES.COMPLETED;
        }
        task.pinnedAt = null;
        task.manualOrder = null;
        task.manualOrderOverride = false;
        const savedTask = await taskRepository.save(task);

        const activeGeneratedTasks = await taskRepository.find({
          where: {
            userId,
            followUpSourceTaskId: task.id,
            status: TASK_STATUSES.ACTIVE,
            itemKind: 'followUp',
          },
        });
        for (const generatedTask of activeGeneratedTasks) {
          await this.recordTaskEvent(
            userId,
            generatedTask,
            TASK_STATUSES.ARCHIVED,
            generatedTask.recurrenceSequenceIndex ?? 0,
            occurredAt,
            eventRepository
          );
          generatedTask.status = TASK_STATUSES.ARCHIVED;
          generatedTask.pinnedAt = null;
          generatedTask.manualOrder = null;
          generatedTask.manualOrderOverride = false;
          await taskRepository.save(generatedTask);
        }

        const generatedTask = await this.createFollowUpTask(
          userId,
          savedTask,
          occurredAt,
          taskRepository,
          eventRepository
        );

        return {
          task: savedTask,
          focusedTaskIds: [
            savedTask.id,
            ...activeGeneratedTasks.map(generated => generated.id),
          ],
          generatedTaskId: generatedTask?.id ?? null,
        };
      }
    );

    for (const focusedTaskId of completion.focusedTaskIds) {
      await this.timerService.removeFocusedTask(userId, focusedTaskId);
    }
    await this.attachFollowUpParents(
      userId,
      [completion.task],
      this.tasksRepository
    );
    this.realtimeEvents.emitTasksUpdate(userId);
    return completion.task;
  }

  private async createFollowUpTask(
    userId: string,
    sourceTask: TaskEntity,
    occurredAt: Date,
    taskRepository: Repository<TaskEntity>,
    eventRepository: Repository<TaskEventEntity>
  ) {
    if (
      !sourceTask.followUpDefinition ||
      sourceTask.followUpDelayDays === null ||
      sourceTask.followUpDelayDays === undefined
    ) {
      return null;
    }

    const definition = sourceTask.followUpDefinition;

    const preferences = await this.preferencesService.getPreferences(userId);
    const completionDate = this.formatDateInTimeZone(
      occurredAt,
      this.normalizeTimeZone(preferences.timeZone)
    );
    const followUp = taskRepository.create({
      userId,
      title: definition.title,
      description: definition.description,
      sourceTranscript: null,
      creationSource: TASK_CREATION_SOURCES.MANUAL,
      importSource: null,
      importSourceTaskId: null,
      dueDate: this.addDaysToDateString(
        completionDate,
        sourceTask.followUpDelayDays
      ),
      dueTime: definition.dueTime,
      manualOrder: null,
      manualOrderOverride: false,
      lastReminderKey: null,
      priority: definition.priority,
      status: TASK_STATUSES.ACTIVE,
      timerType: definition.timerType,
      pinnedAt: null,
      intentionSlug: definition.intentionSlug,
      subIntentionSlug: definition.subIntentionSlug,
      recurrenceRule: null,
      recurrenceInterval: null,
      recurrenceSequenceIndex: 0,
      recurrenceAnchorMode: 'planned',
      followUpTaskId: null,
      followUpDefinition: null,
      followUpDelayDays: null,
      followUpSourceTaskId: sourceTask.id,
      itemKind: 'followUp',
      listId: null,
      taskRestoreState: null,
      vacationEligible: definition.vacationEligible,
      lastVacationRunId: null,
      lastVacationShiftedOn: null,
    });
    const savedFollowUp = await taskRepository.save(followUp);
    await this.recordCreatedTaskEvent(savedFollowUp, eventRepository);
    if (this.shouldSeedPastDueReminderKey(savedFollowUp, preferences)) {
      savedFollowUp.lastReminderKey = this.getDueReminderKey(savedFollowUp);
      await taskRepository.update(savedFollowUp.id, {
        lastReminderKey: savedFollowUp.lastReminderKey,
      });
    }
    return savedFollowUp;
  }

  private async resolveTaskLink(
    userId: string,
    timerType: TimerTypes,
    intentionSlug: string | null,
    subIntentionSlug: string | null
  ) {
    const normalizedIntentionSlug = this.normalizeOptionalSlug(intentionSlug);
    const normalizedSubIntentionSlug =
      this.normalizeOptionalSlug(subIntentionSlug);

    if (!normalizedIntentionSlug) {
      if (normalizedSubIntentionSlug) {
        throw new BadRequestException(
          'Task sub-intention requires a linked intention'
        );
      }

      return { intentionSlug: null, subIntentionSlug: null };
    }

    await this.intentionsService.validateTaskIntentionSelection(
      userId,
      [normalizedIntentionSlug],
      normalizedSubIntentionSlug
        ? { [normalizedIntentionSlug]: normalizedSubIntentionSlug }
        : {},
      [timerType]
    );

    return {
      intentionSlug: normalizedIntentionSlug,
      subIntentionSlug: normalizedSubIntentionSlug,
    };
  }

  private async validateFollowUpConfiguration(
    userId: string,
    followUpTaskId: string | null | undefined,
    followUpDefinition: TaskFollowUpDefinition | null | undefined,
    followUpDelayDays: number | null | undefined
  ) {
    const normalizedTaskId = this.normalizeOptionalSlug(followUpTaskId);
    if (normalizedTaskId) {
      throw new BadRequestException(
        'Follow-up Tasks must be configured inside their parent Task'
      );
    }
    if (!followUpDefinition) {
      if (followUpDelayDays !== undefined && followUpDelayDays !== null) {
        throw new BadRequestException(
          'Follow-up delay requires a follow-up definition'
        );
      }
      return { definition: null, delayDays: null };
    }

    if (
      followUpDelayDays === undefined ||
      followUpDelayDays === null ||
      !Number.isInteger(followUpDelayDays) ||
      followUpDelayDays < 0 ||
      followUpDelayDays > TASK_FOLLOW_UP_DELAY_MAX_DAYS
    ) {
      throw new BadRequestException(
        `Follow-up delay must be a whole number of days from 0 to ${TASK_FOLLOW_UP_DELAY_MAX_DAYS}`
      );
    }

    const timerType = followUpDefinition.timerType ?? TIMER_TYPES.WORK;
    const link = await this.resolveTaskLink(
      userId,
      timerType,
      followUpDefinition.intentionSlug,
      followUpDefinition.subIntentionSlug
    );
    return {
      definition: {
        title: this.requireTitle(followUpDefinition.title),
        description: this.normalizeOptionalText(followUpDefinition.description),
        dueTime: this.resolveDueTime(followUpDefinition.dueTime),
        priority: followUpDefinition.priority ?? TASK_PRIORITIES.NORMAL,
        timerType,
        intentionSlug: link.intentionSlug,
        subIntentionSlug: link.subIntentionSlug,
        vacationEligible: followUpDefinition.vacationEligible === true,
      },
      delayDays: followUpDelayDays,
    };
  }

  private requireTitle(title: string) {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new BadRequestException('Task title is required');
    }

    return trimmedTitle;
  }

  private async seedPastDueReminderKeyIfNeeded(
    userId: string,
    task: TaskEntity
  ) {
    const preferences = await this.preferencesService.getPreferences(userId);
    if (this.shouldSeedPastDueReminderKey(task, preferences)) {
      task.lastReminderKey = this.getDueReminderKey(task);
    }
  }

  private shouldSeedPastDueReminderKey(
    task: TaskEntity,
    preferences: Pick<Preferences, 'taskReminderPriorities' | 'timeZone'>
  ) {
    if (
      task.status !== TASK_STATUSES.ACTIVE ||
      !preferences.taskReminderPriorities.includes(task.priority) ||
      !task.dueDate
    ) {
      return false;
    }

    return new Date() >= this.getTaskDueAt(task, preferences.timeZone);
  }

  private getDueReminderKey(task: TaskEntity) {
    return `${task.id}:${task.dueDate}:${task.dueTime ?? TASK_DEFAULT_DUE_TIME}`;
  }

  private getTaskDueAt(task: TaskEntity, timeZone: string) {
    if (!task.dueDate) {
      return new Date(Number.POSITIVE_INFINITY);
    }

    return this.getDateTimeInTimeZone(
      task.dueDate,
      task.dueTime ?? TASK_DEFAULT_DUE_TIME,
      this.normalizeTimeZone(timeZone)
    );
  }

  private formatLocalDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private async getNextRecurringDueDate(
    userId: string,
    task: TaskEntity,
    eventRepository?: Pick<Repository<TaskEventEntity>, 'createQueryBuilder'>
  ) {
    const recurrence = this.parseRecurrenceRule(task.recurrenceRule);
    if (!recurrence) {
      return null;
    }

    const events = eventRepository ?? this.taskEventsRepository;
    let consumedOccurrences = task.recurrenceInterval
      ? (task.recurrenceSequenceIndex ?? 0) + 1
      : (await events
          .createQueryBuilder('event')
          .where('event.userId = :userId', { userId })
          .andWhere('event.taskId = :taskId', { taskId: task.id })
          .andWhere('event.eventType IN (:...eventTypes)', {
            eventTypes: [TASK_STATUSES.COMPLETED],
          })
          .getCount()) + 1;
    if (recurrence.count !== null && consumedOccurrences >= recurrence.count) {
      return null;
    }

    const anchorDate =
      task.recurrenceAnchorMode === 'completion'
        ? this.parseDate(new Date().toISOString().slice(0, 10))
        : task.dueDate
          ? this.parseDate(task.dueDate)
          : null;
    if (!anchorDate) {
      return null;
    }

    const seriesAnchorDate = new Date(anchorDate);
    let nextSequenceIndex = task.recurrenceSequenceIndex ?? 0;
    const fractionalResult = task.recurrenceInterval
      ? this.findNextFractionalRecurrenceDate(
          anchorDate,
          recurrence,
          task.recurrenceInterval,
          consumedOccurrences
        )
      : null;
    let nextDate = task.recurrenceInterval
      ? (fractionalResult?.date ?? null)
      : this.findNextRecurrenceDateAfter(
          anchorDate,
          seriesAnchorDate,
          recurrence
        );
    if (fractionalResult) {
      nextSequenceIndex = fractionalResult.sequenceIndex;
    }
    if (!nextDate) {
      return null;
    }
    const today = this.parseDate(new Date().toISOString().slice(0, 10));
    while (nextDate < today && task.recurrenceAnchorMode === 'planned') {
      consumedOccurrences += 1;
      if (
        recurrence.count !== null &&
        consumedOccurrences >= recurrence.count
      ) {
        return null;
      }
      if (task.recurrenceInterval) {
        const nextFractionalResult = this.findNextFractionalRecurrenceDate(
          nextDate,
          recurrence,
          task.recurrenceInterval,
          nextSequenceIndex + 1
        );
        nextDate = nextFractionalResult?.date ?? null;
        if (nextFractionalResult) {
          nextSequenceIndex = nextFractionalResult.sequenceIndex;
        }
      } else {
        nextDate = this.findNextRecurrenceDateAfter(
          nextDate,
          seriesAnchorDate,
          recurrence
        );
      }
      if (!nextDate) {
        return null;
      }
    }

    if (task.recurrenceInterval) {
      task.recurrenceSequenceIndex = nextSequenceIndex;
    }
    return nextDate.toISOString().slice(0, 10);
  }

  private parseRecurrenceRule(
    rule: string | null | undefined
  ): ParsedRecurrence | null {
    let normalizedRule = rule?.trim().toUpperCase();
    if (!normalizedRule) {
      return null;
    }
    if (normalizedRule.startsWith('RRULE:')) {
      normalizedRule = normalizedRule.slice('RRULE:'.length);
    }

    const allowedParts = new Set([
      'FREQ',
      'INTERVAL',
      'COUNT',
      'UNTIL',
      'BYDAY',
      'BYMONTHDAY',
      'EXDATE',
    ]);
    const parts: Record<string, string> = {};
    for (const part of normalizedRule.split(';')) {
      const [key, value, extra] = part.split('=');
      if (
        !key ||
        !value ||
        extra !== undefined ||
        !allowedParts.has(key) ||
        parts[key] !== undefined
      ) {
        throw new BadRequestException('Task recurrence rule is invalid');
      }
      parts[key] = value;
    }
    const frequency = parts.FREQ;
    const interval = Number(parts.INTERVAL ?? '1');
    const count = parts.COUNT === undefined ? null : Number(parts.COUNT);
    const until =
      parts.UNTIL === undefined ? null : this.parseRecurrenceDate(parts.UNTIL);
    const byDay =
      parts.BYDAY === undefined ? null : this.parseByDay(parts.BYDAY);
    const byMonthDay =
      parts.BYMONTHDAY === undefined
        ? null
        : this.parseByMonthDay(parts.BYMONTHDAY);
    const exDates =
      parts.EXDATE === undefined
        ? new Set<string>()
        : new Set(
            parts.EXDATE.split(',').map(date =>
              this.formatDate(this.parseRecurrenceDate(date))
            )
          );

    if (
      !['DAILY', 'WEEKLY', 'MONTHLY'].includes(frequency) ||
      !Number.isInteger(interval) ||
      interval < 1 ||
      (count !== null && (!Number.isInteger(count) || count < 1))
    ) {
      throw new BadRequestException('Task recurrence rule is invalid');
    }

    return {
      frequency: frequency as RecurrenceFrequency,
      interval,
      count,
      until,
      byDay,
      byMonthDay,
      exDates,
    };
  }

  private validateFractionalRecurrence(
    recurrence: ParsedRecurrence | null,
    interval: number | null | undefined
  ) {
    if (interval === null || interval === undefined) {
      return;
    }
    if (!recurrence || !Number.isFinite(interval) || interval < 1) {
      throw new BadRequestException('Task recurrence interval is invalid');
    }
    if (
      !Number.isInteger(interval) &&
      (recurrence.byDay !== null || recurrence.byMonthDay !== null)
    ) {
      throw new BadRequestException(
        'Fractional recurrence cannot use BYDAY or BYMONTHDAY'
      );
    }
  }

  private findNextFractionalRecurrenceDate(
    afterDate: Date,
    recurrence: ParsedRecurrence,
    interval: number,
    occurrenceIndex: number
  ) {
    let index = occurrenceIndex;
    let candidate = new Date(afterDate);
    for (let attempts = 0; attempts < 3650; attempts += 1) {
      if (recurrence.count !== null && index >= recurrence.count) {
        return null;
      }
      const gap = Math.max(
        1,
        Math.floor(index * interval + 1e-9) -
          Math.floor((index - 1) * interval + 1e-9)
      );
      candidate = this.addRecurrenceUnits(candidate, recurrence.frequency, gap);
      if (recurrence.until && candidate > recurrence.until) {
        return null;
      }
      if (!recurrence.exDates.has(this.formatDate(candidate))) {
        return { date: candidate, sequenceIndex: index };
      }
      index += 1;
    }
    return null;
  }

  private addRecurrenceUnits(
    date: Date,
    frequency: RecurrenceFrequency,
    amount: number
  ) {
    const next = new Date(date);
    if (frequency === 'DAILY') {
      next.setUTCDate(next.getUTCDate() + amount);
      return next;
    }
    if (frequency === 'WEEKLY') {
      next.setUTCDate(next.getUTCDate() + amount * 7);
      return next;
    }

    const originalDay = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + amount);
    const lastDay = new Date(
      Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
    ).getUTCDate();
    next.setUTCDate(Math.min(originalDay, lastDay));
    return next;
  }

  private findNextRecurrenceDateAfter(
    afterDate: Date,
    seriesAnchorDate: Date,
    recurrence: ParsedRecurrence
  ) {
    const candidate = new Date(afterDate);
    for (let dayOffset = 0; dayOffset < 3650; dayOffset += 1) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      if (recurrence.until && candidate > recurrence.until) {
        return null;
      }
      if (this.matchesRecurrenceDate(candidate, seriesAnchorDate, recurrence)) {
        return new Date(candidate);
      }
    }

    return null;
  }

  private matchesRecurrenceDate(
    candidate: Date,
    seriesAnchorDate: Date,
    recurrence: ParsedRecurrence
  ) {
    const candidateDate = this.formatDate(candidate);
    if (recurrence.exDates.has(candidateDate)) {
      return false;
    }

    if (recurrence.byDay && !recurrence.byDay.includes(candidate.getUTCDay())) {
      return false;
    }

    if (
      recurrence.byMonthDay &&
      !recurrence.byMonthDay.includes(candidate.getUTCDate())
    ) {
      return false;
    }

    if (recurrence.frequency === 'DAILY') {
      return (
        this.daysBetween(seriesAnchorDate, candidate) % recurrence.interval ===
        0
      );
    }

    if (recurrence.frequency === 'WEEKLY') {
      const weekdayMatches = recurrence.byDay
        ? true
        : candidate.getUTCDay() === seriesAnchorDate.getUTCDay();
      return (
        weekdayMatches &&
        this.weeksBetween(seriesAnchorDate, candidate) % recurrence.interval ===
          0
      );
    }

    const monthMatches =
      recurrence.byMonthDay || recurrence.byDay
        ? true
        : candidate.getUTCDate() === seriesAnchorDate.getUTCDate();
    return (
      monthMatches &&
      this.monthsBetween(seriesAnchorDate, candidate) % recurrence.interval ===
        0
    );
  }

  private parseDate(date: string) {
    this.validateDueDate(date);
    return new Date(`${date}T00:00:00.000Z`);
  }

  private parseRecurrenceDate(value: string) {
    const datePart = value.split('T')[0];
    const normalizedDate =
      datePart.length === 8
        ? `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`
        : datePart;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      throw new BadRequestException('Task recurrence rule is invalid');
    }

    this.validateDueDate(normalizedDate, 'Task recurrence rule is invalid');
    return this.parseDate(normalizedDate);
  }

  private parseByDay(value: string) {
    const days = value.split(',').map(day => day.trim());
    const indexes = days.map(day => WEEKDAY_INDEX[day]);
    if (indexes.some(index => index === undefined)) {
      throw new BadRequestException('Task recurrence rule is invalid');
    }

    return indexes;
  }

  private parseByMonthDay(value: string) {
    const monthDays = value.split(',').map(day => Number(day));
    if (
      monthDays.some(
        monthDay => !Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31
      )
    ) {
      throw new BadRequestException('Task recurrence rule is invalid');
    }

    return monthDays;
  }

  private daysBetween(start: Date, end: Date) {
    return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
  }

  private weeksBetween(start: Date, end: Date) {
    return Math.floor(
      (this.startOfWeek(end).getTime() - this.startOfWeek(start).getTime()) /
        (7 * 86_400_000)
    );
  }

  private monthsBetween(start: Date, end: Date) {
    return (
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      end.getUTCMonth() -
      start.getUTCMonth()
    );
  }

  private startOfWeek(date: Date) {
    const start = new Date(date);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    return start;
  }

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private normalizeTimeZone(timeZone: string | null | undefined) {
    if (!timeZone) {
      return 'UTC';
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
      return timeZone;
    } catch {
      return 'UTC';
    }
  }

  private formatDateInTimeZone(date: Date, timeZone: string) {
    try {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .formatToParts(date)
          .filter(part => part.type !== 'literal')
          .map(part => [part.type, part.value])
      );

      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch {
      return this.formatDate(date);
    }
  }

  private getDateStartInTimeZone(date: string, timeZone: string) {
    return this.getDateTimeInTimeZone(date, '00:00', timeZone);
  }

  private addDaysToDateString(date: string, days: number) {
    const [year, month, day] = date.split('-').map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day));
    nextDate.setUTCDate(nextDate.getUTCDate() + days);
    return this.formatDate(nextDate);
  }

  private getDateRangeLength(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    return Math.max(
      1,
      Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
    );
  }

  private validateRecurrenceAnchor(
    recurrenceRule: string | null | undefined,
    dueDate: string | null | undefined
  ) {
    if (recurrenceRule && !dueDate) {
      throw new BadRequestException('Recurring tasks require a due date');
    }
  }

  private validateDueDate(
    dueDate: string | null | undefined,
    message = 'Task due date is invalid'
  ) {
    if (!dueDate) {
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new BadRequestException(message);
    }

    const date = new Date(`${dueDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || this.formatDate(date) !== dueDate) {
      throw new BadRequestException(message);
    }
  }

  private async recordTaskEvent(
    userId: string,
    task: TaskEntity,
    eventType: TaskLifecycleEventType,
    recurrenceSequenceIndex: number,
    occurredAt: Date,
    eventRepository?: Pick<Repository<TaskEventEntity>, 'create' | 'save'>
  ) {
    const preferences = await this.preferencesService.getPreferences(userId);
    const repository = eventRepository ?? this.taskEventsRepository;
    const event = repository.create({
      userId,
      taskId: task.id,
      eventType,
      titleSnapshot: task.title,
      prioritySnapshot: task.priority,
      timerTypeSnapshot: task.timerType,
      intentionSlugSnapshot: task.intentionSlug,
      subIntentionSlugSnapshot: task.subIntentionSlug,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      recurrenceSequenceIndex,
      recurrenceRuleSnapshot: task.recurrenceRule,
      recurrenceIntervalSnapshot: task.recurrenceInterval,
      recurrenceAnchorModeSnapshot: task.recurrenceAnchorMode,
      isOverdue: this.isTaskOverdueAt(task, occurredAt, preferences.timeZone),
      occurredAt,
    });
    await repository.save(event);
  }

  private isTaskOverdueAt(
    task: TaskEntity,
    occurredAt: Date,
    timeZone = 'UTC'
  ) {
    if (!task.dueDate) {
      return false;
    }

    const dueBoundary = this.getDateTimeInTimeZone(
      task.dueDate,
      task.dueTime ?? '00:00',
      timeZone
    );
    if (!task.dueTime) {
      dueBoundary.setUTCDate(dueBoundary.getUTCDate() + 1);
    }
    return occurredAt.getTime() > dueBoundary.getTime();
  }

  private getDateTimeInTimeZone(date: string, time: string, timeZone: string) {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const targetTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0);

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      let timestamp = targetTimestamp;

      for (let index = 0; index < 3; index += 1) {
        const parts = Object.fromEntries(
          formatter
            .formatToParts(new Date(timestamp))
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, Number(part.value)])
        );
        const zonedTimestamp = Date.UTC(
          parts.year,
          parts.month - 1,
          parts.day,
          parts.hour,
          parts.minute,
          parts.second
        );
        const offset = targetTimestamp - zonedTimestamp;
        if (offset === 0) {
          break;
        }
        timestamp += offset;
      }

      return new Date(timestamp);
    } catch {
      return new Date(`${date}T${time}:00`);
    }
  }

  private async deleteLatestTaskEvent(
    userId: string,
    taskId: string,
    expected?: {
      eventType?: TaskLifecycleEventType;
      dueDate?: string | null;
      dueTime?: string | null;
    }
  ) {
    const event = await this.taskEventsRepository.findOne({
      where: { userId, taskId },
      order: { occurredAt: 'DESC' },
    });
    if (!event) {
      return;
    }

    if (expected?.eventType && event.eventType !== expected.eventType) {
      return;
    }
    if (
      expected &&
      'dueDate' in expected &&
      event.dueDate !== expected.dueDate
    ) {
      return;
    }
    if (
      expected &&
      'dueTime' in expected &&
      event.dueTime !== expected.dueTime
    ) {
      return;
    }

    await this.taskEventsRepository.delete(event.id);
  }

  private resolveDueTime(dueTime: string | null | undefined) {
    return this.normalizeOptionalSlug(dueTime);
  }

  private normalizeOptionalSlug(slug: string | null | undefined) {
    const normalized = slug?.trim();
    return normalized ? normalized : null;
  }

  private normalizeOptionalText(text: string | null | undefined) {
    const normalized = text?.trim();
    return normalized ? normalized : null;
  }
}
