import { Injectable } from '@nestjs/common';
import {
  AssistantStatus,
  DEFAULT_APP_LANGUAGE,
  Preferences,
  TASK_PRIORITIES,
  TIMER_STATUSES,
  TIMER_TYPES,
  TaskPriority,
  Timer,
  TimerTypes,
  WatchAssistantSummary,
  WatchIntentionOption,
  WatchStatus,
  WatchTaskMode,
  WatchTaskSummary,
  WatchTimerSummary,
} from '@pomi/shared';
import { AssistantService } from '../assistant/assistant.service';
import { Intention } from '../intentions/intentions.entity';
import { IntentionsService } from '../intentions/intentions.service';
import { PomiLogger } from '../logging/pomi-logger';
import { PreferencesService } from '../preferences/preferences.service';
import { TaskEntity } from '../tasks/tasks.entity';
import { TasksService } from '../tasks/tasks.service';
import type { WatchTaskQueryResult } from '../tasks/tasks.service';
import { TimerService } from '../timer/timer.service';

const DEFAULT_TASK_LIMIT = 4;
const MAX_TASK_LIMIT = 12;
type IntentionLookup = Record<string, Intention>;

const PRIORITY_RANK: Record<TaskPriority, number> = {
  [TASK_PRIORITIES.URGENT]: 0,
  [TASK_PRIORITIES.HIGH]: 1,
  [TASK_PRIORITIES.NORMAL]: 2,
  [TASK_PRIORITIES.LOW]: 3,
};

@Injectable()
export class WatchService {
  private readonly logger = new PomiLogger(WatchService.name);

  constructor(
    private readonly timerService: TimerService,
    private readonly tasksService: TasksService,
    private readonly assistantService: AssistantService,
    private readonly preferencesService: PreferencesService,
    private readonly intentionsService: IntentionsService
  ) {}

  async getStatus(
    userId: string,
    options: { taskMode?: WatchTaskMode; limit?: number } = {}
  ): Promise<WatchStatus> {
    const taskMode = options.taskMode ?? 'intention';
    const limit = this.normalizeTaskLimit(options.limit);
    const [timer, preferences, assistantStatus] = await Promise.all([
      this.timerService.getTimerByUserId(userId),
      this.preferencesService.getPreferences(userId),
      this.assistantService.getStatus(userId),
    ]);
    const now = this.getNow();
    const timeZone = this.normalizeTimeZone(preferences.timeZone);
    const taskSnapshot = preferences.tasksExtension
      ? await this.getWatchTaskSnapshot(
          userId,
          timer,
          taskMode,
          limit,
          now,
          timeZone
        )
      : this.emptyWatchTaskSnapshot();
    const activeTasks = taskSnapshot.tasks;
    const intentionsBySlug = await this.loadIntentionsBySlug(
      userId,
      timer,
      activeTasks
    );
    const timerSummary = this.formatTimer(timer, intentionsBySlug);
    const tasks = activeTasks.map(task =>
      this.formatTask(task, timer, intentionsBySlug, now, timeZone)
    );
    const requiresIntentionSelection =
      await this.requiresIntentionSelectionForStart(userId, timer, preferences);

    return {
      serverNowMs: Date.now(),
      language: preferences.language ?? DEFAULT_APP_LANGUAGE,
      taskMode,
      timer: timerSummary,
      assistant: this.formatAssistant(assistantStatus),
      timerControls: {
        canStartOrResume:
          (!timer || timer.status !== TIMER_STATUSES.RUNNING) &&
          !requiresIntentionSelection,
        canPause: timer?.status === TIMER_STATUSES.RUNNING,
        canAddFiveMinutes: timer !== null,
        canReset: timer !== null,
        canSkip: timer !== null,
        requiresIntentionSelection,
        intentionRequireSelection: preferences.intentionRequireSelection,
        intentionMultiSelect: preferences.intentionMultiSelect,
        advancedSkip: preferences.advancedSkip,
        sessionsEnabled: preferences.sessionsExtension,
        canStartLongBreak:
          preferences.sessionHasLongBreak &&
          preferences.sessionShowLongBreakButton &&
          (timer?.type === TIMER_TYPES.WORK ||
            timer?.type === TIMER_TYPES.BREAK),
        resetBreakOnFirstIntention: preferences.resetBreakOnFirstIntention,
        resetLongBreakOnFirstIntention:
          preferences.resetLongBreakOnFirstIntention,
        resetWorkOnFirstIntention: preferences.resetWorkOnFirstIntention,
      },
      tasks,
      totalVisibleTasks: taskSnapshot.totalVisibleTasks,
      totalActiveTasks: taskSnapshot.totalActiveTasks,
    };
  }

