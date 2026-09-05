import { describe, expect, it, vi } from 'vitest';
import { WatchService } from '../../src/watch/watch.service';

function createService() {
  return new WatchService(
    { getTimerByUserId: vi.fn().mockResolvedValue(null) } as never,
    { getWatchTaskSnapshot: vi.fn() } as never,
    { getStatus: vi.fn().mockResolvedValue({}) } as never,
    { getPreferences: vi.fn() } as never,
    { getIntentionsBySlug: vi.fn() } as never
  );
}

describe('WatchService', () => {
  it('uses the next local midnight for date-only overdue Tasks across DST', () => {
    const service = createService();
    const isOverdue = service['isTaskOverdueAt'].bind(service);

    expect(
      isOverdue(
        { dueDate: '2026-03-08', dueTime: null },
        new Date('2026-03-09T03:59:59.999Z'),
        'America/New_York'
      )
    ).toBe(false);
    expect(
      isOverdue(
        { dueDate: '2026-03-08', dueTime: null },
        new Date('2026-03-09T04:00:00.001Z'),
        'America/New_York'
      )
    ).toBe(true);
  });

  it('normalizes an invalid persisted time zone before the bounded query', async () => {
    const taskSnapshot = {
      tasks: [],
      totalActiveTasks: 0,
      totalVisibleTasks: 0,
    };
    const tasksService = {
      getWatchTaskSnapshot: vi.fn().mockResolvedValue(taskSnapshot),
    };
    const service = new WatchService(
      { getTimerByUserId: vi.fn().mockResolvedValue(null) } as never,
      tasksService as never,
      {
        getStatus: vi.fn().mockResolvedValue({
          assistantEnabled: false,
          speechCaptureEnabled: false,
          aiTaskCaptureEnabled: false,
          assistantRecordingMaxMinutes: 5,
          usageBudgetPeriod: 'month',
          usageBudgetCapUsd: null,
          usageBudgetUsedUsd: 0,
        }),
      } as never,
      {
        getPreferences: vi.fn().mockResolvedValue({
          tasksExtension: true,
          timeZone: 'Invalid/TimeZone',
          language: 'en',
          intentionExtension: false,
        }),
      } as never,
      { getIntentionsBySlug: vi.fn() } as never
    );

    await service.getStatus('user-1');

    expect(tasksService.getWatchTaskSnapshot).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ timeZone: 'UTC' })
    );
  });
});
