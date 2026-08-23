import {
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  IntentionType,
  StatisticsSummary,
  Timer,
  TIMER_TYPES,
  TimerTypes,
  TopIntentionStat,
  WorkTimerLog,
} from '@pomi/shared';
import { format, startOfDay, subDays } from 'date-fns';
import { IntentionsService } from 'src/intentions/intentions.service';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Statistic } from './statistics.entity';

type WorkTimerLogUpdateInput = {
  intention?: string | null;
  intentions?: string[];
  subIntentions?: Record<string, string>;
  duration: number;
};

type StatisticsPeriodKey =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'previousWeek'
  | 'month'
  | 'previousMonth'
  | 'year'
  | 'previousYear';
type StatisticsPeriod = { count: number; duration: number };
type StatisticsPeriods = Record<StatisticsPeriodKey, StatisticsPeriod>;
type FirstStatisticsLog = {
  date: string | null;
  completedAt: number | null;
};

type TodayIntentionCountRow = {
  kind: 'parent' | 'sub';
  intention: string | null;
  count: string | number;
};

export type TodayIntentionCounts = {
  count: number;
  bySlug: Record<string, number>;
  subBySlug: Record<string, number>;
};

export type StatisticHistorySnapshot = {
  id: string;
  userId: string;
  type: string;
  date: string;
  duration: number;
  completedAt: number;
  intention: string | null;
  intentions: string[] | null;
  subIntentions: Record<string, string> | null;
};

@Injectable()
export class StatisticsService {
  constructor(
    @InjectRepository(Statistic)
    private statisticsRepository: Repository<Statistic>,
    @Inject(forwardRef(() => IntentionsService))
    private intentionsService: IntentionsService
  ) {}

  private getStatisticIntentions(
    source:
      | Pick<Statistic, 'intention' | 'intentions'>
      | Pick<Timer, 'intention' | 'intentionSlugs'>
  ): string[] {
    if ('intentionSlugs' in source && Array.isArray(source.intentionSlugs)) {
      return Array.from(new Set(source.intentionSlugs.filter(Boolean)));
    }

    if ('intentions' in source && Array.isArray(source.intentions)) {
      return Array.from(new Set(source.intentions.filter(Boolean)));
    }

    return source.intention ? [source.intention] : [];
  }

  private getPrimaryIntentionSlug(intentions: string[]): string | null {
    return intentions[0] ?? null;
  }

  private getSlugDifference(previous: string[], next: string[]): string[] {
    const nextSlugs = new Set(next);
    return Array.from(new Set(previous.filter(slug => !nextSlugs.has(slug))));
  }

  private async syncStatisticIntentionUsage(
    userId: string,
    previousIntentions: string[],
    nextIntentions: string[],
    previousSubIntentions: Record<string, string>,
    nextSubIntentions: Record<string, string>
  ): Promise<void> {
    const previousSubSlugs = Object.values(previousSubIntentions);
    const nextSubSlugs = Object.values(nextSubIntentions);
    const removedIntentions = this.getSlugDifference(
      previousIntentions,
      nextIntentions
    );
    const addedIntentions = this.getSlugDifference(
      nextIntentions,
      previousIntentions
    );
    const removedSubIntentions = this.getSlugDifference(
      previousSubSlugs,
      nextSubSlugs
    );
    const addedSubIntentions = this.getSlugDifference(
      nextSubSlugs,
      previousSubSlugs
    );
    const updates: Promise<void>[] = [];

    if (removedIntentions.length > 0) {
      updates.push(
        this.intentionsService.decrementIntentionsUsage(
          userId,
          removedIntentions
        )
      );
    }

    if (addedIntentions.length > 0) {
      updates.push(
        this.intentionsService.incrementIntentionsUsage(userId, addedIntentions)
      );
    }

    if (removedSubIntentions.length > 0) {
      updates.push(
        this.intentionsService.decrementIntentionsUsage(
          userId,
          removedSubIntentions
        )
      );
    }

    if (addedSubIntentions.length > 0) {
      updates.push(
        this.intentionsService.incrementIntentionsUsage(
          userId,
          addedSubIntentions
        )
      );
    }

    await Promise.all(updates);
  }

  private getStatisticSubIntentions(
    source: Pick<Statistic, 'subIntentions'> | Pick<Timer, 'subIntentions'>
  ): Record<string, string> {
    const subIntentions = source.subIntentions;
    if (!subIntentions || typeof subIntentions !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(subIntentions).filter(
        ([parentSlug, subSlug]) => Boolean(parentSlug) && Boolean(subSlug)
      )
    );
  }

  private normalizeRequestedIntentions(intentions: string[]): string[] {
    return Array.from(
      new Set(intentions.map(slug => slug.trim()).filter(Boolean))
    );
  }

  private normalizeRequestedSubIntentions(
    selectedIntentions: string[],
    subIntentions?: Record<string, string>
  ): Record<string, string> {
    if (!subIntentions || typeof subIntentions !== 'object') {
      return {};
    }

    const selectedSlugs = new Set(selectedIntentions);
    return Object.fromEntries(
      Object.entries(subIntentions)
        .map(([parentSlug, subSlug]) => [parentSlug.trim(), subSlug.trim()])
        .filter(
          ([parentSlug, subSlug]) =>
            selectedSlugs.has(parentSlug) && Boolean(subSlug)
        )
    );
  }

  private areSlugListsEqual(previous: string[], next: string[]): boolean {
    if (previous.length !== next.length) {
      return false;
    }

    return previous.every((slug, index) => slug === next[index]);
  }

  private areSubIntentionMapsEqual(
    previous: Record<string, string>,
    next: Record<string, string>
  ): boolean {
    const previousEntries = Object.entries(previous);
    const nextEntries = Object.entries(next);

    if (previousEntries.length !== nextEntries.length) {
      return false;
    }

    return previousEntries.every(
      ([parentSlug, subSlug]) => next[parentSlug] === subSlug
    );
  }

  private async syncDurationOnlyUsageChange(
    userId: string,
    before: StatisticHistorySnapshot | null,
    after: StatisticHistorySnapshot | null
  ): Promise<void> {
    if (!before || !after || before.duration === after.duration) {
      return;
    }

    const beforeIntentions = this.getStatisticIntentions(before);
    const afterIntentions = this.getStatisticIntentions(after);
    const beforeSubIntentions = this.getStatisticSubIntentions(before);
    const afterSubIntentions = this.getStatisticSubIntentions(after);

    if (
      !this.areSlugListsEqual(beforeIntentions, afterIntentions) ||
      !this.areSubIntentionMapsEqual(beforeSubIntentions, afterSubIntentions)
    ) {
      return;
    }

    const subIntentionSlugs = Object.values(afterSubIntentions);
    const slugs = Array.from(
      new Set([...afterIntentions, ...subIntentionSlugs])
    );

    if (slugs.length === 0) {
      return;
    }

    if (after.duration > before.duration) {
      await this.intentionsService.incrementIntentionsUsage(userId, slugs);
    } else {
      await this.intentionsService.decrementIntentionsUsage(userId, slugs);
    }
  }