  private async getWatchTaskSnapshot(
    userId: string,
    timer: Timer | null,
    taskMode: WatchTaskMode,
    limit: number,
    now: Date,
    timeZone: string
  ): Promise<WatchTaskQueryResult> {
    const currentTaskType = timer?.type ?? TIMER_TYPES.WORK;
    const options = {
      timerType: currentTaskType,
      taskMode,
      timerIntentions: this.getTimerIntentions(timer).map(slug => ({
        slug,
        subIntentionSlug: this.getTimerSubIntention(timer, slug) ?? null,
      })),
      limit,
      now,
      timeZone,
    };
    const legacy = () =>
      this.getLegacyWatchTaskSnapshot(
        userId,
        timer,
        taskMode,
        limit,
        now,
        timeZone
      );

    const queryMode = this.getWatchTaskQueryMode();
    if (queryMode === 'legacy') return legacy();

    if (queryMode === 'shadow') {
      try {
        const [bounded, legacySnapshot] = await Promise.all([
          this.tasksService.getWatchTaskSnapshot(userId, options),
          legacy(),
        ]);
        if (!this.watchTaskSnapshotsMatch(bounded, legacySnapshot)) {
          this.logger.warn(
            `Bounded Watch Task query differs from legacy results for user ${userId}`
          );
        }
        return bounded;
      } catch (error) {
        this.logger.warn(
          `Bounded Watch Task query failed during shadow comparison; using legacy results: ${error}`
        );
        return legacy();
      }
    }

    try {
      return await this.tasksService.getWatchTaskSnapshot(userId, options);
    } catch (error) {
      this.logger.warn(
        `Bounded Watch Task query failed; using legacy results: ${error}`
      );
      return legacy();
    }
  }

  private async getLegacyWatchTaskSnapshot(
    userId: string,
    timer: Timer | null,
    taskMode: WatchTaskMode,
    limit: number,
    now: Date,
    timeZone: string
  ): Promise<WatchTaskQueryResult> {
    const activeTasks = await this.tasksService.getActiveTasks(userId);
    const currentTaskType = timer?.type ?? TIMER_TYPES.WORK;
    const activeTasksForTimer = activeTasks.filter(
      task => task.timerType === currentTaskType
    );
    const visibleTasks = this.buildTaskView(
      activeTasksForTimer,
      timer,
      taskMode,
      now,
      timeZone
    );
    return {
      tasks: visibleTasks.slice(0, limit),
      totalVisibleTasks: visibleTasks.length,
      totalActiveTasks: activeTasksForTimer.length,
    };
  }

  private emptyWatchTaskSnapshot(): WatchTaskQueryResult {
    return { tasks: [], totalVisibleTasks: 0, totalActiveTasks: 0 };
  }

  private getWatchTaskQueryMode(): 'bounded' | 'legacy' | 'shadow' {
    const mode = process.env.POMI_WATCH_STATUS_TASK_QUERY_MODE;
    return mode === 'legacy' || mode === 'shadow' ? mode : 'bounded';
  }

  private watchTaskSnapshotsMatch(
    bounded: WatchTaskQueryResult,
    legacy: WatchTaskQueryResult
  ) {
    if (
      bounded.totalActiveTasks !== legacy.totalActiveTasks ||
      bounded.totalVisibleTasks !== legacy.totalVisibleTasks
    ) {
      return false;
    }

    return (
      JSON.stringify(bounded.tasks.map(task => this.watchTaskKey(task))) ===
      JSON.stringify(legacy.tasks.map(task => this.watchTaskKey(task)))
    );
  }

