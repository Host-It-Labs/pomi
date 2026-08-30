import { UnprocessableEntityException } from '@nestjs/common';
import {
  Preferences,
  TIMER_STATUSES,
  TIMER_TYPES,
  Timer,
  TimerExtensionState,
  TimerExtensionCandidate,
  TimerTypes,
} from '@pomi/shared';
import type { TimerSessionState, TimerVersion } from './timer-store';

export const TIMER_CONTINUATION_PLAN_VERSION = 2;

export type TimerStateMutation<T> =
  { kind: 'keep' } | { kind: 'clear' } | { kind: 'set'; value: T };

interface TimerContinuationPlanBase {
  source: TimerVersion;
  activationAt: number;
  nextTimer: Timer;
  sessionState: TimerStateMutation<TimerSessionState>;
  extensionState: TimerStateMutation<TimerExtensionState>;
  extensionExpirationAt: number | null;
  lastCompletionTimestamp: TimerStateMutation<number>;
  clearIdleDetected: boolean;
  clearHistory: true;
}

export interface TimerContinuationPlanV1 extends TimerContinuationPlanBase {
  idleDetection: {
    checkAt: number;
    longBreakDuration: number;
  } | null;
}

export interface TimerContinuationPlanV2 extends TimerContinuationPlanBase {
  idleDetection: {
    detectionId: string;
    checkAt: number;
    longBreakDuration: number;
    expectedLastCompletionTimestamp: number;
    expectedTimer: TimerVersion;
    expectedRuntimeRevision: string;
    longBreakTimerId: string;
    replacementTimer: Timer;
    replacementSessionState: TimerSessionState;
  } | null;
}

export interface TimerContinuationIdleIdentities {
  detectionId: string;
  longBreakTimerId: string;
  replacementTimerId: string;
  replacementScheduleRevision: string;
}