  private async validateStatisticIntentionSelection(
    userId: string,
    type: IntentionType,
    selectedIntentions: string[],
    subIntentions: Record<string, string>
  ): Promise<void> {
    await this.intentionsService.validateSubIntentionSelection(
      userId,
      selectedIntentions,
      subIntentions,
      [type]
    );
  }

  private getTypesForSessionType(sessionType?: IntentionType): TimerTypes[] {
    if (sessionType === TIMER_TYPES.BREAK) {
      return [TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK];
    }

    if (sessionType === TIMER_TYPES.LONG_BREAK) {
      return [TIMER_TYPES.LONG_BREAK];
    }

    return [TIMER_TYPES.WORK];
  }

  private getExactTypesForSessionType(
    sessionType?: IntentionType
  ): TimerTypes[] {
    if (sessionType === TIMER_TYPES.BREAK) {
      return [TIMER_TYPES.BREAK];
    }

    if (sessionType === TIMER_TYPES.LONG_BREAK) {
      return [TIMER_TYPES.LONG_BREAK];
    }

    return [TIMER_TYPES.WORK];
  }

  private async findStatisticById(
    userId: string,
    timerId: string
  ): Promise<Statistic | null> {
    return this.statisticsRepository.findOne({
      where: { id: timerId, userId },
    });
  }

  private async findMostRecentWorkStatistic(
    userId: string,
    intention?: string
  ): Promise<Statistic | null> {
    const query = this.statisticsRepository
      .createQueryBuilder('statistic')
      .where('statistic.userId = :userId', { userId })
      .andWhere('statistic.type = :type', { type: 'work' })
      .orderBy('statistic.completedAt', 'DESC')
      .limit(1);

    if (intention) {
      query.andWhere('statistic.intention = :intention', { intention });
    }

    return (await query.getOne()) ?? null;
  }

  private async findStatisticForAppend(
    userId: string,
    timerId: string,
    intention?: string
  ): Promise<Statistic | null> {
    const statisticByTimerId = await this.findStatisticById(userId, timerId);

    if (statisticByTimerId) {
      return statisticByTimerId;
    }

    return this.findMostRecentWorkStatistic(userId, intention);
  }

  async recordCompletedTimer(userId: string, timer: Timer): Promise<void> {
    const intentions = this.getStatisticIntentions(timer);
    const subIntentions = this.getStatisticSubIntentions(timer);
    const statistic = this.statisticsRepository.create({
      userId,
      id: timer.id,
      date: format(new Date(), 'yyyy-MM-dd'),
      type: timer.type,
      duration: timer.duration - timer.remainingTime,
      completedAt: Date.now(),
      intention: this.getPrimaryIntentionSlug(intentions),
      intentions: intentions.length > 0 ? intentions : null,
      subIntentions:
        Object.keys(subIntentions).length > 0 ? subIntentions : null,
    });

    await this.statisticsRepository.save(statistic);
  }

  async appendDurationToStatistic(
    userId: string,
    timerId: string,
    additionalDuration: number,
    intention?: string
  ): Promise<void> {
    const statistic = await this.findStatisticForAppend(
      userId,
      timerId,
      intention
    );

    if (statistic) {
      statistic.duration += additionalDuration;
      statistic.completedAt = Date.now();
      await this.statisticsRepository.save(statistic);
    }
  }

  async getStatisticUndoSnapshot(
    userId: string,
    timerId: string
  ): Promise<{ duration: number; completedAt: number } | null> {
    const statistic = await this.findStatisticById(userId, timerId);

    if (!statistic) {
      return null;
    }

    return {
      duration: statistic.duration,
      completedAt: Number(statistic.completedAt),
    };
  }

  async getStatisticHistorySnapshot(
    userId: string,
    timerId: string
  ): Promise<StatisticHistorySnapshot | null> {
    const statistic = await this.findStatisticById(userId, timerId);

    if (!statistic) {
      return null;
    }

    return this.toHistorySnapshot(statistic);
  }

  async restoreStatisticHistorySnapshot(
    userId: string,
    before: StatisticHistorySnapshot | null,
    after: StatisticHistorySnapshot | null
  ): Promise<void> {
    const id = after?.id ?? before?.id;
    if (!id) {
      return;
    }

    const current = await this.findStatisticById(userId, id);
    const currentIntentions = current
      ? this.getStatisticIntentions(current)
      : [];
    const currentSubIntentions = current
      ? this.getStatisticSubIntentions(current)
      : {};
    const nextIntentions = after ? this.getStatisticIntentions(after) : [];
    const nextSubIntentions = after
      ? this.getStatisticSubIntentions(after)
      : {};

    if (after) {
      await this.statisticsRepository.save(
        this.statisticsRepository.create({
          ...after,
          userId,
        })
      );
    } else if (current) {
      await this.statisticsRepository.delete({ userId, id });
    }

    await this.syncStatisticIntentionUsage(
      userId,
      currentIntentions,
      nextIntentions,
      currentSubIntentions,
      nextSubIntentions
    );
    await this.syncDurationOnlyUsageChange(userId, before, after);
  }

  private toHistorySnapshot(statistic: Statistic): StatisticHistorySnapshot {
    return {
      id: statistic.id,
      userId: statistic.userId,
      type: statistic.type,
      date: statistic.date,
      duration: statistic.duration,
      completedAt: Number(statistic.completedAt),
      intention: statistic.intention,
      intentions: statistic.intentions,
      subIntentions: statistic.subIntentions,
    };
  }

  async restoreStatisticForUndo(
    userId: string,
    timerId: string,
    duration: number,
    completedAt: number
  ): Promise<boolean> {
    const statistic = await this.findStatisticById(userId, timerId);

    if (!statistic) {
      return false;
    }

    statistic.duration = duration;
    statistic.completedAt = completedAt;
    await this.statisticsRepository.save(statistic);

    return true;
  }

  async removeCompletionForUndo(
    userId: string,
    timerId: string,
    capturedAt: number,
    timerType: TimerTypes,
    intention?: string
  ): Promise<boolean> {
    const removeByTimerId = await this.statisticsRepository.delete({
      userId,
      id: timerId,
    });

    if ((removeByTimerId.affected ?? 0) > 0) {
      return true;
    }

    const query = this.statisticsRepository
      .createQueryBuilder('statistic')
      .where('statistic.userId = :userId', { userId })
      .andWhere('statistic.type = :timerType', { timerType })
      .andWhere('statistic.completedAt >= :capturedAt', { capturedAt })
      .orderBy('statistic.completedAt', 'DESC')
      .limit(1);

    if (intention) {
      query.andWhere('statistic.intention = :intention', { intention });
    }

    const fallbackStatistic = await query.getOne();
    if (!fallbackStatistic) {
      return false;
    }

    await this.statisticsRepository.delete({
      id: fallbackStatistic.id,
      userId,
    });

    return true;
  }

