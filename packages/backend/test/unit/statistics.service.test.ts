import { describe, expect, it, vi } from 'vitest';
import type { IntentionType } from '@pomi/shared';

import { StatisticsService } from '../../src/statistics/statistics.service';

type StatisticRecord = {
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

function createService(record: StatisticRecord | null) {
  const repository = {
    create: vi.fn(<T>(value: T) => value),
    findOne: vi.fn(async () => record),
    save: vi.fn(async <T>(value: T) => value),
    delete: vi.fn(async () => ({ affected: 1 })),
  };
  const intentions = {
    validateSubIntentionSelection: vi.fn(async () => undefined),
    incrementIntentionsUsage: vi.fn(async () => undefined),
    decrementIntentionsUsage: vi.fn(async () => undefined),
    getIntentionsBySlug: vi.fn(async () => ({})),
  };

  return {
    repository,
    intentions,
    service: new StatisticsService(repository as never, intentions as never),
  };
}

describe('StatisticsService work-timer log rules', () => {
  it('records every selected intention once and retains only valid parent/sub-intention links', async () => {
    const { repository, service } = createService(null);

    await service.recordCompletedTimer('user-1', {
      id: 'timer-1',
      type: 'work',
      duration: 25 * 60_000,
      remainingTime: 5 * 60_000,
      intention: 'legacy',
      intentionSlugs: ['parent', 'parent', '', 'other'],
      subIntentions: { parent: 'child', '': 'ignored', other: '' },
    } as never);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'timer-1',
        userId: 'user-1',
        type: 'work',
        duration: 20 * 60_000,
        intention: 'parent',
        intentions: ['parent', 'other'],
        subIntentions: { parent: 'child' },
      })
    );
  });

  it('normalizes edited selections, validates their state type, and updates usage only for changed slugs', async () => {
    const record: StatisticRecord = {
      id: 'log-1',
      userId: 'user-1',
      type: 'work',
      date: '2026-07-26',
      duration: 300,
      completedAt: 1,
      intention: 'old-parent',
      intentions: ['old-parent', 'shared'],
      subIntentions: { 'old-parent': 'old-child' },
    };
    const { repository, intentions, service } = createService(record);

    const result = await service.updateWorkTimerLog('user-1', 'log-1', {
      duration: 420,
      intentions: [' shared ', 'new-parent', 'new-parent', ''],
      subIntentions: {
        ' new-parent ': ' new-child ',
        unrelated: 'must-not-survive',
      },
    });

    expect(intentions.validateSubIntentionSelection).toHaveBeenCalledWith(
      'user-1',
      ['shared', 'new-parent'],
      { 'new-parent': 'new-child' },
      ['work']
    );
    expect(intentions.decrementIntentionsUsage).toHaveBeenCalledWith('user-1', [
      'old-parent',
    ]);
    expect(intentions.decrementIntentionsUsage).toHaveBeenCalledWith('user-1', [
      'old-child',
    ]);
    expect(intentions.incrementIntentionsUsage).toHaveBeenCalledWith('user-1', [
      'new-parent',
    ]);
    expect(intentions.incrementIntentionsUsage).toHaveBeenCalledWith('user-1', [
      'new-child',
    ]);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        duration: 420,
        intention: 'shared',
        intentions: ['shared', 'new-parent'],
        subIntentions: { 'new-parent': 'new-child' },
      })
    );
    expect(result).toMatchObject({
      id: 'log-1',
      intention: 'shared',
      duration: 420,
      subIntentions: { 'new-parent': 'new-child' },
    });
  });

  it('does not alter intention usage when only a logged duration changes', async () => {
    const record: StatisticRecord = {
      id: 'log-1',
      userId: 'user-1',
      type: 'work',
      date: '2026-07-26',
      duration: 300,
      completedAt: 1,
      intention: 'parent',
      intentions: ['parent'],
      subIntentions: { parent: 'child' },
    };
    const { intentions, service } = createService(record);

    await service.updateWorkTimerLog('user-1', 'log-1', { duration: 600 });

    expect(intentions.validateSubIntentionSelection).not.toHaveBeenCalled();
    expect(intentions.incrementIntentionsUsage).not.toHaveBeenCalled();
    expect(intentions.decrementIntentionsUsage).not.toHaveBeenCalled();
  });
});