export function buildTimerContinuationPlan(
  timer: Timer,
  preferences: Preferences,
  completedAt: number,
  nextTimerId: string,
  nextScheduleRevision: string,
  idleDetectionId: string,
  idleLongBreakTimerId: string,
  idleReplacementTimerId: string,
  idleReplacementScheduleRevision: string
): TimerContinuationPlanV2 {
  if (!timer.userId || !timer.scheduleRevision) {
    throw new UnprocessableEntityException(
      'Completed Timer lacks continuation identity'
    );
  }

  const transition = resolveTransition(timer, preferences);
  const sessionState = resolveSessionState(timer, preferences, transition.type);
  const sessionSnapshot = preferences.sessionsExtension
    ? sessionState.kind === 'set'
      ? sessionState.value
      : sessionState.kind === 'keep'
        ? sessionStateFromTimer(timer)
        : null
    : null;
  const duration = durationForTransition(
    transition.type,
    transition.stackedSessions,
    preferences
  );
  const startTime = transition.startPaused
    ? 0
    : completedAt + transition.delayMs;
  const nextTimer: Timer = {
    id: nextTimerId,
    scheduleRevision: nextScheduleRevision,
    userId: timer.userId,
    startTime,
    duration,
    remainingTime: duration,
    type: transition.type,
    status: transition.startPaused
      ? TIMER_STATUSES.PAUSED
      : TIMER_STATUSES.RUNNING,
    hasNotifiedPausedTimerReminder: false,
    ...(sessionSnapshot && {
      sessionPosition: sessionSnapshot.currentPosition,
      sessionTotal: sessionSnapshot.totalPomodoros,
      sessionIntentionEmojis: sessionSnapshot.completedIntentionEmojis,
    }),
    ...(transition.stackedSessions !== undefined && {
      stackedSessions: transition.stackedSessions,
    }),
    ...(transition.focusedTaskIds &&
      transition.focusedTaskIds.length > 0 && {
        focusedTaskIds: [...transition.focusedTaskIds],
      }),
    ...(transition.isAutoStarted && { isAutoStarted: true }),
    ...(transition.extensionCandidate && {
      extensionCandidate: transition.extensionCandidate,
    }),
  };

  const extensionState = resolveExtensionState(
    timer,
    preferences,
    completedAt,
    transition.type
  );
  const extensionExpirationAt =
    extensionState.kind === 'set' &&
    extensionState.value.maxDuration !== undefined
      ? extensionState.value.startTime + extensionState.value.maxDuration
      : null;
  const shouldRecordCompletion =
    timer.type === TIMER_TYPES.WORK || timer.type === TIMER_TYPES.BREAK;
  const lastCompletionTimestamp: TimerStateMutation<number> =
    transition.type === TIMER_TYPES.LONG_BREAK
      ? { kind: 'clear' }
      : shouldRecordCompletion
        ? { kind: 'set', value: completedAt }
        : { kind: 'keep' };

  return parseTimerContinuationPlanV2({
    source: {
      timerId: timer.id,
      scheduleRevision: timer.scheduleRevision,
    },
    activationAt: completedAt + transition.delayMs,
    nextTimer,
    sessionState,
    extensionState,
    extensionExpirationAt,
    lastCompletionTimestamp,
    clearIdleDetected: shouldRecordCompletion,
    clearHistory: true,
    idleDetection:
      shouldRecordCompletion &&
      transition.type !== TIMER_TYPES.LONG_BREAK &&
      preferences.sessionAutoDetectLongBreak &&
      preferences.sessionsExtension &&
      preferences.sessionHasLongBreak
        ? {
            detectionId: idleDetectionId,
            checkAt: completedAt + preferences.sessionLongBreakDuration,
            longBreakDuration: preferences.sessionLongBreakDuration,
            expectedLastCompletionTimestamp: completedAt,
            expectedTimer: {
              timerId: nextTimer.id,
              scheduleRevision: nextTimer.scheduleRevision as string,
            },
            expectedRuntimeRevision: nextTimer.scheduleRevision as string,
            longBreakTimerId: idleLongBreakTimerId,
            replacementTimer: {
              id: idleReplacementTimerId,
              scheduleRevision: idleReplacementScheduleRevision,
              userId: timer.userId,
              startTime: 0,
              duration: preferences.workTimerDuration,
              remainingTime: preferences.workTimerDuration,
              type: TIMER_TYPES.WORK,
              status: TIMER_STATUSES.PAUSED,
              hasNotifiedPausedTimerReminder: false,
              sessionPosition: 1,
              sessionTotal: preferences.sessionPomodorosCount,
            },
            replacementSessionState: {
              currentPosition: 1,
              totalPomodoros: preferences.sessionPomodorosCount,
            },
          }
        : null,
  });
}

export function parseTimerContinuationPlan(
  value: unknown,
  version: number
): TimerContinuationPlanV2 {
  if (version === 1) {
    const legacy = parseTimerContinuationPlanV1(value);
    return { ...legacy, idleDetection: null };
  }
  if (version !== TIMER_CONTINUATION_PLAN_VERSION) {
    throw new UnprocessableEntityException(
      `Unsupported Timer continuation plan version: ${version}`
    );
  }
  return parseTimerContinuationPlanV2(value);
}

export function parseTimerContinuationPlanV1(
  value: unknown
): TimerContinuationPlanV1 {
  if (!isRecord(value) || !isLegacyIdleDetection(value.idleDetection)) {
    throw malformedPlan();
  }
  const normalized = parseTimerContinuationPlanV2({
    ...value,
    idleDetection: null,
  });
  return { ...normalized, idleDetection: value.idleDetection };
}