  async getTodayIntentionsCounts(
    userId: string,
    type: IntentionType | undefined,
    start: number,
    end: number
  ): Promise<TodayIntentionCounts> {
    const types = this.getExactTypesForSessionType(type);
    const results = await this.statisticsRepository.query<
      TodayIntentionCountRow[]
    >(
      `
        WITH parent_counts AS (
          SELECT selected.slug AS intention, COUNT(*)::int AS count
          FROM statistics statistic
          CROSS JOIN LATERAL unnest(
            COALESCE(
              statistic.intentions,
              CASE
                WHEN statistic.intention IS NOT NULL AND statistic.intention != ''
                  THEN ARRAY[statistic.intention]::text[]
                ELSE ARRAY[]::text[]
              END
            )
          ) AS selected(slug)
          WHERE statistic."userId" = $1
            AND statistic.type = ANY($2)
            AND statistic."completedAt" >= $3
            AND statistic."completedAt" < $4
            AND (
              statistic."subIntentions" IS NULL
              OR statistic."subIntentions" ->> selected.slug IS NULL
            )
          GROUP BY selected.slug
        ),
        sub_counts AS (
          SELECT selected.value AS intention, COUNT(*)::int AS count
          FROM statistics statistic
          CROSS JOIN LATERAL jsonb_each_text(COALESCE(statistic."subIntentions", '{}'::jsonb)) AS selected(parent_slug, value)
          WHERE statistic."userId" = $1
            AND statistic.type = ANY($2)
            AND statistic."completedAt" >= $3
            AND statistic."completedAt" < $4
          GROUP BY selected.value
        )
        SELECT 'parent'::text AS kind, intention, count
        FROM parent_counts
        UNION ALL
        SELECT 'sub'::text AS kind, intention, count
        FROM sub_counts
      `,
      [userId, types, start, end]
    );

    const bySlug: Record<string, number> = {};
    const subBySlug: Record<string, number> = {};
    let count = 0;
    results.forEach(result => {
      if (!result.intention) return;
      const value = Number(result.count);
      count += value;
      (result.kind === 'sub' ? subBySlug : bySlug)[result.intention] = value;
    });

    return { count, bySlug, subBySlug };
  }

  async getMonthlyIntentionsUsage(
    userId: string,
    type?: IntentionType
  ): Promise<Record<string, { count: number }>> {
    const types = this.getTypesForSessionType(type);
    const results = await this.statisticsRepository.query(
      `
        SELECT selected.slug AS intention, COUNT(*)::int AS count
        FROM statistics statistic
        CROSS JOIN LATERAL unnest(COALESCE(statistic.intentions, ARRAY[]::text[])) AS selected(slug)
        WHERE statistic."userId" = $1
          AND statistic.type = ANY($2)
          AND statistic."completedAt" >= $3
          AND statistic."completedAt" < $4
        GROUP BY selected.slug
      `,
      [userId, types, subDays(new Date(), 30).getTime(), new Date().getTime()]
    );

    const usageMap: Record<string, { count: number }> = {};
    results.forEach((result: { intention: string | null; count: string }) => {
      const intention = result.intention || 'none';
      usageMap[intention] = {
        count: parseInt(result.count, 10),
      };
    });

    return usageMap;
  }

  async getMonthlySubIntentionsUsage(
    userId: string,
    parentSlug: string,
    type?: IntentionType
  ): Promise<Record<string, { count: number }>> {
    const types = this.getTypesForSessionType(type);
    const results = await this.statisticsRepository.query(
      `
        SELECT statistic."subIntentions" ->> $3 AS intention, COUNT(*)::int AS count
        FROM statistics statistic
        WHERE statistic."userId" = $1
          AND statistic.type = ANY($2)
          AND statistic."completedAt" >= $4
          AND statistic."completedAt" < $5
          AND $3 = ANY(COALESCE(statistic.intentions, ARRAY[]::text[]))
          AND statistic."subIntentions" ->> $3 IS NOT NULL
        GROUP BY statistic."subIntentions" ->> $3
      `,
      [
        userId,
        types,
        parentSlug,
        subDays(new Date(), 30).getTime(),
        new Date().getTime(),
      ]
    );

    const usageMap: Record<string, { count: number }> = {};
    results.forEach((result: { intention: string | null; count: string }) => {
      if (!result.intention) return;
      usageMap[result.intention] = {
        count: parseInt(result.count, 10),
      };
    });

    return usageMap;
  }

  async getStatisticsSummary(
    userId: string,
    intention?: string,
    sessionType?: IntentionType,
    subIntention?: string
  ): Promise<StatisticsSummary> {
    const now = new Date();

    const todayStart = startOfDay(now).getTime();
    const yesterdayStart = startOfDay(subDays(now, 1)).getTime();

    const weekStart = startOfDay(subDays(now, 6)).getTime();
    const prevWeekStart = startOfDay(subDays(now, 13)).getTime();
    const prevWeekEnd = startOfDay(subDays(now, 7)).getTime();

    const monthStart = startOfDay(subDays(now, 29)).getTime();
    const prevMonthStart = startOfDay(subDays(now, 59)).getTime();
    const prevMonthEnd = startOfDay(subDays(now, 30)).getTime();

    const yearStart = startOfDay(subDays(now, 364)).getTime();
    const prevYearStart = startOfDay(subDays(now, 729)).getTime();
    const prevYearEnd = startOfDay(subDays(now, 365)).getTime();

    const {
      today: todayStats,
      week: weekStats,
      month: monthStats,
      year: yearStats,
      yesterday: yesterdayStats,
      previousWeek: prevWeekStats,
      previousMonth: prevMonthStats,
      previousYear: prevYearStats,
    } = await this.getPeriodAggregates(
      userId,
      {
        today: { start: todayStart },
        yesterday: { start: yesterdayStart, end: todayStart },
        week: { start: weekStart },
        previousWeek: { start: prevWeekStart, end: prevWeekEnd },
        month: { start: monthStart },
        previousMonth: { start: prevMonthStart, end: prevMonthEnd },
        year: { start: yearStart },
        previousYear: { start: prevYearStart, end: prevYearEnd },
      },
      sessionType,
      intention,
      subIntention
    );

    const [heatmap, firstLog] = await Promise.all([
      this.getHeatmapData(userId, sessionType, intention, subIntention, 365),
      this.getFirstStatisticsLog(userId, sessionType, intention, subIntention),
    ]);
    const firstLogDate = firstLog.date;
    const firstLogTimestamp = firstLog.completedAt;

    const heatmapThresholds = this.calculateHeatmapThresholds(heatmap);
    const hasCompletePreviousPeriod = {
      today: firstLogTimestamp !== null && firstLogTimestamp <= yesterdayStart,
      week: firstLogTimestamp !== null && firstLogTimestamp <= prevWeekStart,
      month: firstLogTimestamp !== null && firstLogTimestamp <= prevMonthStart,
      year: firstLogTimestamp !== null && firstLogTimestamp <= prevYearStart,
    };

    const intentionSlugs = await this.getAvailableIntentionSlugs(
      userId,
      sessionType
    );
    const intentionsMap = await this.getIntentionsMapForSlugs(
      userId,
      intentionSlugs,
      sessionType
    );
    const subIntentionCounts =
      await this.intentionsService.getSubIntentionCountsByParentIds(
        userId,
        Object.values(intentionsMap)
          .map(intentionInfo => intentionInfo?.id)
          .filter(Boolean)
      );
    const availableIntentions = intentionSlugs
      .map(slug => {
        const intentionInfo = intentionsMap[slug];
        return {
          value: slug,
          label: intentionInfo
            ? `${intentionInfo.emoji} ${intentionInfo.title}`
            : slug,
          title: intentionInfo?.title ?? slug,
          emoji: intentionInfo?.emoji ?? '○',
          isArchived: intentionInfo?.isArchived ?? false,
          hasSubIntentions: intentionInfo
            ? (subIntentionCounts[intentionInfo.id] ?? 0) > 0
            : false,
        };
      })
      .sort((a, b) => {
        if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
        const intentionA = intentionsMap[a.value];
        const intentionB = intentionsMap[b.value];
        const usageA = intentionA ? intentionA.usageCount : 0;
        const usageB = intentionB ? intentionB.usageCount : 0;
        return usageB - usageA;
      });

    return {
      today: {
        count: todayStats.count,
        duration: todayStats.duration,
        change: this.calculatePercentageChangeOrNull(
          todayStats.count,
          yesterdayStats.count,
          hasCompletePreviousPeriod.today
        ),
        durationChange: this.calculatePercentageChangeOrNull(
          todayStats.duration,
          yesterdayStats.duration,
          hasCompletePreviousPeriod.today
        ),
      },
      week: {
        count: weekStats.count,
        duration: weekStats.duration,
        change: this.calculatePercentageChangeOrNull(
          weekStats.count,
          prevWeekStats.count,
          hasCompletePreviousPeriod.week
        ),
        durationChange: this.calculatePercentageChangeOrNull(
          weekStats.duration,
          prevWeekStats.duration,
          hasCompletePreviousPeriod.week
        ),
      },
      month: {
        count: monthStats.count,
        duration: monthStats.duration,
        change: this.calculatePercentageChangeOrNull(
          monthStats.count,
          prevMonthStats.count,
          hasCompletePreviousPeriod.month
        ),
        durationChange: this.calculatePercentageChangeOrNull(
          monthStats.duration,
          prevMonthStats.duration,
          hasCompletePreviousPeriod.month
        ),
      },
      year: {
        count: yearStats.count,
        duration: yearStats.duration,
        change: this.calculatePercentageChangeOrNull(
          yearStats.count,
          prevYearStats.count,
          hasCompletePreviousPeriod.year
        ),
        durationChange: this.calculatePercentageChangeOrNull(
          yearStats.duration,
          prevYearStats.duration,
          hasCompletePreviousPeriod.year
        ),
      },
      heatmap,
      heatmapThresholds,
      availableIntentions,
      firstLogDate,
    };
  }

