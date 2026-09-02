import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type {
  IntentionsUserAction,
  TasksUserAction,
  TimerUserAction,
  ListsUserAction,
  VacationUserAction,
  UserAction,
  UserActionStatus,
} from '@pomi/shared';
import * as Sentry from '@sentry/nestjs';
import { CLIENT_NOTIFICATION_TYPES, TIMER_TYPES } from '@pomi/shared';
import { userActionIdSchema, userActionSchema } from '@pomi/shared';
import { randomUUID } from 'node:crypto';
import { AssistantDebugService } from '../assistant/assistant-debug.service';
import { AssistantService } from '../assistant/assistant.service';
import { RealtimeEvents } from '../realtime/realtime-events';
import { AssistantCaptureService } from '../assistant/assistant-capture.service';
import { IntentionsService } from '../intentions/intentions.service';
import { PreferencesService } from '../preferences/preferences.service';
import { StatisticsService } from '../statistics/statistics.service';
import { TasksService } from '../tasks/tasks.service';
import {
  TimerMutationOutcomeUnknownException,
  TimerService,
} from '../timer/timer.service';
import type { TestNotificationRequest } from '../timer/timer-notification.service';
import { UserDataTransferService } from '../system/user-data-transfer.service';
import { UsersService } from '../users/users.service';
import { FeedbackService } from '../feedback/feedback.service';
import { ListsService } from '../lists/lists.service';
import { VacationService } from '../vacation/vacation.service';
import { UserActionsStore, StoredUserAction } from './user-actions.store';
import {
  isRedactedLifecycleAction,
  redactUserAction,
} from './user-action-redaction';

export { redactUserAction } from './user-action-redaction';

const LOCK_TTL_MS = 60_000;
const RUNNING_LEASE_MS = 60_000;
const POLL_INTERVAL_MS = 1000;
const LOCK_RETRY_BASE_MS = 250;
const LOCK_RETRY_MAX_MS = 2000;
type StoredAction = StoredUserAction;

@Injectable()
export class UserActionsService implements OnModuleInit, OnModuleDestroy {
  private readonly processingUsers = new Set<string>();
  private readonly statusWaiters = new Map<string, Set<() => void>>();
  private readonly queueRetryTimers = new Map<
    string,
    { timer: NodeJS.Timeout; dueAt: number }
  >();
  private readonly queueRetryAttempts = new Map<string, number>();
  private isDestroyed = false;

  constructor(
    private readonly realtimeEvents: RealtimeEvents,
    private readonly timerService: TimerService,
    private readonly tasksService: TasksService,
    private readonly intentionsService: IntentionsService,
    private readonly preferencesService: PreferencesService,
    private readonly statisticsService: StatisticsService,
    private readonly userActionsStore: UserActionsStore,
    private readonly assistantCaptureService: AssistantCaptureService,
    private readonly assistantService: AssistantService,
    private readonly assistantDebugService: AssistantDebugService,
    private readonly usersService: UsersService,
    private readonly userDataTransferService: UserDataTransferService,
    private readonly feedbackService: FeedbackService,
    private readonly listsService: ListsService,
    private readonly vacationService: VacationService
  ) {}

  async onModuleInit(): Promise<void> {
    // Accepted actions are durable in Redis. Reconnect workers for every
    // per-user queue after a backend restart; running actions are reconciled
    // as unknown instead of being replayed.
    const users = await this.userActionsStore.listQueuedUsers();
    users.forEach(userId => void this.processUserQueue(userId));
  }

  onModuleDestroy(): void {
    this.isDestroyed = true;
    this.queueRetryTimers.forEach(({ timer }) => clearTimeout(timer));
    this.queueRetryTimers.clear();
    this.queueRetryAttempts.clear();
  }

