import { Subject } from 'rxjs';
import { TASK_PRIORITIES, TASK_STATUSES } from '@pomi/shared';
import { describe, expect, it, vi } from 'vitest';
import { TaskNotificationService } from '../../src/tasks/task-notification.service';

const preferences = {
  tasksExtension: true,
  notifications: true,
  pushNotifications: false,
  language: 'en',
  timeZone: 'UTC',
  taskReminderPriorities: [TASK_PRIORITIES.HIGH, TASK_PRIORITIES.URGENT],
  taskBeforeDueReminderMinutes: 15,
  taskUrgentReminderRepeatEnabled: true,
  taskUrgentReminderRepeatIntervalMinutes: 30,
};

const task = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  title: 'Send report',
  status: TASK_STATUSES.ACTIVE,
  itemKind: 'task',
  dueDate: '2026-09-10',
  dueTime: '09:00',
  priority: TASK_PRIORITIES.HIGH,
  lastReminderKey: null,
  lastUrgentReminderAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
};

function createService(repository: Record<string, unknown>) {
  const preferenceUpdates = new Subject<{ userId: string }>();
  const taskUpdates = new Subject<{ userId: string }>();
  return new TaskNotificationService(
    repository as never,
    {
      getPreferences: async () => preferences,
      onPreferencesUpdate: preferenceUpdates,
    } as never,
    { sendTaskNotification: vi.fn() } as never,
    { onClientNotification: new Subject() } as never,
    { onTasksUpdate: taskUpdates } as never
  );
}

describe('durable Task reminder schedule', () => {
  it('materializes the user deadline instead of polling future Tasks', async () => {
    const update = vi.fn();
    const service = createService({
      find: async () => [task],
      update,
    });

    await service.rebuildUserSchedule(task.userId);

    expect(update).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        nextReminderAt: new Date('2026-09-10T08:45:00.000Z'),
        reminderClaimToken: null,
        reminderClaimedUntil: null,
      })
    );
  });

  it('claims only due rows with replica-safe skip-locked leasing', async () => {
    const row = { ...task };
    const update = vi.fn(async (criteria, values) => {
      const id = typeof criteria === 'string' ? criteria : criteria.id;
      if (id === row.id) Object.assign(row, values);
    });
    const query = vi.fn(async () => [{ id: row.id }]);
    const service = createService({
      query,
      findBy: async () => [row],
      findOneBy: async () => row,
      update,
    });

    await service.scanDueSchedules(new Date('2026-09-10T09:00:00.000Z'));

    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(row.lastReminderKey).toBe(`${row.id}:2026-09-10:09:00`);
    expect(row.nextReminderAt).toBeNull();
    expect(row.reminderClaimToken).toBeNull();
  });
});