  private async getPeriodAggregates(
    userId: string,
    periods: Record<StatisticsPeriodKey, { start: number; end?: number }>,
    sessionType?: IntentionType,
    intention?: string,
    subIntention?: string
  ): Promise<StatisticsPeriods> {
    const periodEntries = Object.entries(periods) as Array<
      [StatisticsPeriodKey, { start: number; end?: number }]
    >;
    const earliestStart = Math.min(
      ...periodEntries.map(([, period]) => period.start)
    );

    const firstPeriod = periodEntries[0]!;
    const firstCondition =
      firstPeriod[1].end !== undefined
        ? `statistic.completedAt >= :${firstPeriod[0]}Start AND statistic.completedAt < :${firstPeriod[0]}End`
        : `statistic.completedAt >= :${firstPeriod[0]}Start`;
    const queryBuilder = this.statisticsRepository
      .createQueryBuilder('statistic')
      .select(
        `COUNT(*) FILTER (WHERE ${firstCondition})`,
        `${firstPeriod[0]}Count`
      )
      .addSelect(
        `COALESCE(SUM(statistic.duration) FILTER (WHERE ${firstCondition}), 0)`,
        `${firstPeriod[0]}Duration`
      )
      .where('statistic.userId = :userId', { userId });

    this.applyTypeFilter(queryBuilder, sessionType);
    this.applyIntentionFilter(queryBuilder, intention);
    this.applySubIntentionFilter(queryBuilder, intention, subIntention);

    queryBuilder.andWhere('statistic.completedAt >= :periodStart', {
      periodStart: earliestStart,
    });

    queryBuilder.setParameter(`${firstPeriod[0]}Start`, firstPeriod[1].start);
    if (firstPeriod[1].end !== undefined) {
      queryBuilder.setParameter(`${firstPeriod[0]}End`, firstPeriod[1].end);
    }

    periodEntries.slice(1).forEach(([period, range]) => {
      const condition =
        range.end !== undefined
          ? `statistic.completedAt >= :${period}Start AND statistic.completedAt < :${period}End`
          : `statistic.completedAt >= :${period}Start`;
      queryBuilder
        .addSelect(`COUNT(*) FILTER (WHERE ${condition})`, `${period}Count`)
        .addSelect(
          `COALESCE(SUM(statistic.duration) FILTER (WHERE ${condition}), 0)`,
          `${period}Duration`
        )
        .setParameter(`${period}Start`, range.start);
      if (range.end !== undefined) {
        queryBuilder.setParameter(`${period}End`, range.end);
      }
    });

    const raw = await queryBuilder.getRawOne<Record<string, string>>();
    const toPeriod = (period: keyof typeof periods): StatisticsPeriod => ({
      count: Number(raw?.[`${period}Count`] ?? 0),
      duration: Number(raw?.[`${period}Duration`] ?? 0),
    });

    return {
      today: toPeriod('today'),
      yesterday: toPeriod('yesterday'),
      week: toPeriod('week'),
      previousWeek: toPeriod('previousWeek'),
      month: toPeriod('month'),
      previousMonth: toPeriod('previousMonth'),
      year: toPeriod('year'),
      previousYear: toPeriod('previousYear'),
    };
  }

  private applyTypeFilter(
    queryBuilder: SelectQueryBuilder<Statistic>,
    sessionType?: IntentionType
  ): void {
    if (sessionType === TIMER_TYPES.BREAK) {
      queryBuilder.andWhere('statistic.type IN (:...types)', {
        types: [TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK],
      });
      return;
    }

    if (sessionType === TIMER_TYPES.LONG_BREAK) {
      queryBuilder.andWhere('statistic.type = :type', {
        type: TIMER_TYPES.LONG_BREAK,
      });
      return;
    }

    queryBuilder.andWhere('statistic.type = :type', {
      type: TIMER_TYPES.WORK,
    });
  }

  private resolveIntentionType(sessionType?: IntentionType): IntentionType {
    if (sessionType === TIMER_TYPES.LONG_BREAK) return TIMER_TYPES.LONG_BREAK;
    if (sessionType === TIMER_TYPES.BREAK) return TIMER_TYPES.BREAK;
    return TIMER_TYPES.WORK;
  }

  private async getIntentionsMapForSlugs(
    userId: string,
    slugs: string[],
    sessionType?: IntentionType
  ): Promise<Record<string, any>> {
    if (slugs.length === 0) return {};

    if (sessionType === TIMER_TYPES.BREAK) {
      // For break stats, look up both break and longBreak intentions
      const [breakIntentions, longBreakIntentions] = await Promise.all([
        this.intentionsService.getIntentionsBySlug(
          userId,
          slugs,
          TIMER_TYPES.BREAK
        ),
        this.intentionsService.getIntentionsBySlug(
          userId,
          slugs,
          TIMER_TYPES.LONG_BREAK
        ),
      ]);
      return { ...longBreakIntentions, ...breakIntentions };
    }

    const type = this.resolveIntentionType(sessionType);
    return this.intentionsService.getIntentionsBySlug(userId, slugs, type);
  }