export function upgradeTimerContinuationPlanV1(
  plan: TimerContinuationPlanV1,
  preferences: Preferences,
  identities: TimerContinuationIdleIdentities
): TimerContinuationPlanV2 {
  if (plan.idleDetection === null) return { ...plan, idleDetection: null };
  if (
    plan.lastCompletionTimestamp.kind !== 'set' ||
    !plan.nextTimer.userId ||
    !plan.nextTimer.scheduleRevision ||
    plan.idleDetection.checkAt !==
      plan.lastCompletionTimestamp.value +
        plan.idleDetection.longBreakDuration +
        5_000
  ) {
    throw malformedPlan();
  }
  const lastCompletion = plan.lastCompletionTimestamp.value;
  return parseTimerContinuationPlanV2({
    ...plan,
    idleDetection: {
      detectionId: identities.detectionId,
      checkAt: lastCompletion + plan.idleDetection.longBreakDuration,
      longBreakDuration: plan.idleDetection.longBreakDuration,
      expectedLastCompletionTimestamp: lastCompletion,
      expectedTimer: {
        timerId: plan.nextTimer.id,
        scheduleRevision: plan.nextTimer.scheduleRevision,
      },
      expectedRuntimeRevision: plan.nextTimer.scheduleRevision,
      longBreakTimerId: identities.longBreakTimerId,
      replacementTimer: {
        id: identities.replacementTimerId,
        scheduleRevision: identities.replacementScheduleRevision,
        userId: plan.nextTimer.userId,
        startTime: 0,
        duration: preferences.workTimerDuration,
        remainingTime: preferences.workTimerDuration,
        type: TIMER_TYPES.WORK,
        status: TIMER_STATUSES.PAUSED,
        hasNotifiedPausedTimerReminder: false,
        sessionPosition: 1,
        sessionTotal: preferences.sessionPomodorosCount,
      },
      replacementSessionState: {
        currentPosition: 1,
        totalPomodoros: preferences.sessionPomodorosCount,
      },
    },
  });
}

function parseTimerContinuationPlanV2(value: unknown): TimerContinuationPlanV2 {
  if (
    !isRecord(value) ||
    !isRecord(value.source) ||
    !isRecord(value.nextTimer)
  ) {
    throw malformedPlan();
  }
  const nextTimer = value.nextTimer as unknown as Timer;
  if (
    !isNonEmptyString(value.source.timerId) ||
    !isNonEmptyString(value.source.scheduleRevision) ||
    !isNonEmptyString(nextTimer.id) ||
    !isNonEmptyString(nextTimer.scheduleRevision) ||
    !isNonEmptyString(nextTimer.userId) ||
    !isSafeNonNegativeInteger(value.activationAt) ||
    !Object.values(TIMER_TYPES).includes(nextTimer.type) ||
    (nextTimer.status !== TIMER_STATUSES.RUNNING &&
      nextTimer.status !== TIMER_STATUSES.PAUSED) ||
    !isSafeNonNegativeInteger(nextTimer.startTime) ||
    !isSafePositiveInteger(nextTimer.duration) ||
    nextTimer.remainingTime !== nextTimer.duration ||
    (nextTimer.status === TIMER_STATUSES.RUNNING &&
      nextTimer.startTime !== value.activationAt) ||
    (nextTimer.status === TIMER_STATUSES.PAUSED && nextTimer.startTime !== 0) ||
    (nextTimer.isAutoStarted !== undefined &&
      typeof nextTimer.isAutoStarted !== 'boolean') ||
    (nextTimer.hasConsumedFirstIntentionReset !== undefined &&
      typeof nextTimer.hasConsumedFirstIntentionReset !== 'boolean') ||
    !isExtensionCandidate(nextTimer.extensionCandidate) ||
    typeof value.clearIdleDetected !== 'boolean' ||
    value.clearHistory !== true ||
    !isIdleDetection(value.idleDetection) ||
    (value.extensionExpirationAt !== null &&
      !isSafeNonNegativeInteger(value.extensionExpirationAt))
  ) {
    throw malformedPlan();
  }

  const extensionState = parseMutation(value.extensionState, isExtensionState);
  const expectedExtensionExpiration =
    extensionState.kind === 'set' &&
    extensionState.value.maxDuration !== undefined
      ? extensionState.value.startTime + extensionState.value.maxDuration
      : null;
  if (value.extensionExpirationAt !== expectedExtensionExpiration) {
    throw malformedPlan();
  }
  if (
    value.idleDetection !== null &&
    (value.idleDetection.expectedTimer.timerId !== nextTimer.id ||
      value.idleDetection.expectedTimer.scheduleRevision !==
        nextTimer.scheduleRevision ||
      value.idleDetection.replacementTimer.userId !== nextTimer.userId ||
      value.idleDetection.replacementTimer.sessionPosition !==
        value.idleDetection.replacementSessionState.currentPosition ||
      value.idleDetection.replacementTimer.sessionTotal !==
        value.idleDetection.replacementSessionState.totalPomodoros)
  ) {
    throw malformedPlan();
  }

  return {
    source: {
      timerId: value.source.timerId,
      scheduleRevision: value.source.scheduleRevision,
    },
    activationAt: value.activationAt,
    nextTimer,
    sessionState: parseMutation(value.sessionState, isSessionState),
    extensionState,
    lastCompletionTimestamp: parseMutation(
      value.lastCompletionTimestamp,
      isSafeNonNegativeInteger
    ),
    extensionExpirationAt: value.extensionExpirationAt,
    clearIdleDetected: value.clearIdleDetected,
    clearHistory: true,
    idleDetection: value.idleDetection,
  };
}

