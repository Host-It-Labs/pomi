import { TASK_PRIORITIES, TASK_STATUSES } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import { TaskNotificationService } from '../../src/tasks/task-notification.service';

type TaskRecord = Record<string, any>;

function createPreferences(overrides: Record<string, unknown> = {}) {
  return {
    tasksExtension: true,
    notifications: true,
    pushNotifications: true,
    timeZone: 'UTC',
    taskReminderPriorities: [TASK_PRIORITIES.HIGH, TASK_PRIORITIES.URGENT],
    taskBeforeDueReminderMinutes: 0,
    taskUrgentReminderRepeatEnabled: true,
    taskUrgentReminderRepeatIntervalMinutes: 30,
    ...overrides,
  };
}

function createTask(overrides: Record<string, unknown> = {}): TaskRecord {
  return {
    id: 'task-1',
    userId: 'user-1',
    title: 'Pay invoice',
    status: TASK_STATUSES.ACTIVE,
    itemKind: 'task',
    dueDate: '2026-06-17',
    dueTime: '09:00',
    priority: TASK_PRIORITIES.URGENT,
    lastReminderKey: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createService(tasks: TaskRecord[], preferences = createPreferences()) {
  const sent: TaskRecord[] = [];
  const clientEvents: TaskRecord[] = [];
  const query = {
    where: () => query,
    andWhere: () => query,
    getMany: async () =>
      tasks.filter(
        task =>
          task.status === TASK_STATUSES.ACTIVE &&
          ['task', 'followUp'].includes(task.itemKind) &&
          task.dueDate
      ),
  };
  const service = new TaskNotificationService(
    {
      createQueryBuilder: () => query,
      update: async (id: string, updates: TaskRecord) => {
        const task = tasks.find(item => item.id === id);
        if (task) Object.assign(task, updates);
      },
    } as never,
    { getPreferences: async () => preferences } as never,
    {
      sendTaskNotification: async (
        title: string,
        message: string,
        userId: string,
        priority: number,
        tags: string[]
      ) => sent.push({ title, message, userId, priority, tags }),
    } as never,
    {
      onClientNotification: {
        next: (event: TaskRecord) => clientEvents.push(event),
      },
    } as never
  );
  return { service, sent, clientEvents, preferences };
}

describe('TaskNotificationService', () => {
  it('sends reminders for contextual follow-ups', async () => {
    const { service, sent } = createService([
      createTask({ itemKind: 'followUp', priority: TASK_PRIORITIES.HIGH }),
    ]);

    await service.scanDueTasks(new Date('2026-06-17T09:00:00.000Z'));

    expect(sent).toHaveLength(1);
  });

  it('sends one normal reminder when a selected Task priority becomes due', async () => {
    const tasks = [createTask({ priority: TASK_PRIORITIES.HIGH })];
    const first = createService(tasks);
    await first.service.scanDueTasks(new Date('2026-06-17T09:00:00.000Z'));
    const restarted = createService(tasks);
    await restarted.service.scanDueTasks(new Date('2026-06-17T09:05:00.000Z'));

    expect(first.sent).toEqual([
      expect.objectContaining({
        title: 'Task due',
        tags: ['clipboard', 'taskReminder'],
      }),
    ]);
    expect(first.clientEvents.map(item => item.type)).toEqual(['taskReminder']);
    expect(restarted.sent).toHaveLength(0);
    expect(restarted.clientEvents).toHaveLength(0);
    expect(tasks[0].lastReminderKey).toBe('task-1:2026-06-17:09:00');
  });

  it('uses the account language for task reminders', async () => {
    const fixture = createService(
      [createTask({ priority: TASK_PRIORITIES.HIGH })],
      createPreferences({ language: 'fr' })
    );

    await fixture.service.scanDueTasks(new Date('2026-06-17T09:00:00.000Z'));

    expect(fixture.sent[0]).toMatchObject({ title: 'Tâche à échéance' });
    expect(fixture.clientEvents[0]).toMatchObject({
      notificationTitle: 'Tâche à échéance',
    });
  });

  it('allows an empty priority selection to disable Task reminders', async () => {
    const fixture = createService(
      [createTask()],
      createPreferences({ taskReminderPriorities: [] })
    );

    await fixture.service.scanDueTasks(new Date('2026-06-17T10:00:00.000Z'));

    expect(fixture.sent).toHaveLength(0);
    expect(fixture.clientEvents).toHaveLength(0);
  });

  it('applies live Task priority changes on the next scan', async () => {
    const task = createTask({ priority: TASK_PRIORITIES.NORMAL });
    const fixture = createService([task]);

    await fixture.service.scanDueTasks(new Date('2026-06-17T09:00:00.000Z'));
    task.priority = TASK_PRIORITIES.HIGH;
    await fixture.service.scanDueTasks(new Date('2026-06-17T09:01:00.000Z'));

    expect(fixture.clientEvents).toHaveLength(1);
    expect(fixture.clientEvents[0].task.priority).toBe(TASK_PRIORITIES.HIGH);
  });

  it('defaults date-only reminders to 10:00 in the user time zone', async () => {
    const fixture = createService([createTask({ dueTime: null })]);
    await fixture.service.scanDueTasks(new Date('2026-06-17T09:59:00.000Z'));
    await fixture.service.scanDueTasks(new Date('2026-06-17T10:00:00.000Z'));
    expect(fixture.sent).toHaveLength(1);
  });

  it('uses the user time zone for due instants', async () => {
    const fixture = createService(
      [createTask({ dueTime: '10:00' })],
      createPreferences({ timeZone: 'America/New_York' })
    );
    await fixture.service.scanDueTasks(new Date('2026-06-17T13:59:00.000Z'));
    await fixture.service.scanDueTasks(new Date('2026-06-17T14:00:00.000Z'));
    expect(fixture.sent).toHaveLength(1);
  });

  it('repeats the normal urgent reminder path at the selected interval', async () => {
    const fixture = createService([createTask()]);
    for (const time of ['09:00', '09:29', '09:30', '09:59', '10:00']) {
      await fixture.service.scanDueTasks(
        new Date(`2026-06-17T${time}:00.000Z`)
      );
    }

    expect(fixture.sent).toHaveLength(3);
    expect(fixture.sent.map(item => item.title)).toEqual([
      'Task due',
      'Task due',
      'Task due',
    ]);
    expect(fixture.clientEvents.map(item => item.type)).toEqual([
      'taskReminder',
      'taskReminder',
      'taskReminder',
    ]);
  });

  it.each([
    [
      'completed',
      (task: TaskRecord) => (task.status = TASK_STATUSES.COMPLETED),
    ],
    ['archived', (task: TaskRecord) => (task.status = TASK_STATUSES.ARCHIVED)],
    ['without a due date', (task: TaskRecord) => (task.dueDate = null)],
    [
      'no longer urgent',
      (task: TaskRecord) => (task.priority = TASK_PRIORITIES.HIGH),
    ],
  ])('stops repeating when the Task is %s', async (_label, stopTask) => {
    const task = createTask();
    const fixture = createService([task]);
    await fixture.service.scanDueTasks(new Date('2026-06-17T09:00:00.000Z'));
    stopTask(task);
    await fixture.service.scanDueTasks(new Date('2026-06-17T09:30:00.000Z'));

    expect(fixture.clientEvents).toHaveLength(1);
  });

  it.each([
    ['notifications are disabled', { notifications: false }],
    ['Tasks are disabled', { tasksExtension: false }],
    [
      'urgent priority notifications are disabled',
      { taskReminderPriorities: [TASK_PRIORITIES.HIGH] },
    ],
    ['repetition is disabled', { taskUrgentReminderRepeatEnabled: false }],
  ])('does not repeat when %s', async (_label, preferenceUpdate) => {
    const fixture = createService([createTask()]);
    await fixture.service.scanDueTasks(new Date('2026-06-17T09:00:00.000Z'));
    Object.assign(fixture.preferences, preferenceUpdate);
    await fixture.service.scanDueTasks(new Date('2026-06-17T09:30:00.000Z'));

    expect(fixture.clientEvents).toHaveLength(1);
  });

  it('keeps the ordinary client reminder path when push is disabled', async () => {
    const fixture = createService(
      [createTask()],
      createPreferences({ pushNotifications: false })
    );
    await fixture.service.scanDueTasks(new Date('2026-06-17T09:00:00.000Z'));
    await fixture.service.scanDueTasks(new Date('2026-06-17T09:30:00.000Z'));

    expect(fixture.sent).toHaveLength(0);
    expect(fixture.clientEvents.map(item => item.type)).toEqual([
      'taskReminder',
      'taskReminder',
    ]);
  });
});