  private watchTaskKey(task: TaskEntity) {
    return {
      id: task.id,
      title: task.title,
      priority: task.priority,
      timerType: task.timerType,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      pinnedAt: task.pinnedAt?.toISOString() ?? null,
      intentionSlug: task.intentionSlug,
      subIntentionSlug: task.subIntentionSlug,
      followUpParent: task.followUpParent ?? null,
    };
  }

  async listIntentions(userId: string): Promise<WatchIntentionOption[]> {
    const [timer, preferences] = await Promise.all([
      this.timerService.getTimerByUserId(userId),
      this.preferencesService.getPreferences(userId),
    ]);
    const types = this.getIntentionPickerTypes(timer, preferences);
    const intentionGroups = await Promise.all(
      types.map(type =>
        this.intentionsService.getAllIntentions(userId, type, false, {
          includeSubIntentions: true,
        })
      )
    );

    return intentionGroups.flatMap(intentions => {
      const childrenByParentId = new Map<string, Intention[]>();
      intentions.forEach(intention => {
        if (!intention.parentIntentionId) return;
        const children =
          childrenByParentId.get(intention.parentIntentionId) ?? [];
        children.push(intention);
        childrenByParentId.set(intention.parentIntentionId, children);
      });

      return intentions
        .filter(intention => !intention.parentIntentionId)
        .map(intention => ({
          slug: intention.slug,
          title: intention.title,
          emoji: intention.emoji,
          type: intention.type,
          subIntentions: (childrenByParentId.get(intention.id) ?? []).map(
            child => ({
              slug: child.slug,
              title: child.title,
              emoji: child.emoji,
            })
          ),
        }));
    });
  }

  private async requiresIntentionSelectionForStart(
    userId: string,
    timer: Timer | null,
    preferences: Preferences
  ) {
    if (
      !preferences.intentionExtension ||
      !preferences.intentionRequireSelection
    ) {
      return false;
    }

    if (timer?.status === TIMER_STATUSES.RUNNING) {
      return false;
    }

    if (this.getNextTimerType(timer) !== TIMER_TYPES.WORK) {
      return false;
    }

    if (timer?.status !== TIMER_STATUSES.PAUSED) {
      return true;
    }

    const selectedIntentions = this.getTimerIntentions(timer);
    if (selectedIntentions.length === 0) {
      return true;
    }

    const selectedSubIntentions = timer?.subIntentions ?? {};
    const childGroups = await Promise.all(
      selectedIntentions.map(parentSlug =>
        this.intentionsService.getAllIntentions(userId, timer.type, false, {
          parentSlug,
        })
      )
    );

    return childGroups.some(
      (children, index) =>
        children.length > 0 && !selectedSubIntentions[selectedIntentions[index]]
    );
  }

  private formatAssistant(status: AssistantStatus): WatchAssistantSummary {
    return {
      assistantEnabled: status.assistantEnabled,
      speechCaptureEnabled: status.speechCaptureEnabled,
      aiTaskCaptureEnabled: status.aiTaskCaptureEnabled,
      assistantRecordingMaxMinutes: status.assistantRecordingMaxMinutes,
      usageBudgetPeriod: status.usageBudgetPeriod,
      usageBudgetCapUsd: status.usageBudgetCapUsd,
      usageBudgetUsedUsd: status.usageBudgetUsedUsd,
      usageBudgetRemainingUsd:
        status.usageBudgetCapUsd === null
          ? null
          : Math.max(0, status.usageBudgetCapUsd - status.usageBudgetUsedUsd),
    };
  }