  private applyIntentionFilter(
    queryBuilder: SelectQueryBuilder<Statistic>,
    intention?: string
  ): void {
    if (!intention || intention === 'all') {
      return;
    }

    if (intention === 'none') {
      queryBuilder.andWhere(
        '(statistic.intentions IS NULL OR cardinality(statistic.intentions) = 0)'
      );
      return;
    }

    queryBuilder.andWhere(':intention = ANY(statistic.intentions)', {
      intention,
    });
  }

  private applySubIntentionFilter(
    queryBuilder: SelectQueryBuilder<Statistic>,
    intention?: string,
    subIntention?: string
  ): void {
    if (
      !intention ||
      intention === 'all' ||
      intention === 'none' ||
      !subIntention ||
      subIntention === 'all'
    ) {
      return;
    }

    if (subIntention === 'none') {
      queryBuilder.andWhere(
        `(statistic."subIntentions" IS NULL OR statistic."subIntentions" ->> :subIntentionParent IS NULL)`,
        { subIntentionParent: intention }
      );
      return;
    }

    queryBuilder.andWhere(
      `statistic."subIntentions" ->> :subIntentionParent = :subIntention`,
      {
        subIntentionParent: intention,
        subIntention,
      }
    );
  }

  private async getHeatmapData(
    userId: string,
    sessionType: IntentionType | undefined,
    intention: string | undefined,
    subIntention: string | undefined,
    days: number
  ): Promise<{ date: string; count: number; duration: number }[]> {
    const now = new Date();
    const startDate = format(subDays(now, days - 1), 'yyyy-MM-dd');

    const queryBuilder = this.statisticsRepository
      .createQueryBuilder('statistic')
      .select('statistic.date', 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(statistic.duration), 0)', 'duration')
      .where('statistic.userId = :userId', { userId })
      .andWhere('statistic.date >= :startDate', { startDate });

    this.applyTypeFilter(queryBuilder, sessionType);
    this.applyIntentionFilter(queryBuilder, intention);
    this.applySubIntentionFilter(queryBuilder, intention, subIntention);

    const results = await queryBuilder.groupBy('statistic.date').getRawMany();
    const countMap = new Map<string, number>();
    const durationMap = new Map<string, number>();
    results.forEach(result => {
      if (result.date) {
        countMap.set(result.date, parseInt(result.count, 10));
        durationMap.set(result.date, Number(result.duration || 0));
      }
    });

    const heatmapData: { date: string; count: number; duration: number }[] = [];
    for (let i = 0; i < days; i += 1) {
      const date = format(subDays(now, i), 'yyyy-MM-dd');
      heatmapData.push({
        date,
        count: countMap.get(date) || 0,
        duration: durationMap.get(date) || 0,
      });
    }

    return heatmapData;
  }

  private async getAvailableIntentionSlugs(
    userId: string,
    sessionType?: IntentionType
  ): Promise<string[]> {
    const types = this.getTypesForSessionType(sessionType);
    const results = await this.statisticsRepository.query(
      `
        SELECT DISTINCT selected.slug AS intention
        FROM statistics statistic
        CROSS JOIN LATERAL unnest(COALESCE(statistic.intentions, ARRAY[]::text[])) AS selected(slug)
        WHERE statistic."userId" = $1
          AND statistic.type = ANY($2)
      `,
      [userId, types]
    );

    return results
      .map((result: { intention: string | null }) => result.intention)
      .filter((value: string | null) => Boolean(value));
  }

  private calculatePercentageChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  private calculatePercentageChangeOrNull(
    current: number,
    previous: number,
    hasCompletePreviousPeriod: boolean
  ): number | null {
    if (!hasCompletePreviousPeriod) {
      return null;
    }

    return this.calculatePercentageChange(current, previous);
  }

  private calculateHeatmapThresholds(
    heatmapData: { date: string; count: number }[]
  ): { low: number; medium: number; high: number; max: number } {
    //TODO : check if you actually want to filter out zero counts
    const nonZeroCounts = heatmapData
      .map(item => item.count)
      .filter(count => count > 0);

    if (nonZeroCounts.length === 0) {
      // Default values if no data
      return { low: 1, medium: 2, high: 3, max: 4 };
    }

    nonZeroCounts.sort((a, b) => a - b);

    // Calculate quartiles
    const q1Index = Math.floor(nonZeroCounts.length * 0.25);
    const q2Index = Math.floor(nonZeroCounts.length * 0.5);
    const q3Index = Math.floor(nonZeroCounts.length * 0.75);

    const low = nonZeroCounts[0]; // Min non-zero value
    const medium = nonZeroCounts[q1Index] || low;
    const high = nonZeroCounts[q2Index] || medium;
    const max = nonZeroCounts[q3Index] || high;

    return { low, medium, high, max };
  }

  async getWorkTimerLogs(
    userId: string,
    limit: number,
    offset: number
  ): Promise<WorkTimerLog[]> {
    const workTimerLogs = await this.statisticsRepository
      .createQueryBuilder('statistic')
      .where('statistic.userId = :userId', { userId })
      .orderBy('statistic.completedAt', 'DESC')
      .limit(limit)
      .offset(offset)
      .getMany();

    return this.formatWorkTimerLogs(userId, workTimerLogs);
  }

  private async formatWorkTimerLogs(
    userId: string,
    workTimerLogs: Statistic[]
  ): Promise<WorkTimerLog[]> {
    // Fetch intention details for logs that have intentions
    const intentionSlugs = [
      ...new Set(
        workTimerLogs.flatMap(log => this.getStatisticIntentions(log))
      ),
    ];
    const subIntentionSlugs = [
      ...new Set(
        workTimerLogs.flatMap(log =>
          Object.values(this.getStatisticSubIntentions(log))
        )
      ),
    ];

    let intentionsMap: Record<string, any> = {};
    const allSlugs = Array.from(
      new Set([...intentionSlugs, ...subIntentionSlugs])
    );
    if (allSlugs.length > 0) {
      // Get work, break, and longBreak intentions
      const [workIntentions, breakIntentions, longBreakIntentions] =
        await Promise.all([
          this.intentionsService.getIntentionsBySlug(
            userId,
            allSlugs as string[],
            TIMER_TYPES.WORK
          ),
          this.intentionsService.getIntentionsBySlug(
            userId,
            allSlugs as string[],
            TIMER_TYPES.BREAK
          ),
          this.intentionsService.getIntentionsBySlug(
            userId,
            allSlugs as string[],
            TIMER_TYPES.LONG_BREAK
          ),
        ]);
      intentionsMap = {
        ...longBreakIntentions,
        ...breakIntentions,
        ...workIntentions,
      };
    }

    return workTimerLogs.map(log => {
      const subIntentions = this.getStatisticSubIntentions(log);
      const intentions = this.getStatisticIntentions(log)
        .map(slug => {
          const info = intentionsMap[slug];
          const subSlug = subIntentions[slug];
          const subInfo = subSlug ? intentionsMap[subSlug] : undefined;
          return {
            slug,
            title: info?.title,
            emoji: info?.emoji,
            type: info?.type,
            subIntention: subSlug
              ? {
                  slug: subSlug,
                  title: subInfo?.title,
                  emoji: subInfo?.emoji,
                }
              : undefined,
          };
        })
        .filter(intention => intention.slug);

      const primaryIntention = intentions[0];
      return {
        id: log.id,
        type: log.type as TimerTypes,
        intention: primaryIntention?.slug,
        intentionTitle: primaryIntention?.title,
        intentionEmoji: primaryIntention?.emoji,
        intentions,
        subIntentions:
          Object.keys(subIntentions).length > 0 ? subIntentions : undefined,
        duration: log.duration,
        completedAt: Number(log.completedAt),
        date: log.date,
      };
    });
  }