describe('StatisticsService period aggregates', () => {
  it('returns daily intention totals and maps from one query', async () => {
    const query = vi.fn(async () => [
      { kind: 'parent', intention: 'focus', count: '2' },
      { kind: 'sub', intention: 'writing', count: '1' },
    ]);
    const service = new StatisticsService({ query } as never, {} as never);

    await expect(
      service.getTodayIntentionsCounts('user-1', 'work', 0, 100)
    ).resolves.toEqual({
      count: 3,
      bySlug: { focus: 2 },
      subBySlug: { writing: 1 },
    });

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain('UNION ALL');
  });

  it('returns all comparison periods from one filtered query', async () => {
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      setParameter: vi.fn().mockReturnThis(),
      getRawOne: vi.fn(async () => ({
        todayCount: '2',
        todayDuration: '120',
        yesterdayCount: '1',
        yesterdayDuration: '60',
        weekCount: '3',
        weekDuration: '180',
        previousWeekCount: '4',
        previousWeekDuration: '240',
        monthCount: '5',
        monthDuration: '300',
        previousMonthCount: '6',
        previousMonthDuration: '360',
        yearCount: '7',
        yearDuration: '420',
        previousYearCount: '8',
        previousYearDuration: '480',
      })),
    };
    const repository = {
      createQueryBuilder: vi.fn(() => queryBuilder),
    };
    const intentions = {
      validateSubIntentionSelection: vi.fn(),
      incrementIntentionsUsage: vi.fn(),
      decrementIntentionsUsage: vi.fn(),
      getIntentionsBySlug: vi.fn(),
    };
    const service = new StatisticsService(
      repository as never,
      intentions as never
    );

    const serviceWithPeriodAggregates = service as unknown as {
      getPeriodAggregates: (
        userId: string,
        periods: Record<string, { start: number; end?: number }>,
        sessionType?: IntentionType,
        intention?: string,
        subIntention?: string
      ) => Promise<Record<string, { count: number; duration: number }>>;
    };
    const result = await serviceWithPeriodAggregates.getPeriodAggregates(
      'user-1',
      {
        today: { start: 80 },
        yesterday: { start: 70, end: 80 },
        week: { start: 40 },
        previousWeek: { start: 20, end: 30 },
        month: { start: 30 },
        previousMonth: { start: 10, end: 20 },
        year: { start: 50 },
        previousYear: { start: 0, end: 10 },
      },
      undefined,
      undefined,
      undefined
    );

    expect(repository.createQueryBuilder).toHaveBeenCalledOnce();
    expect(queryBuilder.getRawOne).toHaveBeenCalledOnce();
    expect(queryBuilder.select).toHaveBeenCalledOnce();
    expect(queryBuilder.addSelect).toHaveBeenCalledTimes(15);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'statistic.completedAt >= :periodStart',
      { periodStart: 0 }
    );
    expect(result).toEqual({
      today: { count: 2, duration: 120 },
      yesterday: { count: 1, duration: 60 },
      week: { count: 3, duration: 180 },
      previousWeek: { count: 4, duration: 240 },
      month: { count: 5, duration: 300 },
      previousMonth: { count: 6, duration: 360 },
      year: { count: 7, duration: 420 },
      previousYear: { count: 8, duration: 480 },
    });
  });
});