function parseMutation<T>(
  value: unknown,
  validate: (candidate: unknown) => candidate is T
): TimerStateMutation<T> {
  if (
    !isRecord(value) ||
    !['keep', 'clear', 'set'].includes(String(value.kind))
  ) {
    throw malformedPlan();
  }
  if (value.kind === 'keep' || value.kind === 'clear') {
    return { kind: value.kind };
  }
  if (value.kind !== 'set' || !validate(value.value)) {
    throw malformedPlan();
  }
  return { kind: 'set', value: value.value };
}

function isSessionState(value: unknown): value is TimerSessionState {
  return (
    isRecord(value) &&
    isSafePositiveInteger(value.currentPosition) &&
    isSafePositiveInteger(value.totalPomodoros) &&
    value.currentPosition <= value.totalPomodoros &&
    (value.stackedSessions === undefined ||
      isSafePositiveInteger(value.stackedSessions))
  );
}

function isExtensionState(value: unknown): value is TimerExtensionState {
  return (
    isRecord(value) &&
    isSafeNonNegativeInteger(value.startTime) &&
    isNonEmptyString(value.originalTimerId) &&
    isSafePositiveInteger(value.originalDuration) &&
    (value.maxDuration === undefined ||
      isSafePositiveInteger(value.maxDuration)) &&
    (value.extensionNextTimerType === undefined ||
      Object.values(TIMER_TYPES).includes(
        value.extensionNextTimerType as TimerTypes
      ))
  );
}

function isExtensionCandidate(
  value: unknown
): value is TimerExtensionCandidate | undefined {
  return (
    value === undefined ||
    (isRecord(value) &&
      isNonEmptyString(value.originalTimerId) &&
      isSafePositiveInteger(value.originalDuration) &&
      (value.maxDuration === undefined ||
        isSafePositiveInteger(value.maxDuration)) &&
      (value.extensionNextTimerType === undefined ||
        Object.values(TIMER_TYPES).includes(
          value.extensionNextTimerType as TimerTypes
        )))
  );
}

function isIdleDetection(
  value: unknown
): value is TimerContinuationPlanV2['idleDetection'] {
  return (
    value === null ||
    (isRecord(value) &&
      isUuid(value.detectionId) &&
      isSafeNonNegativeInteger(value.checkAt) &&
      isSafePositiveInteger(value.longBreakDuration) &&
      isSafeNonNegativeInteger(value.expectedLastCompletionTimestamp) &&
      isTimerVersion(value.expectedTimer) &&
      isNonEmptyString(value.expectedRuntimeRevision) &&
      isUuid(value.longBreakTimerId) &&
      isReplacementTimer(value.replacementTimer) &&
      isSessionState(value.replacementSessionState) &&
      value.checkAt ===
        value.expectedLastCompletionTimestamp + value.longBreakDuration &&
      value.expectedRuntimeRevision === value.expectedTimer.scheduleRevision)
  );
}