  async updateWorkTimerLog(
    userId: string,
    id: string,
    update: WorkTimerLogUpdateInput
  ): Promise<WorkTimerLog> {
    const statistic = await this.findStatisticById(userId, id);

    if (!statistic) {
      throw new NotFoundException('Work timer log not found');
    }

    const previousIntentions = this.getStatisticIntentions(statistic);
    const previousSubIntentions = this.getStatisticSubIntentions(statistic);
    let shouldSyncUsage = false;
    const hasIntentionsUpdate = update.intentions !== undefined;
    const hasLegacyIntentionUpdate = update.intention !== undefined;
    const hasSubIntentionsUpdate = update.subIntentions !== undefined;

    if (
      hasIntentionsUpdate ||
      hasLegacyIntentionUpdate ||
      hasSubIntentionsUpdate
    ) {
      const nextIntentions = hasIntentionsUpdate
        ? this.normalizeRequestedIntentions(update.intentions ?? [])
        : hasLegacyIntentionUpdate
          ? this.normalizeRequestedIntentions(
              update.intention ? [update.intention] : []
            )
          : previousIntentions;
      const nextSubIntentions = hasSubIntentionsUpdate
        ? this.normalizeRequestedSubIntentions(
            nextIntentions,
            update.subIntentions
          )
        : hasIntentionsUpdate || hasLegacyIntentionUpdate
          ? {}
          : previousSubIntentions;

      await this.validateStatisticIntentionSelection(
        userId,
        statistic.type as IntentionType,
        nextIntentions,
        nextSubIntentions
      );

      shouldSyncUsage =
        !this.areSlugListsEqual(previousIntentions, nextIntentions) ||
        !this.areSubIntentionMapsEqual(
          previousSubIntentions,
          nextSubIntentions
        );

      statistic.intention = this.getPrimaryIntentionSlug(nextIntentions);
      statistic.intentions = nextIntentions.length > 0 ? nextIntentions : null;
      statistic.subIntentions =
        Object.keys(nextSubIntentions).length > 0 ? nextSubIntentions : null;
    }

    statistic.duration = update.duration;
    const updatedStatistic = await this.statisticsRepository.save(statistic);

    if (shouldSyncUsage) {
      await this.syncStatisticIntentionUsage(
        userId,
        previousIntentions,
        this.getStatisticIntentions(updatedStatistic),
        previousSubIntentions,
        this.getStatisticSubIntentions(updatedStatistic)
      );
    }

    const [updatedLog] = await this.formatWorkTimerLogs(userId, [
      updatedStatistic,
    ]);

    return updatedLog;
  }

  async deleteWorkTimerLog(userId: string, id: string): Promise<void> {
    const statistic = await this.findStatisticById(userId, id);

    if (!statistic) {
      throw new NotFoundException('Work timer log not found');
    }

    await this.statisticsRepository.delete({ userId, id });
    await this.syncStatisticIntentionUsage(
      userId,
      this.getStatisticIntentions(statistic),
      [],
      this.getStatisticSubIntentions(statistic),
      {}
    );
  }

  private async getFirstStatisticsLog(
    userId: string,
    sessionType?: IntentionType,
    intention?: string,
    subIntention?: string
  ): Promise<FirstStatisticsLog> {
    const queryBuilder = this.statisticsRepository
      .createQueryBuilder('statistic')
      .select('MIN(statistic.date)', 'minDate')
      .addSelect('MIN(statistic.completedAt)', 'minCompletedAt')
      .where('statistic.userId = :userId', { userId });

    this.applyTypeFilter(queryBuilder, sessionType);
    this.applyIntentionFilter(queryBuilder, intention);
    this.applySubIntentionFilter(queryBuilder, intention, subIntention);

    const result = await queryBuilder.getRawOne<{
      minDate: string | null;
      minCompletedAt: string | number | null;
    }>();

    return {
      date: result?.minDate ?? null,
      completedAt:
        result?.minCompletedAt === undefined || result.minCompletedAt === null
          ? null
          : Number(result.minCompletedAt),
    };
  }

  async getHeatmapForYear(
    userId: string,
    year: number,
    sessionType?: IntentionType,
    intention?: string,
    subIntention?: string
  ): Promise<{
    heatmap: { date: string; count: number; duration: number }[];
    heatmapThresholds: {
      low: number;
      medium: number;
      high: number;
      max: number;
    };
  }> {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const queryBuilder = this.statisticsRepository
      .createQueryBuilder('statistic')
      .select('statistic.date', 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(statistic.duration), 0)', 'duration')
      .where('statistic.userId = :userId', { userId })
      .andWhere('statistic.date >= :startDate', { startDate })
      .andWhere('statistic.date <= :endDate', { endDate });

    this.applyTypeFilter(queryBuilder, sessionType);
    this.applyIntentionFilter(queryBuilder, intention);
    this.applySubIntentionFilter(queryBuilder, intention, subIntention);

    const results = await queryBuilder.groupBy('statistic.date').getRawMany();
    const countMap = new Map<string, number>();
    const durationMap = new Map<string, number>();
    results.forEach(result => {
      if (result.date) {
        countMap.set(result.date, parseInt(result.count, 10));
        durationMap.set(result.date, Number(result.duration || 0));
      }
    });

    // Build full year data from Jan 1 to Dec 31
    const heatmap: { date: string; count: number; duration: number }[] = [];
    const daysInYear =
      year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
    const yearStart = new Date(year, 0, 1);
    for (let i = 0; i < daysInYear; i++) {
      const d = new Date(yearStart);
      d.setDate(d.getDate() + i);
      const dateStr = format(d, 'yyyy-MM-dd');
      if (dateStr > endDate) break;
      heatmap.push({
        date: dateStr,
        count: countMap.get(dateStr) || 0,
        duration: durationMap.get(dateStr) || 0,
      });
    }

    const heatmapThresholds = this.calculateHeatmapThresholds(heatmap);

    return { heatmap, heatmapThresholds };
  }