  private formatTimer(
    timer: Timer | null,
    intentionsBySlug: IntentionLookup
  ): WatchTimerSummary | null {
    if (!timer) {
      return null;
    }

    const elapsed = timer.duration - timer.remainingTime;
    const progress =
      timer.duration <= 0
        ? 0
        : Math.min(1, Math.max(0, elapsed / timer.duration));

    return {
      id: timer.id,
      type: timer.type,
      status: timer.status,
      duration: timer.duration,
      remainingTime: timer.remainingTime,
      endsAtMs:
        timer.status === TIMER_STATUSES.RUNNING
          ? timer.startTime + timer.duration
          : null,
      progress,
      intentions: this.getTimerIntentions(timer).map(slug => {
        const subSlug = this.getTimerSubIntention(timer, slug);
        const intention = this.lookupIntention(
          intentionsBySlug,
          timer.type,
          slug
        );
        const subIntention = subSlug
          ? this.lookupIntention(intentionsBySlug, timer.type, subSlug)
          : undefined;

        return {
          slug,
          title:
            timer.intention === slug
              ? (timer.intentionTitle ?? intention?.title ?? null)
              : (intention?.title ?? null),
          emoji:
            timer.intentionEmojis?.[slug] ??
            (timer.intention === slug ? timer.intentionEmoji : undefined) ??
            intention?.emoji ??
            null,
          subSlug: subSlug ?? null,
          subTitle:
            timer.intention === slug
              ? (timer.subIntentionTitle ?? subIntention?.title ?? null)
              : (subIntention?.title ?? null),
          subEmoji:
            timer.subIntentionEmojis?.[slug] ??
            (timer.intention === slug ? timer.subIntentionEmoji : undefined) ??
            subIntention?.emoji ??
            null,
        };
      }),
      sessionPosition: timer.sessionPosition ?? null,
      sessionTotal: timer.sessionTotal ?? null,
      stackedSessions: timer.stackedSessions ?? null,
      isExtension: timer.isExtension === true,
    };
  }

  private buildTaskView(
    tasks: TaskEntity[],
    timer: Timer | null,
    mode: WatchTaskMode,
    now: Date,
    timeZone: string
  ) {
    const focusedOrder = this.getPinnedOrder(tasks);
    const hasTimerFilter = this.getTimerIntentions(timer).length > 0;
    const filteredTasks =
      mode === 'general' || !hasTimerFilter
        ? tasks
        : tasks.filter(
            task =>
              focusedOrder.has(task.id) ||
              this.isTaskLinkedToTimer(task, timer) ||
              !task.intentionSlug
          );
    const sortMode = mode === 'intention' && hasTimerFilter ? mode : 'general';
    return [...filteredTasks].sort((a, b) =>
      this.compareTasksForView(
        a,
        b,
        focusedOrder,
        timer,
        sortMode,
        now,
        timeZone
      )
    );
  }

  private formatTask(
    task: TaskEntity,
    timer: Timer | null,
    intentionsBySlug: IntentionLookup,
    now: Date,
    timeZone: string
  ): WatchTaskSummary {
    const intention = task.intentionSlug
      ? this.lookupIntention(
          intentionsBySlug,
          task.timerType,
          task.intentionSlug
        )
      : undefined;
    const subIntention = task.subIntentionSlug
      ? this.lookupIntention(
          intentionsBySlug,
          task.timerType,
          task.subIntentionSlug
        )
      : undefined;

    return {
      id: task.id,
      title: task.title,
      priority: task.priority,
      timerType: task.timerType,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      intentionSlug: task.intentionSlug,
      subIntentionSlug: task.subIntentionSlug,
      intentionTitle: intention?.title ?? null,
      intentionEmoji: intention?.emoji ?? null,
      subIntentionTitle: subIntention?.title ?? null,
      subIntentionEmoji: subIntention?.emoji ?? null,
      followUpParent: task.followUpParent ?? null,
      isFocused: task.pinnedAt !== null,
      isLinkedToTimer: this.isTaskLinkedToTimer(task, timer),
      isOverdue: this.isTaskOverdueAt(task, now, timeZone),
    };
  }