function isLegacyIdleDetection(
  value: unknown
): value is TimerContinuationPlanV1['idleDetection'] {
  return (
    value === null ||
    (isRecord(value) &&
      isSafeNonNegativeInteger(value.checkAt) &&
      isSafePositiveInteger(value.longBreakDuration))
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function isTimerVersion(value: unknown): value is TimerVersion {
  return (
    isRecord(value) &&
    isNonEmptyString(value.timerId) &&
    isNonEmptyString(value.scheduleRevision)
  );
}

function isReplacementTimer(value: unknown): value is Timer {
  if (!isRecord(value)) return false;
  const timer = value as unknown as Timer;
  return (
    isUuid(timer.id) &&
    isUuid(timer.scheduleRevision) &&
    isNonEmptyString(timer.userId) &&
    timer.startTime === 0 &&
    isSafePositiveInteger(timer.duration) &&
    timer.remainingTime === timer.duration &&
    timer.type === TIMER_TYPES.WORK &&
    timer.status === TIMER_STATUSES.PAUSED &&
    isSafePositiveInteger(timer.sessionPosition) &&
    isSafePositiveInteger(timer.sessionTotal) &&
    timer.sessionPosition === 1 &&
    timer.sessionPosition <= timer.sessionTotal
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return isSafeNonNegativeInteger(value) && value > 0;
}

function malformedPlan(): UnprocessableEntityException {
  return new UnprocessableEntityException(
    'Timer continuation plan is malformed'
  );
}

interface TimerTransition {
  type: TimerTypes;
  startPaused: boolean;
  delayMs: number;
  stackedSessions?: number;
  focusedTaskIds?: string[];
  isAutoStarted?: boolean;
  extensionCandidate?: TimerExtensionCandidate;
}

function resolveTransition(
  timer: Timer,
  preferences: Preferences
): TimerTransition {
  if (timer.type === TIMER_TYPES.WORK) {
    if (timer.isExtension) {
      const type = timer.extensionNextTimerType ?? TIMER_TYPES.BREAK;
      const autoStart = resolveTimerAutoStart(preferences, type);
      return {
        type,
        startPaused: !autoStart,
        delayMs: 500,
        stackedSessions:
          type === TIMER_TYPES.BREAK ? timer.stackedSessions : undefined,
        isAutoStarted: autoStart,
      };
    }

    if (
      preferences.sessionsExtension &&
      timer.sessionPosition &&
      timer.sessionTotal &&
      timer.sessionPosition >= timer.sessionTotal
    ) {
      const type = preferences.sessionHasLongBreak
        ? TIMER_TYPES.LONG_BREAK
        : TIMER_TYPES.WORK;
      const autoStart = resolveTimerAutoStart(preferences, type);
      return {
        type,
        startPaused: !autoStart,
        delayMs: 500,
        focusedTaskIds: timer.focusedTaskIds,
        isAutoStarted: autoStart,
        extensionCandidate:
          preferences.sessionHasLongBreak && autoStart
            ? buildExtensionCandidate(
                timer,
                preferences,
                TIMER_TYPES.LONG_BREAK
              )
            : undefined,
      };
    }

    const autoStart = resolveTimerAutoStart(preferences, TIMER_TYPES.BREAK);
    return {
      type: TIMER_TYPES.BREAK,
      startPaused: !autoStart,
      delayMs: 500,
      stackedSessions: timer.stackedSessions,
      focusedTaskIds: timer.focusedTaskIds,
      isAutoStarted: autoStart,
      extensionCandidate: autoStart
        ? buildExtensionCandidate(timer, preferences, TIMER_TYPES.BREAK)
        : undefined,
    };
  }

  const autoStart = resolveTimerAutoStart(preferences, TIMER_TYPES.WORK);
  return {
    type: TIMER_TYPES.WORK,
    startPaused: !autoStart,
    isAutoStarted: autoStart,
    delayMs: 100,
  };
}

function resolveSessionState(
  timer: Timer,
  preferences: Preferences,
  nextType: TimerTypes
): TimerStateMutation<TimerSessionState> {
  if (!preferences.sessionsExtension) {
    return { kind: 'keep' };
  }

  if (
    timer.type === TIMER_TYPES.WORK &&
    !timer.isExtension &&
    timer.sessionPosition &&
    timer.sessionTotal
  ) {
    const nextPosition = timer.sessionPosition + 1;
    if (nextPosition <= timer.sessionTotal) {
      const displayEmoji = `${timer.intentionEmoji ?? ''}${timer.subIntentionEmoji ?? ''}`;
      return {
        kind: 'set',
        value: {
          currentPosition: nextPosition,
          totalPomodoros: timer.sessionTotal,
          stackedSessions: timer.stackedSessions,
          completedIntentionEmojis: {
            ...(timer.sessionIntentionEmojis ?? {}),
            ...(displayEmoji ? { [timer.sessionPosition]: displayEmoji } : {}),
          },
        },
      };
    }
    if (nextType === TIMER_TYPES.WORK) {
      return {
        kind: 'set',
        value: {
          currentPosition: 1,
          totalPomodoros: preferences.sessionPomodorosCount,
        },
      };
    }
  }

  if (nextType === TIMER_TYPES.LONG_BREAK) {
    return { kind: 'clear' };
  }

  if (timer.type === TIMER_TYPES.LONG_BREAK) {
    return {
      kind: 'set',
      value: {
        currentPosition: 1,
        totalPomodoros: preferences.sessionPomodorosCount,
      },
    };
  }

  const existing = sessionStateFromTimer(timer);
  if (existing) {
    return { kind: 'keep' };
  }

  if (nextType === TIMER_TYPES.WORK) {
    return {
      kind: 'set',
      value: {
        currentPosition: 1,
        totalPomodoros: preferences.sessionPomodorosCount,
      },
    };
  }

  return { kind: 'keep' };
}

function sessionStateFromTimer(timer: Timer): TimerSessionState | null {
  if (!timer.sessionPosition || !timer.sessionTotal) {
    return null;
  }
  return {
    currentPosition: timer.sessionPosition,
    totalPomodoros: timer.sessionTotal,
    stackedSessions: timer.stackedSessions,
    completedIntentionEmojis: timer.sessionIntentionEmojis,
  };
}

function resolveExtensionState(
  timer: Timer,
  preferences: Preferences,
  completedAt: number,
  nextType: TimerTypes
): TimerStateMutation<TimerExtensionState> {
  if (nextType === TIMER_TYPES.WORK) {
    return { kind: 'clear' };
  }
  if (
    timer.type !== TIMER_TYPES.WORK ||
    timer.isExtension ||
    !preferences.timerExtension
  ) {
    return { kind: 'keep' };
  }
  if (nextType === TIMER_TYPES.BREAK || nextType === TIMER_TYPES.LONG_BREAK) {
    if (!resolveBreakAutoStart(preferences, nextType)) {
      return {
        kind: 'set',
        value: buildExtensionState(timer, preferences, completedAt, nextType),
      };
    }
    return { kind: 'keep' };
  }
  return { kind: 'keep' };
}

function resolveBreakAutoStart(
  preferences: Preferences,
  type: TimerTypes
): boolean {
  return (
    (type === TIMER_TYPES.BREAK || type === TIMER_TYPES.LONG_BREAK) &&
    resolveTimerAutoStart(preferences, type)
  );
}

function resolveTimerAutoStart(preferences: Preferences, type: TimerTypes) {
  if (type === TIMER_TYPES.WORK) return preferences.autoStartWork ?? false;
  if (type === TIMER_TYPES.LONG_BREAK)
    return preferences.autoStartLongBreak ?? preferences.autoStartBreak;
  return preferences.autoStartBreak;
}

function buildExtensionCandidate(
  timer: Timer,
  preferences: Preferences,
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
    maxDuration:
      preferences.sessionsExtension &&
      preferences.sessionHasLongBreak &&
      preferences.sessionAutoDetectLongBreak
        ? preferences.sessionLongBreakDuration
        : undefined,
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

function buildExtensionState(
  timer: Timer,
  preferences: Preferences,
  startTime: number,
  extensionNextTimerType: TimerTypes
): TimerExtensionState {
  const candidate = buildExtensionCandidate(
    timer,
    preferences,
    extensionNextTimerType
  );
  if (!candidate) {
    throw new UnprocessableEntityException(
      'Extension state requires an eligible Work Timer'
    );
  }
  return {
    ...candidate,
    startTime,
  };
}

function durationForTransition(
  type: TimerTypes,
  stackedSessions: number | undefined,
  preferences: Preferences
): number {
  if (type === TIMER_TYPES.WORK) return preferences.workTimerDuration;
  if (type === TIMER_TYPES.LONG_BREAK) {
    return preferences.sessionLongBreakDuration;
  }
  return preferences.breakTimerDuration * (stackedSessions || 1);
}
