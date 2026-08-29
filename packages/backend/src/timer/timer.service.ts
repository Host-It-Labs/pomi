import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import {
  TIMER_STATUSES,
  TIMER_TYPES,
  Timer,
  TimerExtensionCandidate,
  TimerExtensionResolutionAction,
  TimerExtensionState,
  TimerSkipLogMode,
  TimerTypes,
} from '@pomi/shared';
import { randomUUID } from 'crypto';
import { IntentionsService } from 'src/intentions/intentions.service';
import { isTransientDependencyError } from '../logging/dependency-errors';
import { PomiLogger } from '../logging/pomi-logger';
import { formatSafeError } from '../logging/sanitize-log';
import { PreferencesService } from '../preferences/preferences.service';
import {
  StatisticHistorySnapshot,
  StatisticsService,
} from '../statistics/statistics.service';
import { UsersService } from '../users/users.service';
import { TimerCountdownService } from './timer-countdown.service';
import type { TimerContinuationPlanV2 } from './timer-continuation-plan';
import { TimerEvents } from './timer-events';
import { TimerIdleService } from './timer-idle.service';
import {
  TestNotificationRequest,
  TimerNotificationService,
} from './timer-notification.service';
import { TimerSessionService } from './timer-session.service';
import {
  TimerHistoryEntry,
  TimerRuntimeSnapshot,
  TimerSessionState,
  TimerStore,
  TimerUndoState,
  TimerVersion,
  TimerWriteOptions,
  timerVersion,
} from './timer-store';

const EXTENSION_INCREMENT_MS = 5 * 60 * 1000;

type CreateOrResumeTimerOptions = {
  type: TimerTypes;
  intention?: string;
  intentions?: string[];
  subIntentions?: Record<string, string>;
  intentionEmoji?: string;
  startPaused?: boolean;
  isResetOrSkip?: boolean;
  preserveSessionState?: boolean;
  stackedSessions?: number;
  customDuration?: number;
  isAutoStarted?: boolean;
  extensionCandidate?: TimerExtensionCandidate;
  resetOnFirstIntention?: boolean;
  focusedTaskId?: string;
  focusedTaskIds?: string[];
  expectedVersion?: TimerVersion | null;
  sessionState?: TimerSessionState | null;
};

type ResolvedIntentionSelection = {
  intentionData: Record<string, any>;
  subIntentions: Record<string, string>;
  primaryIntention?: string;
  primarySubIntention?: string;
  primaryTitle?: string;
  primaryEmoji?: string;
  intentionEmojis: Record<string, string>;
  primarySubTitle?: string;
  primarySubEmoji?: string;
  subIntentionEmojis: Record<string, string>;
  customDuration?: number;
  customDurationSource?: 'parent' | 'sub';
};

export class TimerMutationOutcomeUnknownException extends ServiceUnavailableException {
  constructor(message: string) {
    super(message);
  }
}

@Injectable()
export class TimerService implements OnModuleInit {
  private readonly logger = new PomiLogger(TimerService.name);
  private readonly autoAdvanceTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly completingTimerIds = new Set<string>();
  public readonly onTimerUpdate = this.timerEvents.onTimerUpdate;
  public readonly onClientNotification = this.timerEvents.onClientNotification;
  public readonly onExtensionStateUpdate =
    this.timerEvents.onExtensionStateUpdate;
  public readonly onTimerHistoryUpdate = this.timerEvents.onTimerHistoryUpdate;

  constructor(
    private usersService: UsersService,
    @Inject(forwardRef(() => PreferencesService))
    private preferencesService: PreferencesService,
    private statisticsService: StatisticsService,
    private intentionsService: IntentionsService,
    private timerEvents: TimerEvents,
    private timerStore: TimerStore,
    private timerSessionService: TimerSessionService,
    @Inject(forwardRef(() => TimerCountdownService))
    private timerCountdownService: TimerCountdownService,
    private timerIdleService: TimerIdleService,
    private timerNotificationService: TimerNotificationService
  ) {}

  onModuleInit(): void {
    void this.restoreTimerRuntimeStateOnStartup().catch(error => {
      if (isTransientDependencyError(error)) {
        this.logger.warn(
          `Timer startup restoration deferred (${formatSafeError(error)})`
        );
      } else {
        this.logger.error('Failed to restore timer state on startup:', error);
      }
    });
  }

  private async commitCurrentTimer(
    userId: string,
    expected: TimerVersion | null,
    timer: Timer,
    options?: TimerWriteOptions
  ): Promise<Timer> {
    const write = await this.timerStore.replaceCurrentTimer(
      userId,
      expected,
      timer,
      options
    );
    if (write.kind === 'conflict') {
      throw new ConflictException('Timer changed while action was processing');
    }
    Object.assign(timer, write.timer);
    this.timerCountdownService.refreshCountdown(
      timer,
      this.handleTimerCompletion.bind(this)
    );
    return timer;
  }

  private async applyCommittedTimerTransition(
    userId: string,
    type: TimerTypes
  ): Promise<void> {
    this.clearAutoAdvance(userId);
    this.timerIdleService.cancelPausedTimerReminder(userId);
    if (type === TIMER_TYPES.WORK) {
      this.timerEvents.emitExtensionStateUpdate(userId, null);
    }
    if (type === TIMER_TYPES.LONG_BREAK) {
      this.timerIdleService.cancelIdleDetectionCheck(userId);
      await this.timerStore.clearLastCompletionTimestamp(userId);
    }
  }

  private normalizeSelectedIntentions(
    intention?: string,
    intentions?: string[]
  ): string[] {
    const values = Array.isArray(intentions)
      ? intentions
      : intention
        ? [intention]
        : [];

    return Array.from(
      new Set(values.map(value => value.trim()).filter(Boolean))
    );
  }

  private normalizeSelectedSubIntentions(
    selectedIntentions: string[],
    subIntentions?: Record<string, string>
  ): Record<string, string> {
    if (!subIntentions || typeof subIntentions !== 'object') {
      return {};
    }

    const selectedSet = new Set(selectedIntentions);
    return Object.fromEntries(
      Object.entries(subIntentions)
        .map(([parentSlug, subSlug]) => [parentSlug.trim(), subSlug.trim()])
        .filter(
          ([parentSlug, subSlug]) =>
            selectedSet.has(parentSlug) && Boolean(subSlug)
        )
    );
  }

  private getNextTimerTypeAfterWorkTimer(
    timer: Timer,
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>
  ): TimerTypes {
    if (
      preferences.sessionsExtension &&
      timer.sessionPosition &&
      timer.sessionTotal
    ) {
      const nextPosition = timer.sessionPosition + 1;

      if (nextPosition > timer.sessionTotal) {
        return preferences.sessionHasLongBreak
          ? TIMER_TYPES.LONG_BREAK
          : TIMER_TYPES.WORK;
      }
    }

    return TIMER_TYPES.BREAK;
  }

  private getExtensionNextTimerOptions(
    timer: Timer,
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>
  ): CreateOrResumeTimerOptions {
    const nextType = timer.extensionNextTimerType ?? TIMER_TYPES.BREAK;

    if (nextType === TIMER_TYPES.LONG_BREAK) {
      return {
        type: nextType,
        startPaused:
          timer.status === TIMER_STATUSES.PAUSED || !preferences.autoStartBreak,
        isAutoStarted:
          timer.status !== TIMER_STATUSES.PAUSED && preferences.autoStartBreak,
      };
    }

    if (nextType === TIMER_TYPES.WORK) {
      return {
        type: nextType,
        startPaused: true,
      };
    }

    return {
      type: nextType,
      startPaused:
        timer.status === TIMER_STATUSES.PAUSED || !preferences.autoStartBreak,
      isAutoStarted:
        timer.status !== TIMER_STATUSES.PAUSED && preferences.autoStartBreak,
      stackedSessions: timer.stackedSessions,
    };
  }

  private getTimerIntentions(timer?: Timer | null): string[] {
    if (!timer) {
      return [];
    }

    return this.normalizeSelectedIntentions(
      timer.intention,
      timer.intentionSlugs
    );
  }

  private getTimerSubIntentions(timer?: Timer | null): Record<string, string> {
    if (!timer?.subIntentions) {
      return {};
    }

    return this.normalizeSelectedSubIntentions(
      this.getTimerIntentions(timer),
      timer.subIntentions
    );
  }

  private getPrimaryIntention(
    selectedIntentions: string[]
  ): string | undefined {
    return selectedIntentions[0];
  }

  private getPrimarySubIntention(
    selectedIntentions: string[],
    subIntentions: Record<string, string>
  ): string | undefined {
    const primaryIntention = this.getPrimaryIntention(selectedIntentions);
    return primaryIntention ? subIntentions[primaryIntention] : undefined;
  }

