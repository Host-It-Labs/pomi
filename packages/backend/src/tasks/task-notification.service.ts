import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CLIENT_NOTIFICATION_TYPES,
  ClientNotificationType,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TIMER_STATUSES,
  TIMER_TYPES,
  Timer,
} from '@pomi/shared';
import { Repository } from 'typeorm';
import { PomiLogger } from '../logging/pomi-logger';
import { translateNotification } from '../i18n/notification-localization';
import { NotificationService } from '../notifications/notifications.service';
import { PreferencesService } from '../preferences/preferences.service';
import { TimerService } from '../timer/timer.service';
import { TaskEntity } from './tasks.entity';

const TASK_REMINDER_SCAN_INTERVAL_MS = 60 * 1000;
const DEFAULT_DUE_TIME = '10:00';

@Injectable()
export class TaskNotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PomiLogger(TaskNotificationService.name);
  private readonly lastUrgentReminderAt = new Map<string, number>();
  private scanInterval: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(TaskEntity)
    private tasksRepository: Repository<TaskEntity>,
    private preferencesService: PreferencesService,
    private notificationService: NotificationService,
    private timerService: TimerService
  ) {}

  onModuleInit(): void {
    this.scanInterval = setInterval(
      () => void this.scanDueTasks(),
      TASK_REMINDER_SCAN_INTERVAL_MS
    );
    void this.scanDueTasks();
  }

  onModuleDestroy(): void {
    if (this.scanInterval) clearInterval(this.scanInterval);
    this.scanInterval = null;
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

    for (const task of tasks) {
      try {
        await this.sendDueReminderIfNeeded(task, now, preferences);
        await this.repeatUrgentReminderIfNeeded(task, now, preferences);
      } catch {
        this.logger.warn('Failed to process a task reminder');
      }
    }
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
  ): Promise<void> {
    if (
      !task.dueDate ||
      !preferences.taskReminderPriorities.includes(task.priority)
    ) {
      return;
    }

    const reminderAt = this.getReminderAt(
      task,
      preferences.timeZone,
      preferences.taskBeforeDueReminderMinutes
    );
    if (now < reminderAt) {
      return;
    }

    const reminderKey = `${task.id}:${task.dueDate}:${task.dueTime ?? DEFAULT_DUE_TIME}`;
    if (task.lastReminderKey === reminderKey) {
      return;
    }

    const priority = task.priority === TASK_PRIORITIES.URGENT ? 5 : 3;
    const tags = ['clipboard', CLIENT_NOTIFICATION_TYPES.TASK_REMINDER];
    const title = translateNotification(preferences.language, 'taskDue');
    this.emitClientTaskNotification(
      task,
      CLIENT_NOTIFICATION_TYPES.TASK_REMINDER,
      title,
      priority,
      tags
    );
    if (preferences.pushNotifications) {
      await this.notificationService.sendTaskNotification(
        title,
        task.title,
        task.userId,
        priority,
        tags
      );
    }
    task.lastReminderKey = reminderKey;
    if (task.priority === TASK_PRIORITIES.URGENT) {
      this.lastUrgentReminderAt.set(task.id, now.getTime());
    }
    await this.tasksRepository.update(task.id, {
      lastReminderKey: reminderKey,
    });
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

    const lastReminderAt = this.lastUrgentReminderAt.get(task.id);
    if (lastReminderAt && now.getTime() - lastReminderAt < intervalMs) {
      return;
    }

    this.lastUrgentReminderAt.set(task.id, now.getTime());
    const tags = ['clipboard', CLIENT_NOTIFICATION_TYPES.TASK_REMINDER];
    const title = translateNotification(preferences.language, 'taskDue');
    this.emitClientTaskNotification(
      task,
      CLIENT_NOTIFICATION_TYPES.TASK_REMINDER,
      title,
      5,
      tags
    );
    if (preferences.pushNotifications) {
      await this.notificationService.sendTaskNotification(
        title,
        task.title,
        task.userId,
        5,
        tags
      );
    }
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