  async submit(
    userId: string,
    actionId: string,
    rawAction: unknown
  ): Promise<UserActionStatus> {
    if (!userActionIdSchema.safeParse(actionId).success) {
      throw new BadRequestException('Invalid user action ID');
    }
    const parsed = userActionSchema.safeParse(rawAction);
    if (!parsed.success) {
      throw new BadRequestException('Invalid user action payload');
    }

    const now = Date.now();
    const action = parsed.data as UserAction;
    const lifecycleAction = redactUserAction(action);
    const accepted: StoredAction = {
      actionId,
      status: 'accepted',
      action: lifecycleAction,
      acceptedAt: now,
      updatedAt: now,
    };
    const cancelled: StoredAction = {
      ...accepted,
      status: 'cancelled',
      completedAt: now,
      updatedAt: now,
    };
    const { status } = await this.userActionsStore.submit(
      userId,
      actionId,
      accepted,
      cancelled,
      action
    );
    this.emitUpdate(userId, status);
    if (status.status === 'accepted') void this.processUserQueue(userId);
    return status;
  }

  async getStatus(
    userId: string,
    actionId: string,
    waitMs = 0
  ): Promise<UserActionStatus> {
    if (!userActionIdSchema.safeParse(actionId).success) {
      throw new BadRequestException('Invalid user action ID');
    }
    const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 30_000);
    for (;;) {
      const waiter = this.createLocalStatusWaiter(
        userId,
        actionId,
        Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))
      );
      const status = await this.readStatus(userId, actionId);
      if (!status) {
        waiter.cancel();
        throw new NotFoundException('User action not found');
      }
      if (Date.now() >= deadline || this.isTerminal(status.status)) {
        waiter.cancel();
        return status;
      }
      await waiter.promise;
    }
  }

  async cancel(userId: string, actionId: string): Promise<UserActionStatus> {
    if (!userActionIdSchema.safeParse(actionId).success) {
      throw new BadRequestException('Invalid user action ID');
    }
    const now = Date.now();
    const tombstone: StoredAction = {
      actionId,
      status: 'cancelled',
      action: {
        kind: 'cancellation',
      },
      completedAt: now,
      acceptedAt: now,
      updatedAt: now,
    };
    // This script is the cancellation/acceptance linearization point. If the
    // record exists, acceptance wins; otherwise the tombstone makes a later
    // submission atomically become cancelled.
    const { status, created } = await this.userActionsStore.cancel(
      userId,
      actionId,
      tombstone
    );
    if (status.status === 'cancelled') {
      await this.userActionsStore.removeExecutionAction(userId, actionId);
    }
    if (created) this.logBackendTiming(status);
    this.emitUpdate(userId, status);
    return status;
  }

  private async processUserQueue(userId: string): Promise<void> {
    if (this.isDestroyed) return;
    if (this.processingUsers.has(userId)) return;
    this.processingUsers.add(userId);
    const lockToken = randomUUID();
    let acquired = false;
    try {
      acquired = await this.userActionsStore.acquireLock(
        userId,
        lockToken,
        LOCK_TTL_MS
      );
    } catch {
      this.processingUsers.delete(userId);
      this.scheduleQueueRetry(userId);
      return;
    }
    if (!acquired) {
      this.processingUsers.delete(userId);
      this.scheduleQueueRetry(userId);
      return;
    }
    if (this.isDestroyed) {
      await this.userActionsStore
        .releaseLock(userId, lockToken)
        .catch(() => undefined);
      this.processingUsers.delete(userId);
      return;
    }
    this.queueRetryAttempts.delete(userId);

    const heartbeat = setInterval(
      () => {
        void this.userActionsStore
          .renewLock(userId, lockToken, LOCK_TTL_MS)
          .catch(() => undefined);
      },
      Math.floor(LOCK_TTL_MS / 3)
    );

    try {
      for (;;) {
        const actionId = await this.userActionsStore.queueHead(userId);
        if (!actionId) {
          this.clearQueueRetry(userId);
          return;
        }
        const status = await this.readStatus(userId, actionId);
        if (!status) {
          await this.userActionsStore.removeExecutionAction(userId, actionId);
          await this.userActionsStore.removeQueueHead(userId);
          continue;
        }
        if (this.isTerminal(status.status)) {
          await this.userActionsStore.removeExecutionAction(userId, actionId);
          await this.userActionsStore.removeQueueHead(userId);
          continue;
        }
        if (status.status === 'running') {
          const runningAge = Date.now() - status.updatedAt;
          if (runningAge > RUNNING_LEASE_MS) {
            const recovered = await this.recoverRunningAction(userId, status);
            if (recovered) {
              await this.writeStatus(userId, recovered);
              await this.userActionsStore.removeExecutionAction(
                userId,
                actionId
              );
              await this.userActionsStore.removeQueueHead(userId);
              continue;
            }
            const failed: StoredAction = {
              ...status,
              status: 'failed',
              outcomeUnknown: true,
              error: { message: 'Action worker stopped before completion' },
              completedAt: Date.now(),
              updatedAt: Date.now(),
            };
            await this.writeStatus(userId, failed);
            await this.userActionsStore.removeExecutionAction(userId, actionId);
            await this.userActionsStore.removeQueueHead(userId);
            continue;
          }
          this.scheduleQueueRetry(
            userId,
            Math.max(1, RUNNING_LEASE_MS - runningAge)
          );
          return;
        }

        this.clearQueueRetry(userId);
        const running: StoredAction = {
          ...status,
          status: 'running',
          startedAt: Date.now(),
          updatedAt: Date.now(),
        };
        await this.writeStatus(userId, running);
        try {
          const executionAction =
            ((await this.userActionsStore.readExecutionAction(
              userId,
              actionId
            )) ?? running.action) as UserAction;
          if (
            executionAction === running.action &&
            isRedactedLifecycleAction(running.action)
          ) {
            throw new BadRequestException(
              'Action payload expired before it could be executed'
            );
          }
          const result = await this.executeAction(
            userId,
            actionId,
            executionAction
          );
          const succeeded: StoredAction = {
            ...running,
            status: 'succeeded',
            result,
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          await this.writeStatus(userId, succeeded);
        } catch (error) {
          const recovered = await this.recoverRunningAction(
            userId,
            running
          ).catch(() => null);
          if (recovered) {
            await this.writeStatus(userId, recovered);
            await this.userActionsStore.removeExecutionAction(userId, actionId);
            await this.userActionsStore.removeQueueHead(userId);
            continue;
          }
          const actionMayHaveMutated =
            (running.action.kind === 'assistant' &&
              running.action.operation === 'commitPreparedVoiceCommand') ||
            error instanceof TimerMutationOutcomeUnknownException;
          const failed: StoredAction = {
            ...running,
            status: 'failed',
            ...(actionMayHaveMutated ? { outcomeUnknown: true } : {}),
            error: { message: this.errorMessage(error) },
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          await this.writeStatus(userId, failed);
        }
        await this.userActionsStore.removeExecutionAction(userId, actionId);
        await this.userActionsStore.removeQueueHead(userId);
      }
    } catch {
      this.scheduleQueueRetry(userId);
    } finally {
      clearInterval(heartbeat);
      await this.userActionsStore
        .releaseLock(userId, lockToken)
        .catch(() => undefined);
      this.processingUsers.delete(userId);
      void this.resumeQueuedWork(userId);
    }
  }

  private async resumeQueuedWork(userId: string): Promise<void> {
    try {
      const actionId = await this.userActionsStore.queueHead(userId);
      if (!actionId) return;
      const status = await this.readStatus(userId, actionId);
      if (status?.status === 'running') return;
      void this.processUserQueue(userId);
    } catch {
      this.scheduleQueueRetry(userId);
    }
  }

  private async recoverRunningAction(
    userId: string,
    status: StoredAction
  ): Promise<StoredAction | null> {
    if (
      status.action.kind !== 'assistant' ||
      status.action.operation !== 'commitPreparedVoiceCommand'
    ) {
      return null;
    }
    const committed =
      await this.assistantCaptureService.getPreparedVoiceCommitResult(
        userId,
        status.actionId
      );
    if (!committed) return null;
    const now = Date.now();
    return {
      ...status,
      status: 'succeeded',
      result: committed,
      completedAt: now,
      updatedAt: now,
    };
  }

  private scheduleQueueRetry(userId: string, requestedDelay?: number): void {
    if (this.isDestroyed) return;
    let delay = requestedDelay;
    let nextAttempt: number | undefined;
    if (delay === undefined) {
      const attempt = this.queueRetryAttempts.get(userId) ?? 0;
      const baseDelay = Math.min(
        LOCK_RETRY_BASE_MS * 2 ** attempt,
        LOCK_RETRY_MAX_MS
      );
      delay = baseDelay * (0.75 + Math.random() * 0.5);
      nextAttempt = attempt + 1;
    }
    const dueAt = Date.now() + delay;
    const existing = this.queueRetryTimers.get(userId);
    if (existing && existing.dueAt <= dueAt) return;
    if (existing) clearTimeout(existing.timer);
    if (nextAttempt !== undefined) {
      this.queueRetryAttempts.set(userId, nextAttempt);
    }
    const timer = setTimeout(() => {
      this.queueRetryTimers.delete(userId);
      void this.processUserQueue(userId);
    }, delay);
    this.queueRetryTimers.set(userId, { timer, dueAt });
  }

  private clearQueueRetry(userId: string): void {
    const retry = this.queueRetryTimers.get(userId);
    if (retry) clearTimeout(retry.timer);
    this.queueRetryTimers.delete(userId);
    this.queueRetryAttempts.delete(userId);
  }

  private async executeAction(
    userId: string,
    actionId: string,
    action: UserAction
  ): Promise<unknown> {
    switch (action.kind) {
      case 'timer':
        return this.executeTimerAction(userId, action);
      case 'tasks':
        return this.executeTasksAction(userId, action);
      case 'intentions':
        return this.executeIntentionsAction(userId, action);
      case 'preferences': {
        if (action.operation === 'update') {
          if (!action.updates)
            throw new BadRequestException('Preference updates are required');
          return this.preferencesService.updatePreferences(
            userId,
            action.updates as never
          );
        }
        if (!action.key)
          throw new BadRequestException('Preference key is required');
        const preferences =
          await this.preferencesService.getPreferences(userId);
        const currentValue = (
          preferences as unknown as Record<string, unknown>
        )[action.key];
        if (typeof currentValue !== 'boolean')
          throw new BadRequestException('Preference is not a boolean toggle');
        return this.preferencesService.updatePreferences(userId, {
          [action.key]: !currentValue,
        } as never);
      }
      case 'workTimerLog':
        if (action.operation === 'delete') {
          await this.statisticsService.deleteWorkTimerLog(userId, action.logId);
          return { success: true };
        }
        return this.statisticsService.updateWorkTimerLog(
          userId,
          action.logId,
          action.payload as never
        );
      case 'assistant':
        if (action.operation === 'commitPreparedVoiceCommand') {
          const preparationId = action.payload?.preparationId;
          if (typeof preparationId !== 'string') {
            throw new BadRequestException(
              'Assistant preparation ID is required'
            );
          }
          if (preparationId !== actionId) {
            throw new BadRequestException(
              'Assistant preparation ID must match the action ID'
            );
          }
          return this.assistantCaptureService.commitPreparedVoiceCommand(
            userId,
            preparationId
          );
        }
        if (action.operation === 'commitPreparedTaskFromText') {
          const preparationId = action.payload?.preparationId;
          if (typeof preparationId !== 'string') {
            throw new BadRequestException(
              'Assistant preparation ID is required'
            );
          }
          if (preparationId !== actionId) {
            throw new BadRequestException(
              'Assistant preparation ID must match the action ID'
            );
          }
          const listId = action.payload?.listId;
          if (
            listId !== undefined &&
            listId !== null &&
            typeof listId !== 'string'
          ) {
            throw new BadRequestException('Assistant List ID must be a string');
          }
          return listId === undefined
            ? this.assistantCaptureService.commitPreparedTaskFromText(
                userId,
                preparationId
              )
            : this.assistantCaptureService.commitPreparedTaskFromText(
                userId,
                preparationId,
                listId
              );
        }
        if (action.operation === 'createTaskFromText') {
          const payload = action.payload ?? {};
          if (typeof payload.text !== 'string')
            throw new BadRequestException('Assistant text is required');
          return this.assistantCaptureService.createTaskFromText(
            userId,
            payload.text,
            payload.defaults as never,
            typeof payload.debugLogId === 'string' ? payload.debugLogId : null,
            typeof payload.listId === 'string' ? payload.listId : null
          );
        }
        if (action.operation === 'updateSettings') {
          await this.ensureAdmin(userId);
          return this.assistantService.updateSettings(
            (action.payload ?? {}) as never
          );
        }
        if (action.operation === 'updateDebugStatus') {
          await this.ensureDebugAccess(userId);
          const enabled = action.payload?.enabled;
          if (typeof enabled !== 'boolean') {
            throw new BadRequestException('Assistant debug status is required');
          }
          return this.assistantDebugService.updateStatus(userId, enabled);
        }
        if (action.operation === 'updateDebugLogFlag') {
          await this.ensureDebugAccess(userId);
          const id = action.payload?.id;
          const flagged = action.payload?.flagged;
          if (typeof id !== 'string' || typeof flagged !== 'boolean') {
            throw new BadRequestException(
              'Assistant debug log flag is required'
            );
          }
          return this.assistantDebugService.updateFlag(userId, id, flagged);
        }
        if (action.operation === 'clearDebugLogs') {
          await this.ensureDebugAccess(userId);
          await this.assistantDebugService.clearLogs(userId);
          return { success: true };
        }
        throw new BadRequestException(
          `Assistant action ${action.operation} is not available through the user gateway`
        );
      case 'system':
        await this.ensureAdmin(userId);
        if (action.operation === 'importUserData') {
          return this.userDataTransferService.importUserData(
            userId,
            action.payload as never
          );
        }
        throw new BadRequestException('Unsupported system action');
      case 'notifications': {
        await this.ensureDebugAccess(userId);
        const { type, timerType, minutesLeft, isLastWorkTimerInSession } =
          action.payload;
        if (
          typeof type !== 'string' ||
          !Object.values(CLIENT_NOTIFICATION_TYPES).includes(
            type as (typeof CLIENT_NOTIFICATION_TYPES)[keyof typeof CLIENT_NOTIFICATION_TYPES]
          ) ||
          typeof timerType !== 'string' ||
          !Object.values(TIMER_TYPES).includes(
            timerType as (typeof TIMER_TYPES)[keyof typeof TIMER_TYPES]
          )
        ) {
          throw new BadRequestException('Invalid notification test payload');
        }
        await this.timerService.sendTestNotification({
          userId,
          type,
          timerType,
          minutesLeft:
            typeof minutesLeft === 'number' && minutesLeft > 0
              ? minutesLeft
              : undefined,
          isLastWorkTimerInSession: isLastWorkTimerInSession === true,
        } as TestNotificationRequest);
        return { success: true };
      }
      case 'feedback':
        return this.feedbackService.submit(action.text, action.diagnostics);
      case 'lists':
        return this.executeListsAction(userId, action);
      case 'vacation':
        return this.executeVacationAction(userId, action);
    }
  }

  private async executeTimerAction(userId: string, action: TimerUserAction) {
    switch (action.operation) {
      case 'createOrResume':
        if (!action.timerType)
          throw new BadRequestException('Timer type is required');
        if (
          action.timerType === TIMER_TYPES.LONG_BREAK &&
          !action.intention &&
          !(action.intentions && action.intentions.length > 0)
        ) {
          return this.timerService.startLongBreakTimer(userId);
        }
        return this.timerService.createOrResumeTimer(userId, {
          type: action.timerType,
          intention: action.intention,
          intentions: action.intentions,
          subIntentions: action.subIntentions,
          focusedTaskId: action.focusedTaskId,
          customDuration: action.customDuration,
          resetOnFirstIntention: action.resetOnFirstIntention,
        });
      case 'selectIntention':
        if (!action.intention)
          throw new BadRequestException('Intention is required');
        return this.timerService.selectTimerIntention(
          userId,
          action.timerType ?? TIMER_TYPES.WORK,
          action.intention,
          action.subIntentions,
          action.resetOnFirstIntention
        );
      case 'setIntentions':
        if (!action.intentions)
          throw new BadRequestException('Intentions are required');
        return this.timerService.selectTimerIntentions(
          userId,
          action.timerType ?? TIMER_TYPES.WORK,
          action.intentions,
          action.subIntentions,
          action.resetOnFirstIntention
        );
      case 'pause':
        return this.timerService.pauseTimer(userId);
      case 'reset':
        return this.timerService.resetTimer(userId);
      case 'skip':
        return this.timerService.skipTimer(userId, action.requestedLogMode);
      case 'addFiveMinutes':
        return this.timerService.addFiveMinutesTimer(userId);
      case 'undo':
        return this.timerService.undoLastTimerAction(userId);
      case 'redo':
        return this.timerService.redoLastTimerAction(userId);
      case 'clearHistory':
        await this.timerService.clearTimerHistory(userId);
        return { success: true };
      case 'stack':
        return this.timerService.stackTimer(userId);
      case 'setSessionPosition':
        if (action.position === undefined)
          throw new BadRequestException('Position is required');
        return this.timerService.setSessionPosition(userId, action.position);
      case 'removeFocusedTask':
        if (!action.taskId)
          throw new BadRequestException('Task ID is required');
        await this.timerService.removeFocusedTask(userId, action.taskId);
        return this.timerService.getTimerByUserId(userId);
      case 'resolveExtension':
        if (!action.extensionAction)
          throw new BadRequestException('Extension action is required');
        return this.timerService.resolveTimerExtension(
          userId,
          action.extensionAction
        );
      case 'convertLongBreakToBreak':
        return this.timerService.convertLongBreakToBreak(userId);
    }
  }

  private executeListsAction(userId: string, action: ListsUserAction) {
    if (action.operation === 'convertIntention') {
      if (!action.intentionSlug)
        throw new BadRequestException('Intention slug is required');
      return this.listsService.convertIntention(userId, action.intentionSlug);
    }
    if (action.operation === 'convertToIntention') {
      if (!action.listId) throw new BadRequestException('List ID is required');
      return this.listsService.convertToIntention(userId, action.listId);
    }
    if (action.operation === 'convertTaskToListItem') {
      if (!action.taskId || !action.listId) {
        throw new BadRequestException('Task and List are required');
      }
      return this.listsService.convertTaskToListItem(
        userId,
        action.taskId,
        action.listId,
        {
          title: action.title,
          dueDate: action.dueDate,
          priority: action.priority,
          vacationEligible: action.vacationEligible,
        }
      );
    }
    if (action.operation === 'convertListItemToTask') {
      if (!action.itemId || !action.intentionSlug) {
        throw new BadRequestException('List item and Intention are required');
      }
      return this.listsService.convertListItemToTask(
        userId,
        action.itemId,
        action.intentionSlug,
        action.subIntentionSlug
      );
    }
    if (action.operation === 'create') {
      return this.listsService.create(userId, {
        title: action.title ?? '',
        emoji: action.emoji,
        description: action.description,
      });
    }
    if (action.operation === 'update') {
      if (!action.listId) throw new BadRequestException('List ID is required');
      return this.listsService.update(userId, action.listId, {
        title: action.title,
        emoji: action.emoji,
        description: action.description,
        vacationDefault: action.vacationDefault,
        isArchived: action.isArchived,
        isFavorite: action.isFavorite,
      });
    }
    if (action.operation === 'createItem') {
      if (!action.listId) throw new BadRequestException('List ID is required');
      return this.listsService.createItem(userId, action.listId, {
        title: action.title ?? '',
        dueDate: action.dueDate,
        priority: action.priority,
        vacationEligible: action.vacationEligible,
      });
    }
    if (action.operation === 'resetCompletedItems') {
      if (!action.listId) throw new BadRequestException('List ID is required');
      return this.listsService.resetCompletedItems(userId, action.listId);
    }
    if (!action.itemId)
      throw new BadRequestException('List item ID is required');
    return this.listsService.updateItem(userId, action.itemId, {
      title: action.title,
      dueDate: action.dueDate,
      priority: action.priority,
      status: action.status,
      vacationEligible: action.vacationEligible,
    });
  }

  private executeVacationAction(userId: string, action: VacationUserAction) {
    if (action.operation === 'activate') {
      return this.vacationService.activate(userId, action.endsOn);
    }
    if (action.operation === 'deactivate') {
      return this.vacationService.deactivate(userId);
    }
    return this.vacationService.configure(userId, {
      intentionSlugs: action.intentionSlugs ?? [],
      listIds: action.listIds ?? [],
      excludedItemIds: action.excludedItemIds ?? [],
    });
  }

  private async executeTasksAction(userId: string, action: TasksUserAction) {
    switch (action.operation) {
      case 'create':
        return this.tasksService.createTask({
          userId,
          title: action.title ?? '',
          description: action.description,
          dueDate: action.dueDate,
          dueTime: action.dueTime,
          priority: action.priority,
          timerType: action.timerType,
          customDuration: action.customDuration,
          pinned: action.pinned,
          intentionSlug: action.intentionSlug,
          subIntentionSlug: action.subIntentionSlug,
          recurrenceRule: action.recurrenceRule,
          recurrenceInterval: action.recurrenceInterval,
          recurrenceAnchorMode: action.recurrenceAnchorMode,
          followUpTaskId: action.followUpTaskId,
          followUpDefinition: action.followUpDefinition,
          followUpDelayDays: action.followUpDelayDays,
          vacationEligible: action.vacationEligible,
          creationSource: action.creationSource ?? 'manual',
        });
      case 'update': {
        const {
          taskId,
          kind: _kind,
          operation: _operation,
          ...updates
        } = action;
        if (!taskId) throw new BadRequestException('Task ID is required');
        return this.tasksService.updateTask(userId, taskId, updates as never);
      }
      case 'complete':
        if (!action.taskId)
          throw new BadRequestException('Task ID is required');
        return this.tasksService.updateTask(userId, action.taskId, {
          status: 'completed',
        });
      case 'reorder':
        if (!action.reorder)
          throw new BadRequestException('Reorder payload is required');
        return this.tasksService.reorderTasks(userId, action.reorder);
      case 'import':
        if (!action.importSource || !action.rows) {
          throw new BadRequestException('Import source and rows are required');
        }
        return this.tasksService.importTasks(
          userId,
          action.importSource as never,
          action.rows
        );
      case 'revert':
        if (!action.eventId)
          throw new BadRequestException('Event ID is required');
        return this.tasksService.revertLatestTaskEvent(userId, action.eventId);
    }
  }

  private async executeIntentionsAction(
    userId: string,
    action: IntentionsUserAction
  ) {
    const type = action.type ?? 'work';
    switch (action.operation) {
      case 'create':
        return this.intentionsService.createIntention(
          userId,
          action.title ?? '',
          action.emoji ?? '',
          type,
          action.hasCustomDuration === true,
          action.customDuration,
          action.keepScreenAwake === true,
          action.isHabit === true,
          action.parentIntentionId ?? null,
          action.isFavorite === true,
          action.description,
          action.allowsTasks !== false,
          action.habitCadence
        );
      case 'update':
        if (!action.slug)
          throw new BadRequestException('Intention slug is required');
        return this.intentionsService.updateIntention(
          userId,
          action.slug,
          action.title ?? '',
          action.emoji ?? '',
          type,
          action.hasCustomDuration,
          action.customDuration,
          action.keepScreenAwake,
          action.isHabit,
          action.parentIntentionId,
          action.isFavorite,
          action.description,
          action.allowsTasks,
          action.habitCadence
        );
      case 'delete':
        if (!action.slug)
          throw new BadRequestException('Intention slug is required');
        await this.intentionsService.deleteIntention(
          userId,
          action.slug,
          type,
          action.keepStats
        );
        return { success: true };
      case 'archive':
        if (!action.slug)
          throw new BadRequestException('Intention slug is required');
        return this.intentionsService.archiveIntention(
          userId,
          action.slug,
          type
        );
      case 'unarchive':
        if (!action.slug)
          throw new BadRequestException('Intention slug is required');
        return this.intentionsService.unarchiveIntention(
          userId,
          action.slug,
          type
        );
      case 'reparent':
        if (!action.slug || !(action.parentSlug ?? action.parentIntentionId)) {
          throw new BadRequestException('Intention and parent are required');
        }
        return this.intentionsService.reparentIntention(
          userId,
          action.slug,
          type,
          action.parentSlug ?? action.parentIntentionId!
        );
    }
  }

  private async ensureAdmin(userId: string): Promise<void> {
    const user = await this.usersService.findUserById(userId);
    if (!user?.isAdmin) throw new ForbiddenException('Admin access required');
  }

  private async ensureDebugAccess(userId: string): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    await this.ensureAdmin(userId);
  }

  private async readStatus(
    userId: string,
    actionId: string
  ): Promise<StoredAction | null> {
    return this.userActionsStore.read(userId, actionId);
  }

  private async writeStatus(
    userId: string,
    status: StoredAction
  ): Promise<void> {
    await this.userActionsStore.write(userId, status);
    if (this.isTerminal(status.status)) this.logBackendTiming(status);
    this.emitUpdate(userId, status);
  }

  private logBackendTiming(status: UserActionStatus): void {
    Sentry.logger.info('User action backend timing', {
      action_id: status.actionId,
      action_kind: status.action.kind,
      action_operation:
        'operation' in status.action
          ? status.action.operation
          : status.action.kind,
      lifecycle: status.status,
      backend_queue_ms:
        status.startedAt === undefined
          ? undefined
          : Math.max(0, status.startedAt - status.acceptedAt),
      backend_execution_ms:
        status.startedAt === undefined || status.completedAt === undefined
          ? undefined
          : Math.max(0, status.completedAt - status.startedAt),
      backend_total_ms:
        status.completedAt === undefined
          ? undefined
          : Math.max(0, status.completedAt - status.acceptedAt),
      outcome_unknown: status.outcomeUnknown === true,
    });
  }

  private emitUpdate(userId: string, status: UserActionStatus): void {
    this.realtimeEvents.emitUserActionUpdate(userId, status);
    const waiterKey = this.statusWaiterKey(userId, status.actionId);
    this.statusWaiters.get(waiterKey)?.forEach(resolve => resolve());
  }

  private createLocalStatusWaiter(
    userId: string,
    actionId: string,
    timeoutMs: number
  ): { promise: Promise<void>; cancel: () => void } {
    if (timeoutMs <= 0) {
      return { promise: Promise.resolve(), cancel: () => undefined };
    }
    const key = this.statusWaiterKey(userId, actionId);
    let cancel: () => void = () => undefined;
    const promise = new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const waiters = this.statusWaiters.get(key);
        waiters?.delete(finish);
        if (waiters?.size === 0) this.statusWaiters.delete(key);
        resolve();
      };
      cancel = finish;
      const timeout = setTimeout(finish, timeoutMs);
      const waiters = this.statusWaiters.get(key) ?? new Set<() => void>();
      waiters.add(finish);
      this.statusWaiters.set(key, waiters);
    });
    return { promise, cancel };
  }

  private statusWaiterKey(userId: string, actionId: string): string {
    return `${userId}:${actionId}`;
  }

  private isTerminal(status: UserActionStatus['status']): boolean {
    return (
      status === 'succeeded' || status === 'failed' || status === 'cancelled'
    );
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message: unknown }).message);
    }
    return 'User action failed';
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