  private areStringArraysEqual(previous: string[], next: string[]): boolean {
    if (previous.length !== next.length) {
      return false;
    }

    return previous.every((value, index) => value === next[index]);
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

  private getTimerDisplayEmoji(timer: Timer): string | undefined {
    const emoji = `${timer.intentionEmoji ?? ''}${timer.subIntentionEmoji ?? ''}`;
    return emoji || undefined;
  }

  private getElapsedDuration(timer: Timer): number {
    const rawElapsed =
      timer.status === TIMER_STATUSES.RUNNING
        ? Date.now() - timer.startTime
        : timer.duration - timer.remainingTime;

    return Math.min(timer.duration, Math.max(0, rawElapsed));
  }

  private hasStartedTimer(timer: Timer): boolean {
    return (
      timer.status === TIMER_STATUSES.RUNNING ||
      this.getElapsedDuration(timer) > 0
    );
  }

  private canTimerUseIntentions(
    type: TimerTypes,
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>
  ): boolean {
    return (
      type === TIMER_TYPES.WORK ||
      (type === TIMER_TYPES.BREAK && preferences.intentionBreakIntentions) ||
      type === TIMER_TYPES.LONG_BREAK
    );
  }

  private getAllowedIntentionTypes(
    type: TimerTypes,
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>
  ) {
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

    if (type === TIMER_TYPES.LONG_BREAK) {
      return preferences.intentionShowBreakIntentionsInLongBreak
        ? [TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK]
        : [TIMER_TYPES.LONG_BREAK];
    }

    return [];
  }

  private applySelectedIntentionsToTimer(
    timer: Timer,
    selectedIntentions: string[],
    primaryEmoji?: string,
    subIntentions?: Record<string, string>,
    primaryTitle?: string,
    primarySubEmoji?: string,
    primarySubTitle?: string,
    intentionEmojis?: Record<string, string>,
    subIntentionEmojis?: Record<string, string>
  ): void {
    const primaryIntention = this.getPrimaryIntention(selectedIntentions);
    const normalizedSubIntentions = this.normalizeSelectedSubIntentions(
      selectedIntentions,
      subIntentions
    );
    const primarySubIntention = this.getPrimarySubIntention(
      selectedIntentions,
      normalizedSubIntentions
    );

    timer.intentionSlugs =
      selectedIntentions.length > 0 ? selectedIntentions : undefined;
    timer.intention = primaryIntention;
    timer.subIntentions =
      Object.keys(normalizedSubIntentions).length > 0
        ? normalizedSubIntentions
        : undefined;
    timer.intentionTitle = primaryIntention ? primaryTitle : undefined;
    timer.intentionEmoji = primaryIntention
      ? (primaryEmoji ?? '❓')
      : undefined;
    timer.intentionEmojis =
      selectedIntentions.length > 0 && intentionEmojis
        ? intentionEmojis
        : undefined;
    timer.subIntention = primarySubIntention;
    timer.subIntentionTitle = primarySubIntention ? primarySubTitle : undefined;
    timer.subIntentionEmoji = primarySubIntention ? primarySubEmoji : undefined;
    timer.subIntentionEmojis =
      Object.keys(normalizedSubIntentions).length > 0 && subIntentionEmojis
        ? subIntentionEmojis
        : undefined;
  }

  private applyDurationPreservingElapsed(timer: Timer, duration: number): void {
    const elapsed = this.getElapsedDuration(timer);
    timer.duration = duration;
    timer.remainingTime = Math.max(0, duration - elapsed);
    if (timer.status === TIMER_STATUSES.RUNNING) {
      timer.startTime = Date.now() - Math.min(elapsed, duration);
    }
  }

  private shouldResetAutoStartedBreakOnFirstIntention(
    timer: Timer,
    previousIntentions: string[],
    nextIntentions: string[],
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>,
    resetRequested?: boolean
  ): boolean {
    return (
      resetRequested === true &&
      timer.status === TIMER_STATUSES.RUNNING &&
      timer.isAutoStarted === true &&
      (timer.type === TIMER_TYPES.BREAK ||
        timer.type === TIMER_TYPES.LONG_BREAK) &&
      timer.hasConsumedFirstIntentionReset !== true &&
      previousIntentions.length === 0 &&
      nextIntentions.length > 0 &&
      (timer.type === TIMER_TYPES.BREAK
        ? preferences.resetBreakOnFirstIntention
        : preferences.resetLongBreakOnFirstIntention)
    );
  }

  private resetAutoStartedBreakOnFirstIntention(
    timer: Timer,
    resetTimestamp: number
  ): void {
    timer.startTime = resetTimestamp;
    timer.remainingTime = timer.duration;
    timer.status = TIMER_STATUSES.RUNNING;
    timer.hasConsumedFirstIntentionReset = true;
  }

  private getDefaultTimerDuration(
    type: TimerTypes,
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>,
    stackedSessions: number | undefined
  ): number {
    if (type === TIMER_TYPES.WORK) {
      return preferences.workTimerDuration;
    }

    if (type === TIMER_TYPES.BREAK) {
      return preferences.breakTimerDuration * (stackedSessions || 1);
    }

    return preferences.sessionLongBreakDuration;
  }

  private async resolveIntentionSelection(
    userId: string,
    type: TimerTypes,
    selectedIntentions: string[],
    rawSubIntentions: Record<string, string> | undefined,
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>,
    providedEmoji?: string
  ): Promise<ResolvedIntentionSelection> {
    const subIntentions = this.normalizeSelectedSubIntentions(
      selectedIntentions,
      rawSubIntentions
    );
    const intentionData =
      await this.intentionsService.validateSubIntentionSelection(
        userId,
        selectedIntentions,
        subIntentions,
        this.getAllowedIntentionTypes(type, preferences)
      );

    const primaryIntention = this.getPrimaryIntention(selectedIntentions);
    const primarySubIntention = this.getPrimarySubIntention(
      selectedIntentions,
      subIntentions
    );
    const primaryInfo = primaryIntention
      ? intentionData[primaryIntention]
      : undefined;
    const primarySubInfo = primarySubIntention
      ? intentionData[primarySubIntention]
      : undefined;
    const intentionEmojis = Object.fromEntries(
      selectedIntentions.map(slug => [
        slug,
        slug === primaryIntention && providedEmoji
          ? providedEmoji
          : (intentionData[slug]?.emoji ?? '❓'),
      ])
    );
    const subIntentionEmojiEntries = Object.entries(subIntentions)
      .map(([parentSlug, subSlug]): [string, string | undefined] => [
        parentSlug,
        intentionData[subSlug]?.emoji,
      ])
      .filter((entry): entry is [string, string] => Boolean(entry[1]));
    const subIntentionEmojis = Object.fromEntries(subIntentionEmojiEntries);

    let customDuration: number | undefined;
    let customDurationSource: 'parent' | 'sub' | undefined;
    if (preferences.intentionCustomDurations) {
      if (primarySubInfo?.hasCustomDuration && primarySubInfo.customDuration) {
        customDuration = primarySubInfo.customDuration;
        customDurationSource = 'sub';
      } else if (
        selectedIntentions.length === 1 &&
        primaryInfo?.hasCustomDuration &&
        primaryInfo.customDuration
      ) {
        customDuration = primaryInfo.customDuration;
        customDurationSource = 'parent';
      }
    }

    return {
      intentionData,
      subIntentions,
      primaryIntention,
      primarySubIntention,
      primaryTitle: primaryInfo?.title,
      primaryEmoji: providedEmoji ?? primaryInfo?.emoji ?? '❓',
      intentionEmojis,
      primarySubTitle: primarySubInfo?.title,
      primarySubEmoji: primarySubInfo?.emoji,
      subIntentionEmojis,
      customDuration,
      customDurationSource,
    };
  }

  async getTimerByUserId(userId: string): Promise<Timer | null> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer) return null;

    if (timer.status === TIMER_STATUSES.RUNNING) {
      const remainingTime = timer.duration - (Date.now() - timer.startTime);
      if (remainingTime <= 0) {
        await this.handleTimerCompletion(timer);
        return this.timerStore.getCurrentTimer(userId);
      }

      timer.remainingTime = remainingTime;
    }