describe('StatisticsService first statistics log', () => {
  it('uses the shared first-log result for summary values and comparison flags', async () => {
    const periods = {
      today: { count: 2, duration: 120 },
      yesterday: { count: 1, duration: 60 },
      week: { count: 2, duration: 120 },
      previousWeek: { count: 1, duration: 60 },
      month: { count: 2, duration: 120 },
      previousMonth: { count: 1, duration: 60 },
      year: { count: 2, duration: 120 },
      previousYear: { count: 1, duration: 60 },
    };
    const service = new StatisticsService(
      {} as never,
      {
        getSubIntentionCountsByParentIds: vi.fn(async () => ({})),
      } as never
    );
    const dependencies = service as unknown as {
      getPeriodAggregates: () => Promise<typeof periods>;
      getHeatmapData: () => Promise<
        { date: string; count: number; duration: number }[]
      >;
      getFirstStatisticsLog: () => Promise<{
        date: string | null;
        completedAt: number | null;
      }>;
      getAvailableIntentionSlugs: () => Promise<string[]>;
    };
    vi.spyOn(dependencies, 'getPeriodAggregates').mockResolvedValue(periods);
    vi.spyOn(dependencies, 'getHeatmapData').mockResolvedValue([]);
    const firstLog = vi
      .spyOn(dependencies, 'getFirstStatisticsLog')
      .mockResolvedValue({ date: '1970-01-01', completedAt: 0 });
    vi.spyOn(dependencies, 'getAvailableIntentionSlugs').mockResolvedValue([]);

    await expect(
      service.getStatisticsSummary('user-1', 'focus', 'work', 'writing')
    ).resolves.toMatchObject({
      firstLogDate: '1970-01-01',
      today: { change: 100, durationChange: 100 },
      week: { change: 100, durationChange: 100 },
      month: { change: 100, durationChange: 100 },
      year: { change: 100, durationChange: 100 },
    });
    expect(firstLog).toHaveBeenCalledOnce();
    expect(firstLog).toHaveBeenCalledWith('user-1', 'work', 'focus', 'writing');
  });

  it('returns the first date and timestamp from one filtered query', async () => {
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getRawOne: vi.fn(async () => ({
        minDate: '2026-01-02',
        minCompletedAt: '1767312000000',
      })),
    };
    const repository = {
      createQueryBuilder: vi.fn(() => queryBuilder),
    };
    const service = new StatisticsService(repository as never, {} as never);
    const serviceWithFirstLog = service as unknown as {
      getFirstStatisticsLog: (
        userId: string,
        sessionType?: IntentionType,
        intention?: string,
        subIntention?: string
      ) => Promise<{ date: string | null; completedAt: number | null }>;
    };

    await expect(
      serviceWithFirstLog.getFirstStatisticsLog(
        'user-1',
        'work',
        'focus',
        'writing'
      )
    ).resolves.toEqual({
      date: '2026-01-02',
      completedAt: 1_767_312_000_000,
    });

    expect(repository.createQueryBuilder).toHaveBeenCalledOnce();
    expect(queryBuilder.select).toHaveBeenCalledWith(
      'MIN(statistic.date)',
      'minDate'
    );
    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      'MIN(statistic.completedAt)',
      'minCompletedAt'
    );
    expect(queryBuilder.getRawOne).toHaveBeenCalledOnce();
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      ':intention = ANY(statistic.intentions)',
      { intention: 'focus' }
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      `statistic."subIntentions" ->> :subIntentionParent = :subIntention`,
      { subIntentionParent: 'focus', subIntention: 'writing' }
    );
  });

  it('preserves missing-history nulls', async () => {
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getRawOne: vi.fn(async () => ({
        minDate: null,
        minCompletedAt: null,
      })),
    };
    const service = new StatisticsService(
      { createQueryBuilder: vi.fn(() => queryBuilder) } as never,
      {} as never
    );
    const serviceWithFirstLog = service as unknown as {
      getFirstStatisticsLog: (
        userId: string
      ) => Promise<{ date: string | null; completedAt: number | null }>;
    };

    await expect(
      serviceWithFirstLog.getFirstStatisticsLog('user-without-history')
    ).resolves.toEqual({ date: null, completedAt: null });
  });
});