  private compareTasksForView(
    a: TaskEntity,
    b: TaskEntity,
    focusedOrder: Map<string, number>,
    timer: Timer | null,
    mode: WatchTaskMode,
    now: Date,
    timeZone: string
  ) {
    const aGroup = this.getTaskGroup(a, focusedOrder, timer, mode);
    const bGroup = this.getTaskGroup(b, focusedOrder, timer, mode);
    if (aGroup !== bGroup) {
      return aGroup - bGroup;
    }

    const aFocusOrder = focusedOrder.get(a.id);
    const bFocusOrder = focusedOrder.get(b.id);
    if (aFocusOrder !== undefined && bFocusOrder !== undefined) {
      return aFocusOrder - bFocusOrder;
    }

    return this.compareTasksByDueAndPriority(a, b, now, timeZone);
  }

  private getTaskGroup(
    task: TaskEntity,
    focusedOrder: Map<string, number>,
    timer: Timer | null,
    mode: WatchTaskMode
  ) {
    if (focusedOrder.has(task.id)) {
      return 0;
    }
    if (mode === 'general') {
      return 1;
    }
    if (this.isTaskLinkedToTimer(task, timer)) {
      return 1;
    }
    if (!task.intentionSlug) {
      return 2;
    }
    return 3;
  }

  private compareTasksByDueAndPriority(
    a: TaskEntity,
    b: TaskEntity,
    now: Date,
    timeZone: string
  ) {
    const aOverdue = this.isTaskOverdueAt(a, now, timeZone);
    const bOverdue = this.isTaskOverdueAt(b, now, timeZone);
    if (aOverdue !== bOverdue) {
      return aOverdue ? -1 : 1;
    }

    if (a.dueDate === null || b.dueDate === null) {
      if (a.dueDate !== b.dueDate) {
        return a.dueDate === null ? 1 : -1;
      }

      return (
        this.comparePriority(a, b) ||
        b.createdAt.getTime() - a.createdAt.getTime()
      );
    }

    if (aOverdue && bOverdue) {
      return (
        this.comparePriority(a, b) ||
        a.dueDate.localeCompare(b.dueDate) ||
        this.compareDueTime(a, b) ||
        a.createdAt.getTime() - b.createdAt.getTime()
      );
    }

    if (a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }

    return (
      this.compareDueTime(a, b) ||
      this.comparePriority(a, b) ||
      a.createdAt.getTime() - b.createdAt.getTime()
    );
  }

  private compareDueTime(a: TaskEntity, b: TaskEntity) {
    return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99');
  }

  private comparePriority(a: TaskEntity, b: TaskEntity) {
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  }

  private isTaskLinkedToTimer(task: TaskEntity, timer: Timer | null) {
    if (!task.intentionSlug || !timer || timer.type !== task.timerType) {
      return false;
    }

    if (!this.getTimerIntentions(timer).includes(task.intentionSlug)) {
      return false;
    }

    const timerSubIntention = this.getTimerSubIntention(
      timer,
      task.intentionSlug
    );
    if (!timerSubIntention) {
      return true;
    }

    return (
      !task.subIntentionSlug || task.subIntentionSlug === timerSubIntention
    );
  }

  private getPinnedOrder(tasks: TaskEntity[]) {
    return new Map(
      tasks
        .filter(task => task.pinnedAt !== null)
        .sort(
          (a, b) => (a.pinnedAt?.getTime() ?? 0) - (b.pinnedAt?.getTime() ?? 0)
        )
        .map((task, index) => [task.id, index])
    );
  }

  private getTimerIntentions(timer: Timer | null) {
    return timer?.intentionSlugs ?? (timer?.intention ? [timer.intention] : []);
  }

  private getTimerSubIntention(timer: Timer | null, slug: string) {
    if (!timer) return undefined;

    return (
      timer.subIntentions?.[slug] ??
      (timer.intention === slug ? timer.subIntention : undefined)
    );
  }