    return timer;
  }

  async selectTimerIntention(
    userId: string,
    type: TimerTypes,
    intentionSlug: string,
    subIntentions?: Record<string, string>,
    resetOnFirstIntention?: boolean
  ): Promise<Timer> {
    return this.selectTimerIntentions(
      userId,
      type,
      [intentionSlug],
      subIntentions,
      resetOnFirstIntention
    );
  }

  async selectTimerIntentions(
    userId: string,
    type: TimerTypes,
    intentionSlugs: string[],
    subIntentions?: Record<string, string>,
    resetOnFirstIntention?: boolean
  ): Promise<Timer> {
    const selectedIntentions = Array.from(
      new Set(intentionSlugs.map(slug => slug.trim()).filter(Boolean))
    );
    if (intentionSlugs.length > 0 && selectedIntentions.length === 0) {
      throw new BadRequestException('Intention is required');
    }

    const [timer, preferences] = await Promise.all([
      this.getTimerByUserId(userId),
      this.preferencesService.getPreferences(userId),
    ]);

    if (!this.canTimerUseIntentions(type, preferences)) {
      throw new BadRequestException(
        'Intentions are unavailable for this timer'
      );
    }
    if (!preferences.intentionMultiSelect && selectedIntentions.length > 1) {
      throw new BadRequestException('Multiple intentions are disabled');
    }
    if (
      preferences.intentionRequireSelection &&
      type === TIMER_TYPES.WORK &&
      selectedIntentions.length === 0
    ) {
      throw new BadRequestException('Intention is required for work timers');
    }

    const selectedSubIntentions = Object.fromEntries(
      Object.entries(subIntentions ?? {}).filter(([parentSlug]) =>
        selectedIntentions.includes(parentSlug)
      )
    );

    if (
      !timer ||
      timer.status === TIMER_STATUSES.COMPLETED ||
      timer.type !== type
    ) {
      return this.createOrResumeTimer(userId, {
        type,
        intention: selectedIntentions[0],
        intentions: selectedIntentions,
        subIntentions: selectedSubIntentions,
        startPaused: true,
      });
    }

    const before = await this.snapshotRuntime(userId);
    const expected = timerVersion(timer);
    const previousIntentions = this.getTimerIntentions(timer);
    const previousSubIntentions = this.getTimerSubIntentions(timer);
    const wasRunning = timer.status === TIMER_STATUSES.RUNNING;
    const timerNotStarted =
      !wasRunning && timer.remainingTime === timer.duration;
    this.refreshRunningTimerRemainingTime(timer);
    const shouldResetOnFirstIntention =
      wasRunning &&
      this.shouldResetAutoStartedBreakOnFirstIntention(
        timer,
        previousIntentions,
        selectedIntentions,
        preferences,
        resetOnFirstIntention
      );
    const resetTimestamp = shouldResetOnFirstIntention ? Date.now() : null;

    if (selectedIntentions.length === 0) {
      this.applySelectedIntentionsToTimer(timer, []);
      if (timerNotStarted && preferences.intentionCustomDurations) {
        timer.duration = this.getDefaultTimerDuration(
          timer.type,
          preferences,
          timer.stackedSessions
        );
        timer.remainingTime = timer.duration;
      }
    } else {
      const selection = await this.resolveIntentionSelection(
        userId,
        timer.type,
        selectedIntentions,
        selectedSubIntentions,
        preferences
      );

      this.applySelectedIntentionsToTimer(
        timer,
        selectedIntentions,
        selection.primaryEmoji,
        selection.subIntentions,
        selection.primaryTitle,
        selection.primarySubEmoji,
        selection.primarySubTitle,
        selection.intentionEmojis,
        selection.subIntentionEmojis
      );

      if (timerNotStarted && preferences.intentionCustomDurations) {
        const defaultDuration = this.getDefaultTimerDuration(
          timer.type,
          preferences,
          timer.stackedSessions
        );
        timer.duration = selection.customDuration ?? defaultDuration;
        timer.remainingTime = timer.duration;
      } else if (
        selection.customDurationSource === 'sub' &&
        selection.customDuration
      ) {
        this.applyDurationPreservingElapsed(timer, selection.customDuration);
      }
    }

    if (resetTimestamp !== null) {
      this.resetAutoStartedBreakOnFirstIntention(timer, resetTimestamp);
    }

    await this.commitCurrentTimer(
      userId,
      expected,
      timer,
      resetTimestamp !== null ? { extensionState: null } : undefined
    );
    if (resetTimestamp !== null) {
      this.timerEvents.emitExtensionStateUpdate(userId, null);
    }
    this.timerEvents.emitTimerUpdate(userId, timer);

    const nextIntentions = this.getTimerIntentions(timer);
    const nextSubIntentions = this.getTimerSubIntentions(timer);
    if (
      !this.areStringArraysEqual(previousIntentions, nextIntentions) ||
      !this.areSubIntentionMapsEqual(previousSubIntentions, nextSubIntentions)
    ) {
      const entry = await this.buildHistoryEntry(
        userId,
        'Change intention',
        before
      );
      await this.pushTimerHistory(entry, userId);
    }

    return timer;
  }

  async sendTestNotification(request: TestNotificationRequest): Promise<void> {
    await this.timerNotificationService.sendTestNotification(request);
  }

  async applySessionToCurrentTimer(userId: string): Promise<Timer | null> {
    const timer =
      await this.timerSessionService.applySessionToCurrentTimer(userId);
    if (timer) {
      this.timerCountdownService.refreshCountdown(
        timer,
        this.handleTimerCompletion.bind(this)
      );
    }
    return timer;
  }

  async updateSessionTotal(userId: string): Promise<Timer | null> {
    const timer = await this.timerSessionService.updateSessionTotal(userId);
    if (timer) {
      this.timerCountdownService.refreshCountdown(
        timer,
        this.handleTimerCompletion.bind(this)
      );
    }
    return timer;
  }

  async setSessionPosition(
    userId: string,
    position: number
  ): Promise<Timer | null> {
    const before = await this.snapshotRuntime(userId);
    const timer = await this.timerSessionService.setSessionPosition(
      userId,
      position
    );

    if (timer) {
      this.timerCountdownService.refreshCountdown(
        timer,
        this.handleTimerCompletion.bind(this)
      );
      const entry = await this.buildHistoryEntry(
        userId,
        'Change session position',
        before
      );
      await this.pushTimerHistory(entry, userId);
    }

    return timer;
  }

  async resetTimer(userId: string): Promise<Timer | null> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer) {
      return null;
    }
    const expectedVersion = timerVersion(timer);

    const before = await this.snapshotRuntime(userId);
    let resetSessionState: TimerSessionState | undefined;

    // Handle stacked timer reset - restore original session count
    if (
      timer.stackedSessions &&
      timer.stackedSessions > 1 &&
      timer.sessionTotal
    ) {
      const sessionsToRestore =
        timer.stackedSessionPlanReduction ?? timer.stackedSessions - 1;
      const newSessionTotal = timer.sessionTotal + sessionsToRestore;

      const sessionState = await this.timerStore.getSessionState(userId);
      if (sessionState) {
        resetSessionState = {
          currentPosition: sessionState.currentPosition,
          totalPomodoros: newSessionTotal,
          ...(sessionState.completedIntentionEmojis && {
            completedIntentionEmojis: sessionState.completedIntentionEmojis,
          }),
        };
      }
    }

    const selectedIntentions = this.getTimerIntentions(timer);
    const selectedSubIntentions = this.getTimerSubIntentions(timer);
    const preferences = await this.preferencesService.getPreferences(userId);
    let customDuration: number | undefined;

    if (
      selectedIntentions.length > 0 &&
      preferences.intentionCustomDurations &&
      this.canTimerUseIntentions(timer.type, preferences)
    ) {
      const selection = await this.resolveIntentionSelection(
        userId,
        timer.type,
        selectedIntentions,
        selectedSubIntentions,
        preferences
      );
      customDuration = selection.customDuration;
    }

    const result = await this.createOrResumeTimer(userId, {
      type: timer.type,
      intention: this.getPrimaryIntention(selectedIntentions),
      intentions: selectedIntentions,
      subIntentions: selectedSubIntentions,
      startPaused: timer.status === TIMER_STATUSES.PAUSED,
      isResetOrSkip: true,
      preserveSessionState: true,
      customDuration,
      expectedVersion,
      sessionState: resetSessionState,
    });

    const entry = await this.buildHistoryEntry(userId, 'Reset timer', before);
    await this.pushTimerHistory(entry, userId);
    return result;
  }

  async pauseTimer(userId: string): Promise<Timer | null> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer) {
      return null;
    }
    if (timer.status !== TIMER_STATUSES.RUNNING) {
      if (
        timer.status === TIMER_STATUSES.PAUSED &&
        timer.type === TIMER_TYPES.WORK &&
        !timer.hasNotifiedPausedTimerReminder
      ) {
        this.timerIdleService.schedulePausedTimerReminder(userId, timer.id);
      }
      return timer;
    }

    const expected = timerVersion(timer);
    const pauseTimestamp = Date.now();
    timer.status = TIMER_STATUSES.PAUSED;
    const elapsedTime = pauseTimestamp - timer.startTime;
    timer.remainingTime = Math.max(0, timer.duration - elapsedTime);
    timer.hasNotifiedPausedTimerReminder = false;

    const extensionState =
      timer.isAutoStarted === true &&
      (timer.type === TIMER_TYPES.BREAK ||
        timer.type === TIMER_TYPES.LONG_BREAK) &&
      timer.extensionCandidate
        ? {
            extensionState: {
              ...timer.extensionCandidate,
              startTime: pauseTimestamp,
            },
          }
        : undefined;
    await this.commitCurrentTimer(userId, expected, timer, extensionState);
    this.timerCountdownService.stopCountdown(userId);
    if (timer.type === TIMER_TYPES.WORK) {
      this.timerIdleService.schedulePausedTimerReminder(userId, timer.id);
    } else {
      this.timerIdleService.cancelPausedTimerReminder(userId);
    }

    if (extensionState?.extensionState) {
      this.timerEvents.emitExtensionStateUpdate(
        userId,
        extensionState.extensionState
      );
    }
    this.timerEvents.emitTimerUpdate(userId, timer);

    return timer;
  }

  async skipTimer(
    userId: string,
    requestedLogMode?: TimerSkipLogMode
  ): Promise<Timer | null> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer) {
      return null;
    }
    const expectedVersion = timerVersion(timer);
    const before = await this.snapshotRuntime(userId);

    const selectedIntentions = this.getTimerIntentions(timer);
    const selectedSubIntentions = this.getTimerSubIntentions(timer);
    const nextRequestedLogMode = requestedLogMode ?? 'none';

    const preferences = await this.preferencesService.getPreferences(userId);
    const logMode =
      preferences.advancedSkip && this.hasStartedTimer(timer)
        ? nextRequestedLogMode
        : 'none';
    const shouldLogDuration = logMode !== 'none';

    let logDuration = 0;
    let historyLogEffect: TimerHistoryEntry['logEffect'];
    let historyStatisticIds: string[] = [];
    let undoMetadata: TimerUndoState['metadata'] = {
      action: 'skip',
    };

    if (shouldLogDuration) {
      logDuration =
        logMode === 'full' ? timer.duration : this.getElapsedDuration(timer);

      if (logDuration > 0) {
        if (timer.isExtension && timer.extensionOriginalTimerId) {
          const statisticSnapshot =
            await this.statisticsService.getStatisticUndoSnapshot(
              userId,
              timer.extensionOriginalTimerId
            );

          if (statisticSnapshot) {
            undoMetadata = {
              action: 'skip',
              statisticTimerId: timer.extensionOriginalTimerId,
              statisticType: timer.type,
              statisticIntention: timer.intention,
              statisticIntentions: selectedIntentions,
              statisticSubIntentions: selectedSubIntentions,
              statisticUndoMode: 'restore',
              statisticOriginalDuration: statisticSnapshot.duration,
              statisticOriginalCompletedAt: statisticSnapshot.completedAt,
            };
            historyStatisticIds = [timer.extensionOriginalTimerId];
            historyLogEffect = 'updated';
          }
        } else {
          undoMetadata = {
            action: 'skip',
            statisticTimerId: timer.id,
            statisticType: timer.type,
            statisticIntention: timer.intention,
            statisticIntentions: selectedIntentions,
            statisticSubIntentions: selectedSubIntentions,
            statisticUndoMode: 'remove',
          };
          historyStatisticIds = [timer.id];
          historyLogEffect = 'added';
        }
      }
    }

    void undoMetadata;
    const statisticBeforeSnapshots = await this.snapshotStatistics(
      userId,
      historyStatisticIds
    );

    const recordHistory = async <T extends Timer | null>(
      result: T
    ): Promise<T> => {
      try {
        if (shouldLogDuration && logDuration > 0) {
          if (timer.isExtension && timer.extensionOriginalTimerId) {
            await this.statisticsService.appendDurationToStatistic(
              userId,
              timer.extensionOriginalTimerId,
              logDuration,
              timer.intention
            );
          } else {
            await this.statisticsService.recordCompletedTimer(userId, {
              ...timer,
              remainingTime: Math.max(0, timer.duration - logDuration),
            });
          }
          if (selectedIntentions.length > 0) {
            await Promise.all([
              this.intentionsService.incrementIntentionsUsage(
                userId,
                selectedIntentions
              ),
              this.intentionsService.incrementSubIntentionsUsage(
                userId,
                selectedSubIntentions
              ),
            ]);
          }
        }
        const entry = await this.buildHistoryEntry(
          userId,
          'Skip timer',
          before,
          statisticBeforeSnapshots,
          historyStatisticIds,
          historyLogEffect
        );
        await this.pushTimerHistory(entry, userId);
        return result;
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : 'Timer follow-up effects failed';
        throw new TimerMutationOutcomeUnknownException(
          `Timer changed, but follow-up effects could not be confirmed: ${reason}`
        );
      }
    };

    // If it's a work timer being skipped, handle session progression
    if (timer.type === TIMER_TYPES.WORK) {
      if (timer.isExtension) {
        return recordHistory(
          await this.createOrResumeTimer(userId, {
            ...this.getExtensionNextTimerOptions(timer, preferences),
            expectedVersion,
          })
        );
      }

      // Handle session progression if sessions are enabled
      if (
        preferences.sessionsExtension &&
        timer.sessionPosition &&
        timer.sessionTotal
      ) {
        const nextPosition = timer.sessionPosition + 1;

        if (nextPosition > timer.sessionTotal) {
          // Session completed - start long break if enabled
          if (preferences.sessionHasLongBreak) {
            return recordHistory(
              await this.createOrResumeTimer(userId, {
                type: TIMER_TYPES.LONG_BREAK,
                startPaused:
                  timer.status === TIMER_STATUSES.PAUSED ||
                  !preferences.autoStartBreak,
                isAutoStarted:
                  timer.status !== TIMER_STATUSES.PAUSED &&
                  preferences.autoStartBreak,
                extensionCandidate: this.buildExtensionCandidate(
                  timer,
                  preferences,
                  TIMER_TYPES.LONG_BREAK
                ),
                expectedVersion,
                sessionState: null,
              })
            );
          } else {
            // Reset session and start new work timer
            return recordHistory(
              await this.createOrResumeTimer(userId, {
                type: TIMER_TYPES.WORK,
                startPaused: true,
                expectedVersion,
                sessionState: null,
              })
            );
          }
        } else {
          // Continue with session - update position and start break
          const timerDisplayEmoji = this.getTimerDisplayEmoji(timer);
          const completedIntentionEmojis = {
            ...(timer.sessionIntentionEmojis ?? {}),
            ...(timerDisplayEmoji && timer.sessionPosition
              ? { [timer.sessionPosition]: timerDisplayEmoji }
              : {}),
          };
          const nextSessionState: TimerSessionState = {
            currentPosition: nextPosition,
            totalPomodoros: timer.sessionTotal,
            stackedSessions: timer.stackedSessions,
            completedIntentionEmojis,
          };
          return recordHistory(
            await this.createOrResumeTimer(userId, {
              type: TIMER_TYPES.BREAK,
              startPaused:
                timer.status === TIMER_STATUSES.PAUSED ||
                !preferences.autoStartBreak,
              isAutoStarted:
                timer.status !== TIMER_STATUSES.PAUSED &&
                preferences.autoStartBreak,
              extensionCandidate: this.buildExtensionCandidate(
                timer,
                preferences,
                TIMER_TYPES.BREAK
              ),
              stackedSessions: timer.stackedSessions,
              expectedVersion,
              sessionState: nextSessionState,
            })
          );
        }
      }
    }

    // For break or long break timers being skipped
    let nextType: TimerTypes =
      timer.type === TIMER_TYPES.WORK ? TIMER_TYPES.BREAK : TIMER_TYPES.WORK;

    // If skipping a long break, start a new work session
    if (timer.type === TIMER_TYPES.LONG_BREAK) {
      nextType = TIMER_TYPES.WORK;
    }

    // Only use isResetOrSkip if we're not in an active session
    // If sessions are enabled and we're skipping a break back to work,
    // we want to continue the session, not reset it
    const shouldResetSession = !(
      preferences.sessionsExtension &&
      timer.type === TIMER_TYPES.BREAK &&
      nextType === TIMER_TYPES.WORK
    );

    const hasWorkIntention =
      timer.type === TIMER_TYPES.WORK && selectedIntentions.length > 0;

    const shouldPauseForWork =
      preferences.intentionExtension &&
      preferences.intentionRequireSelection &&
      nextType === TIMER_TYPES.WORK &&
      !hasWorkIntention;

    const shouldPauseForBreak =
      nextType === TIMER_TYPES.BREAK && !preferences.autoStartBreak;

    const shouldStartPaused =
      timer.status === TIMER_STATUSES.PAUSED ||
      shouldPauseForWork ||
      shouldPauseForBreak;

    const nextIntentions =
      nextType === timer.type ? selectedIntentions : undefined;
    const nextSubIntentions =
      nextType === timer.type ? selectedSubIntentions : undefined;

    return recordHistory(
      await this.createOrResumeTimer(userId, {
        type: nextType,
        intention: this.getPrimaryIntention(nextIntentions ?? []),
        intentions: nextIntentions,
        subIntentions: nextSubIntentions,
        startPaused: shouldStartPaused,
        isAutoStarted:
          nextType === TIMER_TYPES.BREAK &&
          !shouldStartPaused &&
          preferences.autoStartBreak,
        extensionCandidate:
          nextType === TIMER_TYPES.BREAK
            ? this.buildExtensionCandidate(
                timer,
                preferences,
                TIMER_TYPES.BREAK
              )
            : undefined,
        isResetOrSkip: shouldResetSession,
        stackedSessions:
          nextType === TIMER_TYPES.BREAK ? timer.stackedSessions : undefined,
        expectedVersion,
      })
    );
  }

  async addFiveMinutesTimer(userId: string): Promise<Timer | null> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer) {
      return null;
    }
    const expected = timerVersion(timer);
    const preferences = await this.preferencesService.getPreferences(userId);

    const before = await this.snapshotRuntime(userId);

    // For running timers, calculate the actual remaining time based on elapsed time
    if (timer.status === TIMER_STATUSES.RUNNING) {
      timer.remainingTime = Math.max(
        0,
        timer.duration - (Date.now() - timer.startTime)
      );
    }

    timer.duration += 300000;
    timer.remainingTime += 300000;
    if (
      timer.type === TIMER_TYPES.WORK &&
      !timer.isExtension &&
      timer.hasNotifiedBeforeTimeNotification &&
      timer.remainingTime > preferences.notifyBeforeTime
    ) {
      timer.hasNotifiedBeforeTimeNotification = false;
    }
    if (
      timer.type === TIMER_TYPES.WORK &&
      timer.sessionPosition &&
      timer.sessionTotal &&
      !timer.originalDuration
    ) {
      timer.originalDuration = timer.duration - 300000;
    }

    await this.commitCurrentTimer(userId, expected, timer);
    this.timerEvents.emitTimerUpdate(userId ?? 'unknown', timer);
    const entry = await this.buildHistoryEntry(userId, 'Add 5 minutes', before);
    await this.pushTimerHistory(entry, userId);
    return timer;
  }

  async startLongBreakTimer(userId: string): Promise<Timer> {
    const current = await this.timerStore.getCurrentTimer(userId);
    const expectedVersion = current ? timerVersion(current) : null;
    const before = await this.snapshotRuntime(userId);
    const timer = await this.createOrResumeTimer(userId, {
      type: TIMER_TYPES.LONG_BREAK,
      expectedVersion,
      sessionState: null,
    });
    const entry = await this.buildHistoryEntry(
      userId,
      'Start long break',
      before
    );
    await this.pushTimerHistory(entry, userId);
    return timer;
  }

  async convertLongBreakToBreak(userId: string): Promise<Timer> {
    const current = await this.timerStore.getCurrentTimer(userId);
    if (!current || current.type !== TIMER_TYPES.LONG_BREAK) {
      throw new BadRequestException('A Long break is required');
    }
    const preferences = await this.preferencesService.getPreferences(userId);
    if (!preferences.longBreakToBreakEnabled) {
      throw new BadRequestException('Long break conversion is not enabled');
    }
    const before = await this.snapshotRuntime(userId);
    const timer = await this.createOrResumeTimer(userId, {
      type: TIMER_TYPES.BREAK,
      intentions: [],
      subIntentions: {},
      isResetOrSkip: true,
      preserveSessionState: true,
      expectedVersion: timerVersion(current),
    });
    const entry = await this.buildHistoryEntry(
      userId,
      'Convert Long break to Break',
      before
    );
    await this.pushTimerHistory(entry, userId);
    return timer;
  }

  async undoLastTimerAction(userId: string): Promise<Timer | null> {
    let current: Timer | null = null;
    let candidate: Awaited<ReturnType<TimerStore['peekUndoHistoryCandidate']>> =
      null;
    let runtimeRevision: string | null = null;
    let hasStableSnapshot = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const beforeRevision = await this.timerStore.getRuntimeRevision(userId);
      current = await this.timerStore.getCurrentTimer(userId);
      candidate = await this.timerStore.peekUndoHistoryCandidate(userId);
      const afterRevision = await this.timerStore.getRuntimeRevision(userId);
      if (beforeRevision === afterRevision) {
        runtimeRevision = afterRevision;
        hasStableSnapshot = true;
        break;
      }
    }
    if (!candidate) {
      throw new BadRequestException('No timer action available to undo');
    }
    const { entry } = candidate;
    if (!hasStableSnapshot) {
      throw new ConflictException('Timer state kept changing during undo');
    }
    const expected = current ? timerVersion(current) : null;

    const timer = await this.restoreRuntimeSnapshot(
      userId,
      entry.before,
      expected,
      runtimeRevision,
      { direction: 'undo', serializedEntry: candidate.serializedEntry }
    );
    for (const statistic of entry.statistics ?? []) {
      await this.statisticsService.restoreStatisticHistorySnapshot(
        userId,
        statistic.after,
        statistic.before
      );
    }

    await this.emitTimerHistoryStatus(userId, {
      direction: 'undo',
      label: entry.label,
      logEffect: entry.logEffect,
    });

    return timer;
  }

  async redoLastTimerAction(userId: string): Promise<Timer | null> {
    let current: Timer | null = null;
    let candidate: Awaited<ReturnType<TimerStore['peekRedoHistoryCandidate']>> =
      null;
    let runtimeRevision: string | null = null;
    let hasStableSnapshot = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const beforeRevision = await this.timerStore.getRuntimeRevision(userId);
      current = await this.timerStore.getCurrentTimer(userId);
      candidate = await this.timerStore.peekRedoHistoryCandidate(userId);
      const afterRevision = await this.timerStore.getRuntimeRevision(userId);
      if (beforeRevision === afterRevision) {
        runtimeRevision = afterRevision;
        hasStableSnapshot = true;
        break;
      }
    }
    if (!candidate) {
      throw new BadRequestException('No timer action available to redo');
    }
    const { entry } = candidate;
    if (!hasStableSnapshot) {
      throw new ConflictException('Timer state kept changing during redo');
    }
    const expected = current ? timerVersion(current) : null;

    const timer = await this.restoreRuntimeSnapshot(
      userId,
      entry.after,
      expected,
      runtimeRevision,
      { direction: 'redo', serializedEntry: candidate.serializedEntry }
    );
    for (const statistic of entry.statistics ?? []) {
      await this.statisticsService.restoreStatisticHistorySnapshot(
        userId,
        statistic.before,
        statistic.after
      );
    }

    await this.emitTimerHistoryStatus(userId, {
      direction: 'redo',
      label: entry.label,
      logEffect: entry.logEffect,
    });

    return timer;
  }

  async stackTimer(userId: string): Promise<Timer | { error: string }> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer) {
      return { error: 'No active timer' };
    }
    const expected = timerVersion(timer);
    const before = await this.snapshotRuntime(userId);
    const preferences = await this.preferencesService.getPreferences(userId);

    if (!preferences.sessionsExtension || !preferences.sessionStackTimers) {
      return { error: 'Timer stacking is not enabled' };
    }

    if (timer.type !== TIMER_TYPES.WORK) {
      return { error: 'Can only stack work timers' };
    }

    if (!timer.sessionPosition || !timer.sessionTotal) {
      return { error: 'No session information available' };
    }

    if (timer.sessionPosition > timer.sessionTotal) {
      return { error: 'Invalid session position' };
    }

    // For running timers, calculate the actual remaining time
    if (timer.status === TIMER_STATUSES.RUNNING) {
      timer.remainingTime = Math.max(
        0,
        timer.duration - (Date.now() - timer.startTime)
      );
    }

    let additionalDuration =
      timer.originalDuration ?? preferences.workTimerDuration;

    if (!timer.originalDuration) {
      const selectedIntentions = this.getTimerIntentions(timer);
      const selectedSubIntentions = this.getTimerSubIntentions(timer);
      if (
        selectedIntentions.length > 0 &&
        preferences.intentionCustomDurations
      ) {
        const selection = await this.resolveIntentionSelection(
          userId,
          timer.type,
          selectedIntentions,
          selectedSubIntentions,
          preferences
        );

        if (selection.customDuration) {
          additionalDuration = selection.customDuration;
        }
      }

      timer.originalDuration = additionalDuration;
      timer.originalBreakDuration = preferences.breakTimerDuration;
    } else {
      additionalDuration = timer.originalDuration;
    }

    // Add one full stacked session using the timer's base duration.
    timer.duration += additionalDuration;
    timer.remainingTime += additionalDuration;

    // Track stacked sessions
    timer.stackedSessions = (timer.stackedSessions || 1) + 1;

    // A future planned session is consumed when it is merged. At the final
    // position the extra duration is appended without adding another timer.
    timer.stackedSessionPlanReduction ??= 0;
    if (timer.sessionPosition < timer.sessionTotal) {
      timer.sessionTotal -= 1;
      timer.stackedSessionPlanReduction += 1;
    }

    // Update session state in Redis with stacked sessions
    const sessionState = await this.timerStore.getSessionState(userId);
    const nextSessionState = sessionState
      ? {
          ...sessionState,
          totalPomodoros: timer.sessionTotal,
          stackedSessions: timer.stackedSessions,
        }
      : null;

    // Update timer start time to account for added duration
    if (timer.status === TIMER_STATUSES.RUNNING) {
      const elapsedTime = timer.duration - timer.remainingTime;
      timer.startTime = Date.now() - elapsedTime;
    }

    await this.commitCurrentTimer(
      userId,
      expected,
      timer,
      nextSessionState ? { sessionState: nextSessionState } : undefined
    );
    this.timerEvents.emitTimerUpdate(userId, timer);
    const entry = await this.buildHistoryEntry(userId, 'Stack timer', before);
    await this.pushTimerHistory(entry, userId);
    return timer;
  }

  async getExtensionState(userId: string): Promise<TimerExtensionState | null> {
    return this.timerStore.getExtensionState(userId);
  }

  async getTimerHistoryStatus(
    userId: string
  ): Promise<{ canUndo: boolean; canRedo: boolean }> {
    return this.timerStore.getTimerHistoryStatus(userId);
  }

  async clearTimerHistory(userId: string): Promise<void> {
    await this.timerStore.clearTimerHistory(userId);
    await this.emitTimerHistoryStatus(userId);
  }

  private async snapshotRuntime(userId: string): Promise<TimerRuntimeSnapshot> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    const normalizedTimer =
      timer?.status === TIMER_STATUSES.RUNNING
        ? {
            ...timer,
            remainingTime: Math.max(
              0,
              timer.duration - (Date.now() - timer.startTime)
            ),
          }
        : timer;

    return {
      timer: normalizedTimer,
      sessionState: await this.timerStore.getSessionState(userId),
      lastCompletionTimestamp:
        await this.timerStore.getLastCompletionTimestamp(userId),
      idleDetected: await this.timerStore.isIdleDetected(userId),
      extensionState: await this.timerStore.getExtensionState(userId),
    };
  }

  private async restoreRuntimeSnapshot(
    userId: string,
    snapshot: TimerRuntimeSnapshot,
    expected: TimerVersion | null,
    expectedRuntimeRevision?: string | null,
    historyTransition?: TimerWriteOptions['historyTransition']
  ): Promise<Timer | null> {
    let timer: Timer | null = null;
    if (snapshot.timer) {
      const savedRemainingTime = Math.max(0, snapshot.timer.remainingTime);
      timer = {
        ...snapshot.timer,
        remainingTime: savedRemainingTime,
      };
      if (timer.status === TIMER_STATUSES.RUNNING) {
        const elapsed = Math.max(0, timer.duration - savedRemainingTime);
        timer.startTime = Date.now() - elapsed;
      }
      await this.commitCurrentTimer(userId, expected, timer, {
        sessionState: snapshot.sessionState,
        expectedRuntimeRevision,
        historyTransition,
      });
    }

    this.clearAutoAdvance(userId);
    this.timerCountdownService.stopCountdown(userId);
    this.timerIdleService.cancelIdleDetectionCheck(userId);
    this.timerIdleService.cancelPausedTimerReminder(userId);
    if (timer?.status === TIMER_STATUSES.RUNNING) {
      await this.timerCountdownService.startCountdown(
        timer,
        this.handleTimerCompletion.bind(this)
      );
    }

    if (snapshot.extensionState) {
      const remaining =
        snapshot.extensionState.maxDuration === undefined
          ? undefined
          : snapshot.extensionState.startTime +
            snapshot.extensionState.maxDuration -
            Date.now();

      if (remaining === undefined || remaining > 0) {
        await this.timerStore.setExtensionState(
          userId,
          snapshot.extensionState
        );
        this.timerEvents.emitExtensionStateUpdate(
          userId,
          snapshot.extensionState
        );
      } else {
        await this.timerStore.clearExtensionState(userId);
        this.timerEvents.emitExtensionStateUpdate(userId, null);
      }
    } else {
      await this.timerStore.clearExtensionState(userId);
      this.timerEvents.emitExtensionStateUpdate(userId, null);
    }

    if (snapshot.lastCompletionTimestamp !== null) {
      await this.timerStore.setLastCompletionTimestamp(
        userId,
        snapshot.lastCompletionTimestamp
      );
    } else {
      await this.timerStore.clearLastCompletionTimestamp(userId);
    }

    if (snapshot.idleDetected) {
      await this.timerStore.setIdleDetected(userId);
    } else {
      await this.timerStore.clearIdleDetected(userId);
    }
    if (snapshot.lastCompletionTimestamp !== null && !snapshot.idleDetected) {
      this.scheduleIdleDetectionCheck(userId);
    }

    if (!timer) return null;

    if (
      timer.status === TIMER_STATUSES.PAUSED &&
      timer.type === TIMER_TYPES.WORK &&
      !timer.hasNotifiedPausedTimerReminder
    ) {
      this.timerIdleService.schedulePausedTimerReminder(userId, timer.id);
    }

    this.timerEvents.emitTimerUpdate(userId, timer);
    return timer;
  }

  private async buildHistoryEntry(
    userId: string,
    label: string,
    before: TimerRuntimeSnapshot,
    statisticBeforeSnapshots: Map<
      string,
      StatisticHistorySnapshot | null
    > = new Map(),
    statisticIds: string[] = [],
    logEffect?: TimerHistoryEntry['logEffect']
  ): Promise<TimerHistoryEntry> {
    const after = await this.snapshotRuntime(userId);
    const uniqueStatisticIds = Array.from(
      new Set(statisticIds.filter(Boolean))
    );
    const statistics = await Promise.all(
      uniqueStatisticIds.map(async id => ({
        id,
        before: statisticBeforeSnapshots.get(id) ?? null,
        after: await this.statisticsService.getStatisticHistorySnapshot(
          userId,
          id
        ),
      }))
    );

    return {
      before,
      after,
      capturedAt: Date.now(),
      label,
      logEffect,
      statistics,
    };
  }

  private async snapshotStatistics(
    userId: string,
    statisticIds: string[]
  ): Promise<Map<string, StatisticHistorySnapshot | null>> {
    const snapshots: Array<[string, StatisticHistorySnapshot | null]> =
      await Promise.all(
        Array.from(new Set(statisticIds.filter(Boolean))).map(async id => [
          id,
          await this.statisticsService.getStatisticHistorySnapshot(userId, id),
        ])
      );
    return new Map(snapshots);
  }

  private async pushTimerHistory(entry: TimerHistoryEntry, userId: string) {
    await this.timerStore.pushUndoHistory(userId, entry);
    await this.emitTimerHistoryStatus(userId);
  }

  private async emitTimerHistoryStatus(
    userId: string,
    appliedAction?: {
      direction: 'undo' | 'redo';
      label: string;
      logEffect?: TimerHistoryEntry['logEffect'];
    }
  ): Promise<void> {
    this.timerEvents.emitTimerHistoryUpdate(
      userId,
      await this.timerStore.getTimerHistoryStatus(userId),
      appliedAction
    );
  }

  async resolveTimerExtension(
    userId: string,
    action: TimerExtensionResolutionAction
  ): Promise<Timer | null> {
    const extensionState = await this.timerStore.getExtensionState(userId);
    if (!extensionState) {
      throw new BadRequestException('No active timer extension');
    }
    const currentTimer = await this.timerStore.getCurrentTimer(userId);
    const expected = currentTimer ? timerVersion(currentTimer) : null;

    const before = await this.snapshotRuntime(userId);
    const elapsed = this.getExtensionElapsedDuration(extensionState);
    const isAddingTime = action === 'addFiveMinutes';
    if (
      isAddingTime &&
      extensionState.maxDuration !== undefined &&
      Date.now() - extensionState.startTime >= extensionState.maxDuration
    ) {
      throw new BadRequestException(
        'Timer extension has reached its maximum duration'
      );
    }
    let historyStatisticIds: string[] = [];
    let historyLogEffect: TimerHistoryEntry['logEffect'];

    let undoMetadata: TimerUndoState['metadata'] = {
      action: 'resolveExtension',
    };

    if (elapsed > 0) {
      const statisticSnapshot =
        await this.statisticsService.getStatisticUndoSnapshot(
          userId,
          extensionState.originalTimerId
        );

      if (statisticSnapshot) {
        undoMetadata = {
          action: 'resolveExtension',
          statisticTimerId: extensionState.originalTimerId,
          statisticType: TIMER_TYPES.WORK as TimerTypes,
          statisticIntention: extensionState.intention,
          statisticIntentions: extensionState.intentionSlugs,
          statisticSubIntentions: extensionState.subIntentions,
          statisticUndoMode: 'restore',
          statisticOriginalDuration: statisticSnapshot.duration,
          statisticOriginalCompletedAt: statisticSnapshot.completedAt,
        };
        historyStatisticIds = [extensionState.originalTimerId];
        historyLogEffect = 'updated';
      }
    }

    void undoMetadata;
    const statisticBeforeSnapshots = await this.snapshotStatistics(
      userId,
      historyStatisticIds
    );

    if (!isAddingTime) {
      if (elapsed > 0) {
        await this.statisticsService.appendDurationToStatistic(
          userId,
          extensionState.originalTimerId,
          elapsed,
          extensionState.intention
        );
      }
      await this.timerStore.clearExtensionState(userId);
      this.timerEvents.emitExtensionStateUpdate(userId, null);
      const timer = await this.timerStore.getCurrentTimer(userId);
      const entry = await this.buildHistoryEntry(
        userId,
        'Log extension time',
        before,
        statisticBeforeSnapshots,
        historyStatisticIds,
        historyLogEffect
      );
      await this.pushTimerHistory(entry, userId);
      return timer;
    }

    const sessionState = await this.timerStore.getSessionState(userId);
    const extensionBaseDuration = extensionState.originalDuration + elapsed;
    const extensionDuration = this.getExtensionContinueDuration();

    const timer: Timer = {
      id: randomUUID(),
      startTime: Date.now(),
      duration: extensionDuration,
      type: TIMER_TYPES.WORK as TimerTypes,
      status: TIMER_STATUSES.RUNNING as Timer['status'],
      remainingTime: extensionDuration,
      userId,
      isExtension: true,
      hasNotifiedBeforeTimeNotification: true,
      extensionOriginalTimerId: extensionState.originalTimerId,
      extensionBaseDuration,
      extensionNextTimerType: extensionState.extensionNextTimerType,
      intention: extensionState.intention,
      intentionSlugs: extensionState.intentionSlugs,
      subIntentions: extensionState.subIntentions,
      intentionTitle: extensionState.intentionTitle,
      intentionEmoji: extensionState.intentionEmoji,
      subIntention: extensionState.subIntention,
      subIntentionEmoji: extensionState.subIntentionEmoji,
      subIntentionTitle: extensionState.subIntentionTitle,
      ...(sessionState && {
        sessionPosition: sessionState.currentPosition,
        sessionTotal: sessionState.totalPomodoros,
        stackedSessions: sessionState.stackedSessions,
        sessionIntentionEmojis: sessionState.completedIntentionEmojis,
      }),
    };

    await this.commitCurrentTimer(userId, expected, timer);
    this.clearAutoAdvance(userId);
    this.timerCountdownService.stopCountdown(userId);
    await this.timerCountdownService.startCountdown(
      timer,
      this.handleTimerCompletion.bind(this)
    );
    if (elapsed > 0) {
      await this.statisticsService.appendDurationToStatistic(
        userId,
        extensionState.originalTimerId,
        elapsed,
        extensionState.intention
      );
    }
    await this.timerStore.clearExtensionState(userId);
    this.timerEvents.emitExtensionStateUpdate(userId, null);

    this.timerEvents.emitTimerUpdate(userId, timer);
    const entry = await this.buildHistoryEntry(
      userId,
      'Add extension time',
      before,
      statisticBeforeSnapshots,
      historyStatisticIds,
      historyLogEffect
    );
    await this.pushTimerHistory(entry, userId);
    return timer;
  }

  private getExtensionElapsedDuration(
    extensionState: TimerExtensionState
  ): number {
    const elapsed = Date.now() - extensionState.startTime;
    return Math.max(
      0,
      extensionState.maxDuration === undefined
        ? elapsed
        : Math.min(elapsed, extensionState.maxDuration)
    );
  }

  private getExtensionContinueDuration(): number {
    return EXTENSION_INCREMENT_MS;
  }

  private calculateExtensionMaxDuration(
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>
  ): number | undefined {
    if (
      preferences.sessionsExtension &&
      preferences.sessionHasLongBreak &&
      preferences.sessionAutoDetectLongBreak
    ) {
      return preferences.sessionLongBreakDuration;
    }
    return undefined;
  }

  private buildExtensionCandidate(
    timer: Timer,
    preferences: Awaited<ReturnType<PreferencesService['getPreferences']>>,
    extensionNextTimerType: TimerTypes
  ): TimerExtensionCandidate | undefined {
    if (
      timer.type !== TIMER_TYPES.WORK ||
      timer.isExtension ||
      !preferences.timerExtension
    ) {
      return undefined;
    }
    return {
      maxDuration: this.calculateExtensionMaxDuration(preferences),
      intention: timer.intention,
      intentionSlugs: timer.intentionSlugs,
      subIntentions: timer.subIntentions,
      intentionTitle: timer.intentionTitle,
      intentionEmoji: timer.intentionEmoji,
      intentionEmojis: timer.intentionEmojis,
      subIntention: timer.subIntention,
      subIntentionEmoji: timer.subIntentionEmoji,
      subIntentionEmojis: timer.subIntentionEmojis,
      subIntentionTitle: timer.subIntentionTitle,
      originalTimerId: timer.id,
      originalDuration: timer.duration,
      extensionNextTimerType,
    };
  }

  async createOrResumeTimer(
    userId: string,
    options: CreateOrResumeTimerOptions
  ): Promise<Timer> {
    const incomingIntentions = this.normalizeSelectedIntentions(
      options.intention,
      options.intentions
    );
    const hasSelectionPayload =
      options.intention !== undefined ||
      options.intentions !== undefined ||
      options.subIntentions !== undefined;
    const intentionHistoryBefore = hasSelectionPayload
      ? await this.snapshotRuntime(userId)
      : null;

    const existingTimer = await this.timerStore.getCurrentTimer(userId);
    const existingVersion =
      options.expectedVersion !== undefined
        ? options.expectedVersion
        : existingTimer
          ? timerVersion(existingTimer)
          : null;

    if (existingTimer && !options.isResetOrSkip) {
      if (
        existingTimer.status !== TIMER_STATUSES.COMPLETED &&
        existingTimer.type === options.type
      ) {
        const isIntentionExplicitlyCleared =
          hasSelectionPayload && incomingIntentions.length === 0;

        // Check if intention is required before resuming work timer
        const preferences =
          await this.preferencesService.getPreferences(userId);
        if (
          this.canTimerUseIntentions(existingTimer.type, preferences) &&
          !preferences.intentionMultiSelect &&
          incomingIntentions.length > 1
        ) {
          throw new BadRequestException('Multiple intentions are disabled');
        }
        const existingIntentions = this.getTimerIntentions(existingTimer);
        if (
          preferences.intentionExtension &&
          preferences.intentionRequireSelection &&
          existingTimer.type === TIMER_TYPES.WORK &&
          (isIntentionExplicitlyCleared ||
            (!hasSelectionPayload && existingIntentions.length === 0))
        ) {
          throw new BadRequestException(
            'Intention is required for work timers'
          );
        }

        const wasRunning = existingTimer.status === TIMER_STATUSES.RUNNING;

        // Check if timer hasn't started yet (paused and no elapsed time)
        const timerNotStarted =
          !wasRunning && existingTimer.remainingTime === existingTimer.duration;

        if (!wasRunning) {
          existingTimer.status = TIMER_STATUSES.RUNNING;
          const elapsedBeforePause =
            existingTimer.duration - existingTimer.remainingTime;
          existingTimer.startTime = Date.now() - elapsedBeforePause;
          existingTimer.remainingTime =
            existingTimer.duration - elapsedBeforePause;
          existingTimer.hasNotifiedPausedTimerReminder = false;
        }

        if (
          this.canTimerUseIntentions(existingTimer.type, preferences) &&
          hasSelectionPayload
        ) {
          const defaultDuration =
            existingTimer.type === TIMER_TYPES.WORK
              ? preferences.workTimerDuration
              : existingTimer.type === TIMER_TYPES.BREAK
                ? preferences.breakTimerDuration *
                  (existingTimer.stackedSessions || 1)
                : preferences.sessionLongBreakDuration;

          if (isIntentionExplicitlyCleared) {
            this.applySelectedIntentionsToTimer(existingTimer, []);

            if (timerNotStarted && preferences.intentionCustomDurations) {
              existingTimer.duration = defaultDuration;
              existingTimer.remainingTime = defaultDuration;
            }
          } else {
            const selection = await this.resolveIntentionSelection(
              userId,
              existingTimer.type,
              incomingIntentions,
              options.subIntentions,
              preferences
            );

            this.applySelectedIntentionsToTimer(
              existingTimer,
              incomingIntentions,
              selection.primaryEmoji,
              selection.subIntentions,
              selection.primaryTitle,
              selection.primarySubEmoji,
              selection.primarySubTitle,
              selection.intentionEmojis,
              selection.subIntentionEmojis
            );

            if (timerNotStarted && preferences.intentionCustomDurations) {
              if (selection.customDuration) {
                existingTimer.duration = selection.customDuration;
                existingTimer.remainingTime = selection.customDuration;
              } else {
                existingTimer.duration = defaultDuration;
                existingTimer.remainingTime = defaultDuration;
              }
            } else if (
              selection.customDurationSource === 'sub' &&
              selection.customDuration
            ) {
              this.applyDurationPreservingElapsed(
                existingTimer,
                selection.customDuration
              );
            }
          }
        }

        const shouldResetOnFirstIntention =
          wasRunning &&
          this.shouldResetAutoStartedBreakOnFirstIntention(
            existingTimer,
            existingIntentions,
            incomingIntentions,
            preferences,
            options.resetOnFirstIntention
          );

        if (wasRunning) {
          existingTimer.remainingTime = Math.max(
            0,
            existingTimer.duration - (Date.now() - existingTimer.startTime)
          );
        }

        if (shouldResetOnFirstIntention) {
          this.resetAutoStartedBreakOnFirstIntention(existingTimer, Date.now());
        }

        this.addFocusedTaskToTimer(existingTimer, options.focusedTaskId);

        const clearExtensionState =
          options.type === TIMER_TYPES.WORK || shouldResetOnFirstIntention;
        await this.commitCurrentTimer(
          userId,
          existingVersion,
          existingTimer,
          options.sessionState !== undefined || clearExtensionState
            ? {
                ...(options.sessionState !== undefined
                  ? { sessionState: options.sessionState }
                  : {}),
                ...(clearExtensionState ? { extensionState: null } : {}),
              }
            : undefined
        );
        await this.applyCommittedTimerTransition(userId, options.type);
        this.timerEvents.emitTimerUpdate(userId ?? 'unknown', existingTimer);
        if (clearExtensionState && options.type !== TIMER_TYPES.WORK) {
          this.timerEvents.emitExtensionStateUpdate(userId, null);
        }
        if (
          intentionHistoryBefore?.timer &&
          this.canTimerUseIntentions(existingTimer.type, preferences)
        ) {
          const previousIntentions = this.getTimerIntentions(
            intentionHistoryBefore.timer
          );
          const previousSubIntentions = this.getTimerSubIntentions(
            intentionHistoryBefore.timer
          );
          const nextIntentions = this.getTimerIntentions(existingTimer);
          const nextSubIntentions = this.getTimerSubIntentions(existingTimer);
          const hasIntentionChange =
            !this.areStringArraysEqual(previousIntentions, nextIntentions) ||
            !this.areSubIntentionMapsEqual(
              previousSubIntentions,
              nextSubIntentions
            );

          if (hasIntentionChange) {
            const entry = await this.buildHistoryEntry(
              userId,
              'Change intention',
              intentionHistoryBefore
            );
            await this.pushTimerHistory(entry, userId);
          }
        }
        return existingTimer;
      }
    }
    if (!options.type) {
      throw new BadRequestException('Timer type is required');
    }

    const preferences = await this.preferencesService.getPreferences(userId);

    if (
      this.canTimerUseIntentions(options.type, preferences) &&
      !preferences.intentionMultiSelect &&
      incomingIntentions.length > 1
    ) {
      throw new BadRequestException('Multiple intentions are disabled');
    }

    if (
      preferences.intentionExtension &&
      preferences.intentionRequireSelection &&
      options.type === TIMER_TYPES.WORK &&
      incomingIntentions.length === 0 &&
      !options.startPaused
    ) {
      throw new BadRequestException('Intention is required for work timers');
    }

    // Fetch intention emoji if intention is provided
    let intentionEmoji: string | undefined = options.intentionEmoji;
    let intentionTitle: string | undefined;
    let subIntention: string | undefined;
    let subIntentionEmoji: string | undefined;
    let subIntentionTitle: string | undefined;
    let intentionEmojis: Record<string, string> = {};
    let subIntentionEmojis: Record<string, string> = {};
    let customDuration: number | undefined = options.customDuration;
    let selectedSubIntentions: Record<string, string> = {};

    if (
      incomingIntentions.length > 0 &&
      this.canTimerUseIntentions(options.type, preferences)
    ) {
      const selection = await this.resolveIntentionSelection(
        userId,
        options.type,
        incomingIntentions,
        options.subIntentions,
        preferences
      );
      selectedSubIntentions = selection.subIntentions;
      intentionEmoji = intentionEmoji ?? selection.primaryEmoji;
      intentionEmojis = selection.intentionEmojis;
      intentionTitle = selection.primaryTitle;
      subIntention = selection.primarySubIntention;
      subIntentionEmoji = selection.primarySubEmoji;
      subIntentionEmojis = selection.subIntentionEmojis;
      subIntentionTitle = selection.primarySubTitle;

      if (selection.customDuration) {
        customDuration = selection.customDuration;
      }
    }

    // Handle session tracking if sessions extension is enabled
    let sessionPosition: number | undefined;
    let sessionTotal: number | undefined;
    let timerStackedSessions = options.stackedSessions;
    let sessionIntentionEmojis: Record<number, string> | undefined;
    let nextSessionState: TimerSessionState | undefined;

    if (preferences.sessionsExtension) {
      const sessionState =
        options.sessionState !== undefined
          ? options.sessionState
          : await this.timerStore.getSessionState(userId);

      if (options.type === TIMER_TYPES.WORK) {
        if (
          !sessionState ||
          (options.isResetOrSkip && !options.preserveSessionState)
        ) {
          // Start a new session
          sessionPosition = 1;
          sessionTotal = preferences.sessionPomodorosCount;
          nextSessionState = {
            currentPosition: 1,
            totalPomodoros: preferences.sessionPomodorosCount,
          };
        } else {
          sessionPosition = sessionState.currentPosition;
          sessionTotal = sessionState.totalPomodoros;
          sessionIntentionEmojis = sessionState.completedIntentionEmojis;
        }
      } else if (options.type === TIMER_TYPES.BREAK && sessionState) {
        sessionPosition = sessionState.currentPosition;
        sessionTotal = sessionState.totalPomodoros;
        timerStackedSessions =
          timerStackedSessions ?? sessionState.stackedSessions;
        sessionIntentionEmojis = sessionState.completedIntentionEmojis;
      }
    }

    const breakMultiplier = timerStackedSessions || 1;

    // Calculate duration - use custom duration if available, otherwise use preferences
    let duration: number;
    if (customDuration) {
      duration = customDuration;
    } else {
      duration =
        options.type === TIMER_TYPES.WORK
          ? preferences.workTimerDuration
          : options.type === TIMER_TYPES.BREAK
            ? preferences.breakTimerDuration * breakMultiplier
            : preferences.sessionLongBreakDuration;
    }

    const shouldHaveIntention = this.canTimerUseIntentions(
      options.type,
      preferences
    );

    const timer: Timer = {
      id: randomUUID(),
      startTime: options.startPaused ? 0 : Date.now(),
      duration,
      type: options.type,
      status: options.startPaused
        ? TIMER_STATUSES.PAUSED
        : TIMER_STATUSES.RUNNING,
      remainingTime: duration,
      intention:
        shouldHaveIntention && incomingIntentions.length > 0
          ? this.getPrimaryIntention(incomingIntentions)
          : undefined,
      intentionSlugs:
        shouldHaveIntention && incomingIntentions.length > 0
          ? incomingIntentions
          : undefined,
      subIntentions:
        shouldHaveIntention && Object.keys(selectedSubIntentions).length > 0
          ? selectedSubIntentions
          : undefined,
      intentionEmoji:
        shouldHaveIntention && incomingIntentions.length > 0
          ? intentionEmoji
          : undefined,
      intentionEmojis:
        shouldHaveIntention && incomingIntentions.length > 0
          ? intentionEmojis
          : undefined,
      intentionTitle:
        shouldHaveIntention && incomingIntentions.length > 0
          ? intentionTitle
          : undefined,
      subIntention:
        shouldHaveIntention && incomingIntentions.length > 0
          ? subIntention
          : undefined,
      subIntentionEmoji:
        shouldHaveIntention && incomingIntentions.length > 0
          ? subIntentionEmoji
          : undefined,
      subIntentionEmojis:
        shouldHaveIntention && Object.keys(selectedSubIntentions).length > 0
          ? subIntentionEmojis
          : undefined,
      subIntentionTitle:
        shouldHaveIntention && incomingIntentions.length > 0
          ? subIntentionTitle
          : undefined,
      hasNotifiedPausedTimerReminder: false,
      sessionPosition,
      sessionTotal,
      stackedSessions: timerStackedSessions,
      sessionIntentionEmojis,
      userId,
      focusedTaskIds: options.focusedTaskId
        ? [options.focusedTaskId]
        : options.focusedTaskIds?.length
          ? [...options.focusedTaskIds]
          : undefined,
      ...(options.isAutoStarted && { isAutoStarted: true }),
      ...(options.extensionCandidate && {
        extensionCandidate: options.extensionCandidate,
      }),
    };

    const committedSessionState = nextSessionState ?? options.sessionState;
    const clearExtensionState =
      options.isResetOrSkip === true || options.type === TIMER_TYPES.WORK;
    await this.commitCurrentTimer(
      userId,
      existingVersion,
      timer,
      committedSessionState !== undefined || clearExtensionState
        ? {
            ...(committedSessionState !== undefined
              ? { sessionState: committedSessionState }
              : {}),
            ...(clearExtensionState ? { extensionState: null } : {}),
          }
        : undefined
    );
    await this.applyCommittedTimerTransition(userId, options.type);
    if (clearExtensionState && options.type !== TIMER_TYPES.WORK) {
      this.timerEvents.emitExtensionStateUpdate(userId, null);
    }

    this.usersService
      .associateTimerWithUser(userId, timer.id)
      .catch(error => this.logger.error('User association error:', error));

    this.timerEvents.emitTimerUpdate(userId ?? 'unknown', timer);
    return timer;
  }

  async activateTimerContinuation(
    plan: TimerContinuationPlanV2
  ): Promise<void> {
    const userId = plan.nextTimer.userId;
    if (!userId) {
      throw new ConflictException('Timer continuation user is missing');
    }
    if (!(await this.isContinuationTimerCurrent(userId, plan))) return;

    this.clearAutoAdvance(userId);
    this.timerCountdownService.stopCountdown(userId, plan.source);
    this.timerIdleService.cancelPausedTimerReminder(userId);
    if (plan.nextTimer.type === TIMER_TYPES.LONG_BREAK) {
      this.timerIdleService.cancelIdleDetectionCheck(userId);
    }
    if (plan.nextTimer.status === TIMER_STATUSES.RUNNING) {
      await this.timerCountdownService.startCountdown(
        plan.nextTimer,
        this.handleTimerCompletion.bind(this)
      );
    }
    if (!(await this.isContinuationTimerCurrent(userId, plan))) {
      this.timerCountdownService.stopCountdown(userId, {
        timerId: plan.nextTimer.id,
        scheduleRevision: plan.nextTimer.scheduleRevision as string,
      });
      return;
    }
    if (plan.extensionState.kind !== 'keep') {
      this.timerEvents.emitExtensionStateUpdate(
        userId,
        plan.extensionState.kind === 'set' ? plan.extensionState.value : null
      );
    }
    this.usersService
      .associateTimerWithUser(userId, plan.nextTimer.id)
      .catch(error => this.logger.error('User association error:', error));
    this.timerEvents.emitTimerUpdate(userId, plan.nextTimer);
  }

  private async isContinuationTimerCurrent(
    userId: string,
    plan: TimerContinuationPlanV2
  ): Promise<boolean> {
    const current = await this.timerStore.getCurrentTimer(userId);
    return (
      current?.id === plan.nextTimer.id &&
      current.scheduleRevision === plan.nextTimer.scheduleRevision
    );
  }

  async removeFocusedTask(userId: string, taskId: string): Promise<void> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer?.focusedTaskIds?.includes(taskId)) {
      return;
    }

    const expected = timerVersion(timer);
    this.refreshRunningTimerRemainingTime(timer);
    timer.focusedTaskIds = timer.focusedTaskIds.filter(id => id !== taskId);
    if (timer.focusedTaskIds.length === 0) {
      delete timer.focusedTaskIds;
    }

    await this.commitCurrentTimer(userId, expected, timer);
    this.timerEvents.emitTimerUpdate(userId, timer);
  }

  private refreshRunningTimerRemainingTime(timer: Timer): void {
    if (timer.status !== TIMER_STATUSES.RUNNING) {
      return;
    }

    timer.remainingTime = Math.max(
      0,
      timer.duration - (Date.now() - timer.startTime)
    );
  }

  private addFocusedTaskToTimer(timer: Timer, taskId?: string): void {
    const normalizedTaskId = taskId?.trim();
    if (!normalizedTaskId) {
      return;
    }

    const existingTaskIds = timer.focusedTaskIds ?? [];
    if (existingTaskIds.includes(normalizedTaskId)) {
      timer.focusedTaskIds = existingTaskIds;
      return;
    }

    timer.focusedTaskIds = [...existingTaskIds, normalizedTaskId];
  }

  async resumeTimer(userId: string): Promise<Timer | null> {
    const timer = await this.timerStore.getCurrentTimer(userId);
    if (!timer) {
      return null;
    }
    if (timer.status !== TIMER_STATUSES.PAUSED) {
      return timer;
    }

    const expected = timerVersion(timer);
    timer.status = TIMER_STATUSES.RUNNING;
    const elapsedBeforePause = timer.duration - timer.remainingTime;
    timer.startTime = Date.now() - elapsedBeforePause;
    timer.remainingTime = timer.duration - elapsedBeforePause;
    timer.hasNotifiedPausedTimerReminder = false;

    await this.commitCurrentTimer(userId, expected, timer);
    this.timerIdleService.cancelPausedTimerReminder(userId);

    return timer;
  }

  private async restoreTimerRuntimeStateOnStartup(): Promise<void> {
    await this.restoreActiveTimersOnStartup();
  }

  private async restoreActiveTimersOnStartup(): Promise<void> {
    const timerKeys = await this.timerStore.getAllCurrentTimerKeys();
    if (timerKeys.length === 0) {
      return;
    }

    const onComplete = this.handleTimerCompletion.bind(this);

    for (const timerKey of timerKeys) {
      const userId = this.extractUserIdFromCurrentTimerKey(timerKey);
      if (!userId) {
        this.logger.warn('Skipping malformed timer key');
        continue;
      }

      try {
        const timer = await this.timerStore.getCurrentTimer(userId);
        if (!timer) {
          continue;
        }
        if (timer.status !== TIMER_STATUSES.RUNNING) {
          this.scheduleIdleDetectionCheck(userId);
          continue;
        }

        const remainingTime = timer.duration - (Date.now() - timer.startTime);
        if (remainingTime <= 0) {
          await this.handleTimerCompletion(timer);
          continue;
        }

        await this.timerCountdownService.startCountdown(timer, onComplete);
      } catch (error) {
        if (isTransientDependencyError(error)) {
          this.logger.warn(
            `Timer runtime restoration deferred for one account (${formatSafeError(error)})`
          );
        } else {
          this.logger.error('Failed to restore a running timer', error);
        }
      }
    }
  }

  private extractUserIdFromCurrentTimerKey(key: string): string | null {
    const prefix = 'user:';
    const suffix = ':current_timer';

    if (!key.startsWith(prefix) || !key.endsWith(suffix)) {
      return null;
    }

    const userId = key.slice(prefix.length, -suffix.length);
    return userId.length > 0 ? userId : null;
  }

  private async handleTimerCompletion(timer: Timer) {
    const { userId } = timer;
    if (this.completingTimerIds.has(timer.id)) {
      return;
    }

    this.completingTimerIds.add(timer.id);

    try {
      let completionTimer = timer;
      if (userId) {
        const claim = await this.timerStore.claimRunningTimerCompletionByMode(
          userId,
          timer.id,
          timer.startTime
        );
        if (!claim) return;
        if (claim.mode === 'stream') return;
        completionTimer = claim.timer;

        await this.clearTimerHistory(userId);
      } else {
        completionTimer = {
          ...timer,
          status: TIMER_STATUSES.COMPLETED,
          remainingTime: 0,
        };
      }

      await this.completeTimer(completionTimer);
    } finally {
      this.completingTimerIds.delete(timer.id);
    }
  }

  private async completeTimer(timer: Timer) {
    const { userId } = timer;
    const selectedIntentions = this.getTimerIntentions(timer);
    const selectedSubIntentions = this.getTimerSubIntentions(timer);
    const preferences = await this.preferencesService.getPreferences(
      timer.userId ?? 'unknown'
    );
    const isLastWorkTimerInSession =
      timer.type === TIMER_TYPES.WORK &&
      (timer.isExtension
        ? timer.extensionNextTimerType === TIMER_TYPES.LONG_BREAK ||
          timer.extensionNextTimerType === TIMER_TYPES.WORK
        : preferences.sessionsExtension === true &&
          !!timer.sessionPosition &&
          !!timer.sessionTotal &&
          timer.sessionPosition === timer.sessionTotal);

    await this.timerNotificationService.emitTimerCompleted(
      userId ?? 'unknown',
      timer,
      isLastWorkTimerInSession
    );

    if (timer.type === TIMER_TYPES.WORK || timer.type === TIMER_TYPES.BREAK) {
      // Store last completion time for idle period detection
      if (userId) {
        await this.timerStore.setLastCompletionTimestamp(userId, Date.now());
        await this.timerStore.clearIdleDetected(userId);

        this.scheduleIdleDetectionCheck(userId);
      }
    }

    if (timer.type === TIMER_TYPES.WORK) {
      // Record statistics for completed timers
      if (timer.isExtension && timer.extensionOriginalTimerId) {
        // Extension timer: update the original timer's statistic
        await this.statisticsService.appendDurationToStatistic(
          userId ?? 'unknown',
          timer.extensionOriginalTimerId,
          timer.duration - timer.remainingTime,
          timer.intention
        );
      } else {
        await this.statisticsService.recordCompletedTimer(
          userId ?? 'unknown',
          timer
        );
      }
      if (selectedIntentions.length > 0 && userId) {
        await Promise.all([
          this.intentionsService.incrementIntentionsUsage(
            userId,
            selectedIntentions
          ),
          this.intentionsService.incrementSubIntentionsUsage(
            userId,
            selectedSubIntentions
          ),
        ]);
      }

      this.timerEvents.emitTimerUpdate(userId ?? 'unknown', timer);

      if (timer.isExtension) {
        const nextTimerOptions = this.getExtensionNextTimerOptions(
          timer,
          preferences
        );

        this.scheduleAutoAdvance(userId ?? 'unknown', 500, () => {
          return this.createOrResumeTimer(
            userId ?? 'unknown',
            nextTimerOptions
          );
        });
        return;
      }

      const extensionNextTimerType = this.getNextTimerTypeAfterWorkTimer(
        timer,
        preferences
      );
      const extensionCandidate = this.buildExtensionCandidate(
        timer,
        preferences,
        extensionNextTimerType
      );
      // Auto-started breaks carry the candidate until a successful pause.
      // Manually-started breaks retain the existing completion-time behavior.
      if (extensionCandidate && userId && !preferences.autoStartBreak) {
        const extensionState: TimerExtensionState = {
          ...extensionCandidate,
          startTime: Date.now(),
        };
        await this.timerStore.setExtensionState(userId, extensionState);
        this.timerEvents.emitExtensionStateUpdate(userId, extensionState);
      }

      // Handle session progression
      if (
        preferences.sessionsExtension &&
        timer.sessionPosition &&
        timer.sessionTotal
      ) {
        const nextPosition = timer.sessionPosition + 1;

        if (nextPosition > timer.sessionTotal) {
          // Session completed - start long break if enabled
          if (preferences.sessionHasLongBreak) {
            // Reset session state for next session
            if (userId) {
              await this.timerStore.clearSessionState(userId);
            }

            this.scheduleAutoAdvance(userId ?? 'unknown', 500, () => {
              return this.createOrResumeTimer(userId ?? 'unknown', {
                type: TIMER_TYPES.LONG_BREAK,
                startPaused: !preferences.autoStartBreak,
                isAutoStarted: preferences.autoStartBreak,
                extensionCandidate,
                focusedTaskIds: timer.focusedTaskIds,
              });
            });
          } else {
            // Reset session and start new work timer
            if (userId) {
              await this.timerStore.clearSessionState(userId);
            }
            this.scheduleAutoAdvance(userId ?? 'unknown', 500, () => {
              return this.createOrResumeTimer(userId ?? 'unknown', {
                type: TIMER_TYPES.WORK,
                startPaused: true,
                focusedTaskIds: timer.focusedTaskIds,
              });
            });
          }
        } else {
          // Continue with session - update position and start regular break
          if (userId) {
            const timerDisplayEmoji = this.getTimerDisplayEmoji(timer);
            const completedIntentionEmojis = {
              ...(timer.sessionIntentionEmojis ?? {}),
              ...(timerDisplayEmoji && timer.sessionPosition
                ? { [timer.sessionPosition]: timerDisplayEmoji }
                : {}),
            };
            await this.timerStore.setSessionState(userId, {
              currentPosition: nextPosition,
              totalPomodoros: timer.sessionTotal,
              stackedSessions: timer.stackedSessions,
              completedIntentionEmojis,
            });
          }

          this.scheduleAutoAdvance(userId ?? 'unknown', 500, () => {
            return this.createOrResumeTimer(userId ?? 'unknown', {
              type: TIMER_TYPES.BREAK,
              startPaused: !preferences.autoStartBreak,
              isAutoStarted: preferences.autoStartBreak,
              extensionCandidate,
              stackedSessions: timer.stackedSessions,
              focusedTaskIds: timer.focusedTaskIds,
            });
          });
        }
      } else {
        this.scheduleAutoAdvance(userId ?? 'unknown', 500, () => {
          return this.createOrResumeTimer(userId ?? 'unknown', {
            type: TIMER_TYPES.BREAK,
            startPaused: !preferences.autoStartBreak,
            isAutoStarted: preferences.autoStartBreak,
            extensionCandidate,
            stackedSessions: timer.stackedSessions,
            focusedTaskIds: timer.focusedTaskIds,
          });
        });
      }
    }

    if (timer.type === TIMER_TYPES.BREAK) {
      // Record break statistics if break has an intention
      if (selectedIntentions.length > 0) {
        await this.statisticsService.recordCompletedTimer(
          userId ?? 'unknown',
          timer
        );
        if (userId) {
          await Promise.all([
            this.intentionsService.incrementIntentionsUsage(
              userId,
              selectedIntentions
            ),
            this.intentionsService.incrementSubIntentionsUsage(
              userId,
              selectedSubIntentions
            ),
          ]);
        }
      }

      this.timerEvents.emitTimerUpdate(userId ?? 'unknown', timer);

      this.scheduleAutoAdvance(userId ?? 'unknown', 100, () => {
        return this.createOrResumeTimer(userId ?? 'unknown', {
          type: TIMER_TYPES.WORK,
          startPaused: true,
        });
      });
    }

    if (timer.type === TIMER_TYPES.LONG_BREAK) {
      await this.statisticsService.recordCompletedTimer(
        userId ?? 'unknown',
        timer
      );

      if (selectedIntentions.length > 0 && userId) {
        await Promise.all([
          this.intentionsService.incrementIntentionsUsage(
            userId,
            selectedIntentions
          ),
          this.intentionsService.incrementSubIntentionsUsage(
            userId,
            selectedSubIntentions
          ),
        ]);
      }

      this.timerEvents.emitTimerUpdate(userId ?? 'unknown', timer);

      this.scheduleAutoAdvance(userId ?? 'unknown', 100, () => {
        return this.createOrResumeTimer(userId ?? 'unknown', {
          type: TIMER_TYPES.WORK,
          startPaused: true,
        });
      });
    }
  }

  private scheduleAutoAdvance(
    userId: string,
    delayMs: number,
    run: () => void | Promise<unknown>
  ): void {
    this.clearAutoAdvance(userId);

    const timeout = setTimeout(() => {
      this.autoAdvanceTimeouts.delete(userId);
      void Promise.resolve(run())
        .then(() => {
          this.scheduleIdleDetectionCheck(userId);
        })
        .catch(error => {
          this.logger.error('Failed to auto-advance a Timer', error);
        });
    }, delayMs);

    this.autoAdvanceTimeouts.set(userId, timeout);
  }

  private clearAutoAdvance(userId: string): void {
    const timeout = this.autoAdvanceTimeouts.get(userId);
    if (!timeout) {
      return;
    }

    clearTimeout(timeout);
    this.autoAdvanceTimeouts.delete(userId);
  }

  private scheduleIdleDetectionCheck(userId: string): void {
    this.timerIdleService.scheduleIdleDetectionCheck(userId, targetUserId =>
      this.createOrResumeTimer(targetUserId, {
        type: TIMER_TYPES.WORK,
        startPaused: true,
        isResetOrSkip: true,
      })
    );
  }
}