  async getTopIntentions(
    userId: string,
    period: 'today' | 'week' | 'month' | 'year',
    sessionType?: IntentionType,
    parentIntention?: string,
    metric: 'hours' | 'count' = 'hours'
  ): Promise<TopIntentionStat[]> {
    const now = new Date();
    let startTimestamp: number;

    switch (period) {
      case 'today':
        startTimestamp = startOfDay(now).getTime();
        break;
      case 'week':
        startTimestamp = startOfDay(subDays(now, 6)).getTime();
        break;
      case 'month':
        startTimestamp = startOfDay(subDays(now, 29)).getTime();
        break;
      case 'year':
        startTimestamp = startOfDay(subDays(now, 364)).getTime();
        break;
    }

    if (parentIntention) {
      if (
        await this.hasActiveSubIntentions(userId, parentIntention, sessionType)
      ) {
        return this.getTopSubIntentions(
          userId,
          parentIntention,
          startTimestamp,
          sessionType,
          metric
        );
      }

      return [];
    }

    const types = this.getTypesForSessionType(sessionType);
    const orderBy =
      metric === 'count'
        ? 'ORDER BY count DESC, duration DESC'
        : 'ORDER BY duration DESC, count DESC';
    const results = await this.statisticsRepository.query(
      `
        SELECT
          selected.slug AS intention,
          COUNT(*)::int AS count,
          ROUND(
            SUM(
              statistic.duration::numeric /
              GREATEST(cardinality(COALESCE(statistic.intentions, ARRAY[]::text[])), 1)
            )
          )::bigint AS duration
        FROM statistics statistic
        CROSS JOIN LATERAL unnest(COALESCE(statistic.intentions, ARRAY[]::text[])) AS selected(slug)
        WHERE statistic."userId" = $1
          AND statistic.type = ANY($2)
          AND statistic."completedAt" >= $3
        GROUP BY selected.slug
        ${orderBy}
        LIMIT 10
      `,
      [userId, types, startTimestamp]
    );

    const intentionSlugs = results
      .map(r => r.intention)
      .filter(Boolean) as string[];

    if (intentionSlugs.length === 0) {
      return [];
    }

    const intentionsMap = await this.getIntentionsMapForSlugs(
      userId,
      intentionSlugs,
      sessionType
    );

    return results
      .filter(r => r.intention)
      .map(r => {
        const info = intentionsMap[r.intention];
        return {
          slug: r.intention,
          label: info ? `${info.emoji} ${info.title}` : r.intention,
          count: parseInt(r.count, 10),
          duration: Math.round(Number(r.duration)),
        };
      });
  }

  private async hasActiveSubIntentions(
    userId: string,
    parentIntention: string,
    sessionType?: IntentionType
  ): Promise<boolean> {
    const intentionsMap = await this.getIntentionsMapForSlugs(
      userId,
      [parentIntention],
      sessionType
    );
    const parent = intentionsMap[parentIntention];
    if (!parent) {
      return false;
    }

    const counts =
      await this.intentionsService.getSubIntentionCountsByParentIds(userId, [
        parent.id,
      ]);
    return (counts[parent.id] ?? 0) > 0;
  }

  private async getTopSubIntentions(
    userId: string,
    parentIntention: string,
    startTimestamp: number,
    sessionType?: IntentionType,
    metric: 'hours' | 'count' = 'hours'
  ): Promise<TopIntentionStat[]> {
    const types = this.getTypesForSessionType(sessionType);
    const orderBy =
      metric === 'count'
        ? 'ORDER BY count DESC, duration DESC'
        : 'ORDER BY duration DESC, count DESC';
    const results = await this.statisticsRepository.query(
      `
        SELECT
          COALESCE(statistic."subIntentions" ->> $4, 'none') AS intention,
          COUNT(*)::int AS count,
          ROUND(
            SUM(
              statistic.duration::numeric /
              GREATEST(cardinality(COALESCE(statistic.intentions, ARRAY[]::text[])), 1)
            )
          )::bigint AS duration
        FROM statistics statistic
        WHERE statistic."userId" = $1
          AND statistic.type = ANY($2)
          AND statistic."completedAt" >= $3
          AND $4 = ANY(COALESCE(statistic.intentions, ARRAY[]::text[]))
        GROUP BY COALESCE(statistic."subIntentions" ->> $4, 'none')
        ${orderBy}
        LIMIT 10
      `,
      [userId, types, startTimestamp, parentIntention]
    );

    const subSlugs = results
      .map(r => r.intention)
      .filter((slug): slug is string => Boolean(slug) && slug !== 'none');
    const intentionsMap = await this.getIntentionsMapForSlugs(
      userId,
      subSlugs,
      sessionType
    );

    return results.map(r => {
      const info = r.intention === 'none' ? null : intentionsMap[r.intention];
      return {
        slug: r.intention,
        label: info ? `${info.emoji} ${info.title}` : 'No sub',
        count: parseInt(r.count, 10),
        duration: Math.round(Number(r.duration)),
      };
    });
  }

  async nullifyIntentionInStats(
    userId: string,
    slug: string,
    type: IntentionType
  ): Promise<void> {
    const types =
      type === TIMER_TYPES.BREAK
        ? [TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK]
        : type === TIMER_TYPES.LONG_BREAK
          ? [TIMER_TYPES.LONG_BREAK]
          : [type];
    await this.removeIntentionFromMatchingStats(userId, slug, types, false);
  }

  async deleteStatsByIntention(
    userId: string,
    slug: string,
    type: IntentionType
  ): Promise<void> {
    const types =
      type === TIMER_TYPES.BREAK
        ? [TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK]
        : type === TIMER_TYPES.LONG_BREAK
          ? [TIMER_TYPES.LONG_BREAK]
          : [type];
    await this.removeIntentionFromMatchingStats(userId, slug, types, true);
  }

  async nullifySubIntentionInStats(
    userId: string,
    parentSlug: string,
    subSlug: string,
    type: IntentionType
  ): Promise<void> {
    const types = this.getTypesForSessionType(type);
    await this.statisticsRepository.query(
      `
        UPDATE statistics
        SET "subIntentions" = CASE
          WHEN "subIntentions" - $3 = '{}'::jsonb THEN NULL
          ELSE "subIntentions" - $3
        END
        WHERE "userId" = $1
          AND type = ANY($2)
          AND "subIntentions" ->> $3 = $4
      `,
      [userId, types, parentSlug, subSlug]
    );
  }

  async deleteStatsBySubIntention(
    userId: string,
    parentSlug: string,
    subSlug: string,
    type: IntentionType
  ): Promise<void> {
    const types = this.getTypesForSessionType(type);
    const normalizedIntentionsSql =
      "COALESCE(intentions, CASE WHEN intention IS NOT NULL AND intention != '' THEN ARRAY[intention]::text[] ELSE ARRAY[]::text[] END)";
    const remainingIntentionsSql = `array_remove(${normalizedIntentionsSql}, $3)`;
    const remainingCountSql = `cardinality(${remainingIntentionsSql})`;

    await this.statisticsRepository.query(
      `
        DELETE FROM statistics
        WHERE "userId" = $1
          AND type = ANY($2)
          AND "subIntentions" ->> $3 = $4
          AND ${remainingCountSql} = 0
      `,
      [userId, types, parentSlug, subSlug]
    );

    await this.statisticsRepository.query(
      `
        UPDATE statistics
        SET
          intentions = CASE
            WHEN ${remainingCountSql} = 0 THEN NULL
            ELSE ${remainingIntentionsSql}
          END,
          intention = CASE
            WHEN ${remainingCountSql} = 0 THEN NULL
            ELSE (${remainingIntentionsSql})[1]
          END,
          "subIntentions" = CASE
            WHEN "subIntentions" - $3 = '{}'::jsonb THEN NULL
            ELSE "subIntentions" - $3
          END
        WHERE "userId" = $1
          AND type = ANY($2)
          AND "subIntentions" ->> $3 = $4
          AND ${remainingCountSql} > 0
      `,
      [userId, types, parentSlug, subSlug]
    );
  }