  private async loadIntentionsBySlug(
    userId: string,
    timer: Timer | null,
    tasks: TaskEntity[]
  ) {
    const slugsByType = new Map<TimerTypes, Set<string>>();
    const addSlug = (type: TimerTypes, slug: string | null | undefined) => {
      if (!slug) return;
      const slugs = slugsByType.get(type) ?? new Set<string>();
      slugs.add(slug);
      slugsByType.set(type, slugs);
    };

    if (timer) {
      this.getTimerIntentions(timer).forEach(slug => addSlug(timer.type, slug));
      Object.values(timer.subIntentions ?? {}).forEach(slug =>
        addSlug(timer.type, slug)
      );
      addSlug(timer.type, timer.subIntention);
    }
    tasks.forEach(task => {
      addSlug(task.timerType, task.intentionSlug);
      addSlug(task.timerType, task.subIntentionSlug);
    });

    const intentionGroups = await Promise.all(
      Array.from(slugsByType.entries()).map(async ([type, slugs]) => {
        const intentions = await this.intentionsService.getIntentionsBySlug(
          userId,
          Array.from(slugs),
          type
        );
        return Object.values(intentions);
      })
    );

    return intentionGroups.flat().reduce((lookup, intention) => {
      lookup[this.getIntentionLookupKey(intention.type, intention.slug)] =
        intention;
      return lookup;
    }, {} as IntentionLookup);
  }

  private isTaskOverdueAt(
    task: Pick<TaskEntity, 'dueDate' | 'dueTime'>,
    now: Date,
    timeZone = 'UTC'
  ) {
    if (!task.dueDate) {
      return false;
    }

    const normalizedTimeZone = this.normalizeTimeZone(timeZone);
    const dueDate = task.dueTime
      ? task.dueDate
      : this.addDaysToDateString(task.dueDate, 1);
    const dueBoundary = this.getDateTimeInTimeZone(
      dueDate,
      task.dueTime ?? '00:00',
      normalizedTimeZone
    );
    return now.getTime() > dueBoundary.getTime();
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
      return new Date(`${date}T${time}:00Z`);
    }
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

  private addDaysToDateString(date: string, days: number) {
    const [year, month, day] = date.split('-').map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day));
    nextDate.setUTCDate(nextDate.getUTCDate() + days);
    return nextDate.toISOString().slice(0, 10);
  }

  private normalizeTaskLimit(limit?: number) {
    if (limit === undefined || Number.isNaN(limit)) {
      return DEFAULT_TASK_LIMIT;
    }

    return Math.min(MAX_TASK_LIMIT, Math.max(0, limit));
  }

  private getNow() {
    return new Date();
  }

  private getIntentionPickerTypes(
    timer: Timer | null,
    preferences: Preferences
  ): TimerTypes[] {
    if (!preferences.intentionExtension) {
      return [];
    }

    const type =
      timer && timer.status !== TIMER_STATUSES.COMPLETED
        ? timer.type
        : this.getNextTimerType(timer);
    if (type === TIMER_TYPES.WORK) {
      return [TIMER_TYPES.WORK];
    }

    if (type === TIMER_TYPES.BREAK) {
      if (!preferences.intentionBreakIntentions) {
        return [];
      }

      return preferences.intentionShowBreakIntentionsInLongBreak
        ? [TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK]
        : [TIMER_TYPES.BREAK];
    }

    return preferences.intentionShowBreakIntentionsInLongBreak
      ? [TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK]
      : [TIMER_TYPES.LONG_BREAK];
  }

  private lookupIntention(
    lookup: IntentionLookup,
    type: TimerTypes,
    slug: string
  ) {
    return lookup[this.getIntentionLookupKey(type, slug)];
  }

  private getIntentionLookupKey(type: TimerTypes, slug: string) {
    return `${type}:${slug}`;
  }

  private getNextTimerType(timer: Timer | null): TimerTypes {
    if (!timer || timer.status === TIMER_STATUSES.COMPLETED) {
      return TIMER_TYPES.WORK;
    }

    if (timer.status === TIMER_STATUSES.PAUSED) {
      return timer.type;
    }

    return TIMER_TYPES.WORK;
  }
}
