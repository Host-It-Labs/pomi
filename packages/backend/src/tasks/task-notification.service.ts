import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import {
  CLIENT_NOTIFICATION_TYPES,
  ClientNotificationType,
  NOTIFICATION_GROUPS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TIMER_STATUSES,
  TIMER_TYPES,
  Timer,
} from '@pomi/shared';
import { In, Repository } from 'typeorm';
import type { Subscription } from 'rxjs';
import { PomiLogger } from '../logging/pomi-logger';
import { translateNotification } from '../i18n/notification-localization';
import { NotificationService } from '../notifications/notifications.service';
import { PreferencesService } from '../preferences/preferences.service';
import { RealtimeEvents } from '../realtime/realtime-events';
import { TimerService } from '../timer/timer.service';
import { TaskEntity } from './tasks.entity';

const TASK_REMINDER_POLL_INTERVAL_MS = 1000;
const TASK_REMINDER_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
const TASK_REMINDER_CLAIM_LEASE_MS = 30 * 1000;
const TASK_REMINDER_CLAIM_BATCH_SIZE = 25;
const DEFAULT_DUE_TIME = '10:00';

@Injectable()
export class TaskNotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PomiLogger(TaskNotificationService.name);
  private pollInterval: NodeJS.Timeout | null = null;
  private reconcileInterval: NodeJS.Timeout | null = null;
  private readonly subscriptions: Subscription[] = [];
  private readonly scheduleRebuilds = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(TaskEntity)
    private tasksRepository: Repository<TaskEntity>,
    private preferencesService: PreferencesService,
    private notificationService: NotificationService,
    private timerService: TimerService,
    private realtimeEvents: RealtimeEvents
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.realtimeEvents.onTasksUpdate.subscribe(({ userId }) => {
        void this.rebuildUserSchedule(userId);
      }),
      this.preferencesService.onPreferencesUpdate.subscribe(({ userId }) => {
        void this.rebuildUserSchedule(userId);
      })
    );
    this.pollInterval = setInterval(
      () => void this.scanDueSchedules(),
      TASK_REMINDER_POLL_INTERVAL_MS
    );
    this.reconcileInterval = setInterval(
      () => void this.rebuildAllSchedules(),
      TASK_REMINDER_RECONCILE_INTERVAL_MS
    );
    void this.rebuildAllSchedules().then(() => this.scanDueSchedules());
  }

  onModuleDestroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.reconcileInterval) clearInterval(this.reconcileInterval);
    this.pollInterval = null;
    this.reconcileInterval = null;
    this.subscriptions
      .splice(0)
      .forEach(subscription => subscription.unsubscribe());
  }

  async scanDueSchedules(now = new Date()): Promise<void> {
    const claimToken = randomUUID();
    const claimedUntil = new Date(now.getTime() + TASK_REMINDER_CLAIM_LEASE_MS);
    let claimedRows: Array<{ id: string }>;
    try {
      claimedRows = await this.tasksRepository.query(
        `
          WITH due AS (
            SELECT "id"
            FROM "tasks"
            WHERE "status" = $1
              AND "itemKind" IN ('task', 'followUp')
              AND "nextReminderAt" <= $2
              AND (
                "reminderClaimedUntil" IS NULL
                OR "reminderClaimedUntil" <= $2
              )
            ORDER BY "nextReminderAt", "id"
            FOR UPDATE SKIP LOCKED
            LIMIT $3
          )
          UPDATE "tasks" AS task
          SET "reminderClaimToken" = $4,
              "reminderClaimedUntil" = $5
          FROM due
          WHERE task."id" = due."id"
          RETURNING task."id"
        `,
        [
          TASK_STATUSES.ACTIVE,
          now,
          TASK_REMINDER_CLAIM_BATCH_SIZE,
          claimToken,
          claimedUntil,
        ]
      );
    } catch {
      this.logger.warn('Task reminder schedule unavailable');
      return;
    }

    if (claimedRows.length === 0) return;
    try {
      const tasks = await this.tasksRepository.findBy({
        id: In(claimedRows.map(row => row.id)),
      });
      const tasksByUser = new Map<string, TaskEntity[]>();
      for (const task of tasks) {
        const userTasks = tasksByUser.get(task.userId) ?? [];
        userTasks.push(task);
        tasksByUser.set(task.userId, userTasks);
      }

      await Promise.all(
        [...tasksByUser].map(async ([userId, userTasks]) => {
          await this.processUserReminderTasks(userId, userTasks, now);
          await Promise.all(
            userTasks.map(task =>
              this.rescheduleClaimedTask(task.id, claimToken, now)
            )
          );
        })
      );
    } catch {
      this.logger.warn('Task reminder post-claim processing unavailable');
    }
  }

  async rebuildAllSchedules(): Promise<void> {
    let tasks: TaskEntity[];
    try {
      tasks = await this.getReminderCandidates();
    } catch {
      this.logger.warn('Task reminder reconciliation unavailable');
      return;
    }
    const userIds = [...new Set(tasks.map(task => task.userId))];
    await Promise.all(userIds.map(userId => this.rebuildUserSchedule(userId)));
  }

  async rebuildUserSchedule(userId: string): Promise<void> {
    const previous = this.scheduleRebuilds.get(userId) ?? Promise.resolve();
    const rebuild = previous
      .catch(() => undefined)
      .then(() => this.performUserScheduleRebuild(userId));
    this.scheduleRebuilds.set(userId, rebuild);
    try {
      await rebuild;
    } finally {
      if (this.scheduleRebuilds.get(userId) === rebuild) {
        this.scheduleRebuilds.delete(userId);
      }
    }
  }

  private async performUserScheduleRebuild(userId: string): Promise<void> {
    try {
      const [tasks, preferences] = await Promise.all([
        this.tasksRepository.find({
          where: {
            userId,
            status: TASK_STATUSES.ACTIVE,
            itemKind: In(['task', 'followUp']),
          },
        }),
        this.preferencesService.getPreferences(userId),
      ]);
      await Promise.all(
        tasks.map(task =>
          this.tasksRepository.update(task.id, {
            nextReminderAt: this.getNextReminderAt(task, preferences),
            reminderClaimToken: null,
            reminderClaimedUntil: null,
          })
        )
      );
    } catch {
      this.logger.warn('Failed to rebuild a task reminder schedule');
    }
  }

  private async rescheduleClaimedTask(
    taskId: string,
    claimToken: string,
    now: Date
  ): Promise<void> {
    try {
      const task = await this.tasksRepository.findOneBy({ id: taskId });
      if (!task) return;
      const preferences = await this.preferencesService.getPreferences(
        task.userId
      );
      await this.tasksRepository.update(
        { id: taskId, reminderClaimToken: claimToken },
        {
          nextReminderAt: this.getNextReminderAt(task, preferences, now),
          reminderClaimToken: null,
          reminderClaimedUntil: null,
        }
      );
    } catch {
      try {
        await this.tasksRepository.update(
          { id: taskId, reminderClaimToken: claimToken },
          {
            nextReminderAt: new Date(
              now.getTime() + TASK_REMINDER_POLL_INTERVAL_MS
            ),
            reminderClaimToken: null,
            reminderClaimedUntil: null,
          }
        );
      } catch {
        this.logger.warn('Failed release Task reminder claim');
      }
    }
  }

  async scanDueTasks(now = new Date()): Promise<void> {
    let tasks: TaskEntity[];
    try {
      tasks = await this.getReminderCandidates();
    } catch {
      this.logger.warn(
        'Task reminder scan skipped while storage is unavailable'
      );
      return;
    }

    const tasksByUser = new Map<string, TaskEntity[]>();
    for (const task of tasks) {
      const userTasks = tasksByUser.get(task.userId);
      if (userTasks) {
        userTasks.push(task);
      } else {
        tasksByUser.set(task.userId, [task]);
      }
    }

    await Promise.all(
      Array.from(tasksByUser, ([userId, userTasks]) =>
        this.processUserReminderTasks(userId, userTasks, now)
      )
    );
  }

  private async processUserReminderTasks(
    userId: string,
    tasks: TaskEntity[],
    now: Date
  ): Promise<void> {
    let preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>;
    try {
      preferences = await this.preferencesService.getPreferences(userId);
      if (!preferences.tasksExtension || !preferences.notifications) return;
    } catch {
      this.logger.warn('Failed to process a task reminder');
      return;
    }

    await Promise.all(
      tasks.map(async task => {
        try {
          const dueReminderHandled = await this.sendDueReminderIfNeeded(
            task,
            now,
            preferences
          );
          if (!dueReminderHandled) return;
          await this.repeatUrgentReminderIfNeeded(task, now, preferences);
        } catch {
          this.logger.warn('Failed to process a task reminder');
        }
      })
    );
  }

  private async getReminderCandidates(): Promise<TaskEntity[]> {
    return this.tasksRepository
      .createQueryBuilder('task')
      .where('task.status = :status', { status: TASK_STATUSES.ACTIVE })
      .andWhere('task.itemKind IN (:...itemKinds)', {
        itemKinds: ['task', 'followUp'],
      })
      .andWhere('task.dueDate IS NOT NULL')
      .getMany();
  }

  private async sendDueReminderIfNeeded(
    task: TaskEntity,
    now: Date,
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>
  ): Promise<boolean> {
    if (
      !task.dueDate ||
      !preferences.taskReminderPriorities.includes(task.priority)
    ) {
      return true;
    }

    const reminderAt = this.getReminderAt(
      task,
      preferences.timeZone,
      preferences.taskBeforeDueReminderMinutes
    );
    if (now < reminderAt) {
      return true;
    }

    const reminderKey = `${task.id}:${task.dueDate}:${task.dueTime ?? DEFAULT_DUE_TIME}`;
    if (task.lastReminderKey === reminderKey) {
      return true;
    }

    const priority = task.priority === TASK_PRIORITIES.URGENT ? 5 : 3;
    const tags = ['clipboard', CLIENT_NOTIFICATION_TYPES.TASK_REMINDER];
    const title = translateNotification(preferences.language, 'taskDue');
    if (preferences.pushNotifications) {
      try {
        await this.notificationService.sendTaskNotification(
          title,
          task.title,
          task.userId,
          priority,
          tags
        );
      } catch {
        this.logger.warn('Task push notification unavailable');
      }
    }
    this.emitClientTaskNotification(
      task,
      CLIENT_NOTIFICATION_TYPES.TASK_REMINDER,
      title,
      priority,
      tags
    );
    task.lastReminderKey = reminderKey;
    if (task.priority === TASK_PRIORITIES.URGENT) {
      task.lastUrgentReminderAt = now;
    }
    await this.tasksRepository.update(task.id, {
      lastReminderKey: reminderKey,
      lastUrgentReminderAt: task.lastUrgentReminderAt,
    });
    return true;
  }

  private async repeatUrgentReminderIfNeeded(
    task: TaskEntity,
    now: Date,
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>
  ): Promise<void> {
    const overdueAt = this.getOverdueAt(task, preferences.timeZone);
    const intervalMs =
      preferences.taskUrgentReminderRepeatIntervalMinutes * 60 * 1000;
    if (
      task.priority !== TASK_PRIORITIES.URGENT ||
      !preferences.taskReminderPriorities.includes(TASK_PRIORITIES.URGENT) ||
      !preferences.taskUrgentReminderRepeatEnabled ||
      !task.dueDate ||
      now.getTime() < overdueAt.getTime() + intervalMs ||
      task.createdAt.getTime() >= overdueAt.getTime()
    ) {
      return;
    }

    const lastReminderAt = task.lastUrgentReminderAt?.getTime();
    if (lastReminderAt && now.getTime() - lastReminderAt < intervalMs) {
      return;
    }

    const tags = ['clipboard', CLIENT_NOTIFICATION_TYPES.TASK_REMINDER];
    const title = translateNotification(preferences.language, 'taskDue');
    if (preferences.pushNotifications) {
      try {
        await this.notificationService.sendTaskNotification(
          title,
          task.title,
          task.userId,
          5,
          tags
        );
      } catch {
        this.logger.warn('Task push notification unavailable');
      }
    }
    task.lastUrgentReminderAt = now;
    await this.tasksRepository.update(task.id, { lastUrgentReminderAt: now });
    this.emitClientTaskNotification(
      task,
      CLIENT_NOTIFICATION_TYPES.TASK_REMINDER,
      title,
      5,
      tags
    );
  }

  private emitClientTaskNotification(
    task: TaskEntity,
    type: ClientNotificationType,
    title: string,
    priority: number,
    tags: string[]
  ): void {
    const timestamp = Date.now();
    const timer: Timer = {
      id: `task:${task.id}:${type}:${timestamp}`,
      startTime: timestamp,
      duration: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.COMPLETED,
      remainingTime: 0,
      userId: task.userId,
    };

    this.timerService.onClientNotification.next({
      userId: task.userId,
      type,
      timer,
      timestamp,
      notificationTitle: title,
      notificationBody: task.title,
      notificationPriority: priority,
      notificationTags: tags,
      notificationGroup: NOTIFICATION_GROUPS.TASK,
      task: {
        id: task.id,
        title: task.title,
        dueDate: task.dueDate,
        dueTime: task.dueTime,
        priority: task.priority,
      },
    });
  }

  private getReminderAt(
    task: TaskEntity,
    timeZone: string,
    beforeDueMinutes: number
  ) {
    if (!task.dueDate) {
      return new Date(Number.POSITIVE_INFINITY);
    }

    return new Date(
      this.getDueAt(task, timeZone).getTime() - beforeDueMinutes * 60 * 1000
    );
  }

  private getNextReminderAt(
    task: TaskEntity,
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>,
    now = new Date()
  ): Date | null {
    if (
      task.status !== TASK_STATUSES.ACTIVE ||
      !['task', 'followUp'].includes(task.itemKind) ||
      !task.dueDate ||
      !preferences.tasksExtension ||
      !preferences.notifications ||
      !preferences.taskReminderPriorities.includes(task.priority)
    ) {
      return null;
    }

    const reminderKey = `${task.id}:${task.dueDate}:${task.dueTime ?? DEFAULT_DUE_TIME}`;
    if (task.lastReminderKey !== reminderKey) {
      return this.getReminderAt(
        task,
        preferences.timeZone,
        preferences.taskBeforeDueReminderMinutes
      );
    }

    if (
      task.priority !== TASK_PRIORITIES.URGENT ||
      !preferences.taskUrgentReminderRepeatEnabled
    ) {
      return null;
    }

    const intervalMs =
      preferences.taskUrgentReminderRepeatIntervalMinutes * 60 * 1000;
    const overdueAt = this.getOverdueAt(task, preferences.timeZone).getTime();
    if (task.createdAt.getTime() >= overdueAt) return null;
    const lastSentAt = task.lastUrgentReminderAt?.getTime() ?? overdueAt;
    return new Date(
      Math.max(overdueAt + intervalMs, lastSentAt + intervalMs, now.getTime())
    );
  }

  private getDueAt(task: TaskEntity, timeZone: string) {
    if (!task.dueDate) {
      return new Date(Number.POSITIVE_INFINITY);
    }

    return this.getDateTimeInTimeZone(
      task.dueDate,
      task.dueTime ?? DEFAULT_DUE_TIME,
      timeZone
    );
  }

  private getOverdueAt(task: TaskEntity, timeZone: string) {
    if (!task.dueDate) {
      return new Date(Number.POSITIVE_INFINITY);
    }

    const overdueAt = task.dueTime
      ? this.getDueAt(task, timeZone)
      : this.getDateTimeInTimeZone(task.dueDate, '00:00', timeZone);
    if (!task.dueTime) {
      overdueAt.setDate(overdueAt.getDate() + 1);
    }
    return overdueAt;
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
}