  async reparentIntentionStats(
    userId: string,
    childSlug: string,
    parentSlug: string,
    type: IntentionType
  ): Promise<void> {
    const types = this.getTypesForSessionType(type);
    const normalizedIntentionsSql =
      "COALESCE(intentions, CASE WHEN intention IS NOT NULL AND intention != '' THEN ARRAY[intention]::text[] ELSE ARRAY[]::text[] END)";
    const nextIntentionsSql = `
      ARRAY(
        SELECT DISTINCT selected.slug
        FROM unnest(array_append(array_remove(${normalizedIntentionsSql}, $3), $4)) AS selected(slug)
        WHERE selected.slug IS NOT NULL AND selected.slug <> ''
      )
    `;
    const containsChildSql = `array_position(${normalizedIntentionsSql}, $3) IS NOT NULL`;

    await this.statisticsRepository.query(
      `
        UPDATE statistics
        SET
          intentions = ${nextIntentionsSql},
          intention = (${nextIntentionsSql})[1],
          "subIntentions" = COALESCE("subIntentions", '{}'::jsonb) || jsonb_build_object($4, $3)
        WHERE "userId" = $1
          AND type = ANY($2)
          AND ${containsChildSql}
      `,
      [userId, types, childSlug, parentSlug]
    );
  }

  async updateIntentionParentStats(
    userId: string,
    childSlug: string,
    type: IntentionType,
    previousParentSlug: string | null,
    nextParentSlug: string | null
  ): Promise<void> {
    if (previousParentSlug === nextParentSlug) {
      return;
    }

    if (!previousParentSlug && nextParentSlug) {
      await this.reparentIntentionStats(
        userId,
        childSlug,
        nextParentSlug,
        type
      );
      return;
    }

    if (previousParentSlug && nextParentSlug) {
      await this.moveSubIntentionStatsToParent(
        userId,
        childSlug,
        previousParentSlug,
        nextParentSlug,
        type
      );
      return;
    }

    if (previousParentSlug && !nextParentSlug) {
      await this.promoteSubIntentionStats(
        userId,
        childSlug,
        previousParentSlug,
        type
      );
    }
  }

  private async moveSubIntentionStatsToParent(
    userId: string,
    childSlug: string,
    previousParentSlug: string,
    nextParentSlug: string,
    type: IntentionType
  ): Promise<void> {
    const types = this.getTypesForSessionType(type);
    const normalizedIntentionsSql =
      "COALESCE(intentions, CASE WHEN intention IS NOT NULL AND intention != '' THEN ARRAY[intention]::text[] ELSE ARRAY[]::text[] END)";
    const nextIntentionsSql = `
      ARRAY(
        SELECT DISTINCT selected.slug
        FROM unnest(array_append(array_remove(${normalizedIntentionsSql}, $3), $4)) AS selected(slug)
        WHERE selected.slug IS NOT NULL AND selected.slug <> ''
      )
    `;

    await this.statisticsRepository.query(
      `
        UPDATE statistics
        SET
          intentions = ${nextIntentionsSql},
          intention = (${nextIntentionsSql})[1],
          "subIntentions" = (COALESCE("subIntentions", '{}'::jsonb) - $3) || jsonb_build_object($4, $5)
        WHERE "userId" = $1
          AND type = ANY($2)
          AND "subIntentions" ->> $3 = $5
      `,
      [userId, types, previousParentSlug, nextParentSlug, childSlug]
    );
  }

  private async promoteSubIntentionStats(
    userId: string,
    childSlug: string,
    previousParentSlug: string,
    type: IntentionType
  ): Promise<void> {
    const types = this.getTypesForSessionType(type);
    const normalizedIntentionsSql =
      "COALESCE(intentions, CASE WHEN intention IS NOT NULL AND intention != '' THEN ARRAY[intention]::text[] ELSE ARRAY[]::text[] END)";
    const nextIntentionsSql = `
      ARRAY(
        SELECT DISTINCT selected.slug
        FROM unnest(array_append(array_remove(${normalizedIntentionsSql}, $3), $4)) AS selected(slug)
        WHERE selected.slug IS NOT NULL AND selected.slug <> ''
      )
    `;

    await this.statisticsRepository.query(
      `
        UPDATE statistics
        SET
          intentions = ${nextIntentionsSql},
          intention = (${nextIntentionsSql})[1],
          "subIntentions" = CASE
            WHEN "subIntentions" - $3 = '{}'::jsonb THEN NULL
            ELSE "subIntentions" - $3
          END
        WHERE "userId" = $1
          AND type = ANY($2)
          AND "subIntentions" ->> $3 = $4
      `,
      [userId, types, previousParentSlug, childSlug]
    );
  }

  private async removeIntentionFromMatchingStats(
    userId: string,
    slug: string,
    types: IntentionType[],
    deleteEmptyRows: boolean
  ): Promise<void> {
    const normalizedIntentionsSql =
      "COALESCE(intentions, CASE WHEN intention IS NOT NULL AND intention != '' THEN ARRAY[intention]::text[] ELSE ARRAY[]::text[] END)";
    const remainingIntentionsSql = `array_remove(${normalizedIntentionsSql}, $3)`;
    const remainingCountSql = `cardinality(${remainingIntentionsSql})`;
    const containsSlugSql = `array_position(${normalizedIntentionsSql}, $3) IS NOT NULL`;

    if (deleteEmptyRows) {
      await this.statisticsRepository.query(
        `
          DELETE FROM statistics
          WHERE "userId" = $1
            AND type = ANY($2)
            AND ${containsSlugSql}
            AND ${remainingCountSql} = 0
        `,
        [userId, types, slug]
      );
    }

    const keepRowsCondition = deleteEmptyRows
      ? `AND ${remainingCountSql} > 0`
      : '';

    await this.statisticsRepository.query(
      `
        UPDATE statistics
        SET
          intentions = CASE
            WHEN ${remainingCountSql} = 0 THEN NULL
            ELSE ${remainingIntentionsSql}
          END,
          intention = CASE
            WHEN ${remainingCountSql} = 0 THEN NULL
            ELSE (${remainingIntentionsSql})[1]
          END,
          "subIntentions" = CASE
            WHEN "subIntentions" IS NULL THEN NULL
            WHEN "subIntentions" - $3 = '{}'::jsonb THEN NULL
            ELSE "subIntentions" - $3
          END
        WHERE "userId" = $1
          AND type = ANY($2)
          AND ${containsSlugSql}
          ${keepRowsCondition}
      `,
      [userId, types, slug]
    );
  }
}
