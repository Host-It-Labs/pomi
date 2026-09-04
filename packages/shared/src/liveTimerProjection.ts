import { z } from 'zod';
import type { Timer, TimerTypes } from './types';

export const LIVE_TIMER_PROJECTION_VERSION = 1 as const;

export const LIVE_TIMER_ACTION_KINDS = [
  'pause',
  'resume',
  'addFive',
  'skip',
] as const;

export type LiveTimerActionKind = (typeof LIVE_TIMER_ACTION_KINDS)[number];
export type LiveTimerPlatform = 'android' | 'ios';

export type LiveTimerProjectionOptions = {
  platform: LiveTimerPlatform;
  includeIntentionTitle: boolean;
  nowMs?: number;
};

const liveTimerActionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
  kind: z.enum(LIVE_TIMER_ACTION_KINDS),
  expectedTimerRevision: z.string().min(1).max(128),
  isSupported: z.boolean(),
  deepLink: z
    .string()
    .url()
    .refine(value => value.startsWith('pomi://')),
});

export const liveTimerProjectionSchema = z
  .object({
    version: z.literal(LIVE_TIMER_PROJECTION_VERSION),
    timerID: z.string().min(1).max(128),
    timerRevision: z.string().min(1).max(128),
    status: z.enum(['running', 'paused']),
    timerType: z.enum(['work', 'break', 'longBreak']),
    emoji: z.string().max(16).optional(),
    absoluteDeadline: z.string().datetime().optional(),
    pausedRemainingSeconds: z.number().int().min(0).optional(),
    intention: z
      .object({
        emoji: z.string().max(16).optional(),
        title: z.string().max(80).optional(),
        titlePrivacy: z.enum(['private', 'public']),
      })
      .optional(),
    actions: z.array(liveTimerActionSchema).max(4),
    deepLink: z
      .string()
      .url()
      .refine(value => value.startsWith('pomi://')),
  })
  .superRefine((projection, context) => {
    if (projection.status === 'running' && !projection.absoluteDeadline) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['absoluteDeadline'],
        message: 'Running Timer projections require an absolute deadline',
      });
    }
    if (
      projection.status === 'paused' &&
      projection.pausedRemainingSeconds === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pausedRemainingSeconds'],
        message: 'Paused Timer projections require confirmed remaining time',
      });
    }
    if (
      projection.actions.some(
        action => action.expectedTimerRevision !== projection.timerRevision
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actions'],
        message: 'Timer action revisions must match the projection revision',
      });
    }
  });

export type LiveTimerProjection = z.infer<typeof liveTimerProjectionSchema>;

export function buildLiveTimerProjection(
  timer: Timer | null,
  options: LiveTimerProjectionOptions
): LiveTimerProjection | null {
  if (
    !timer ||
    timer.status === 'completed' ||
    !timer.scheduleRevision ||
    (timer.status !== 'running' && timer.status !== 'paused')
  ) {
    return null;
  }

  const timerRevision = timer.scheduleRevision;
  const actions = actionKindsFor(timer.status).map(kind => {
    const id = nativeActionID(timer.id, timerRevision, kind);
    const query = new URLSearchParams({
      action: kind,
      actionId: id,
      timerId: timer.id,
      expectedScheduleRevision: timerRevision,
      timerType: timer.type,
    });
    return {
      id,
      kind,
      expectedTimerRevision: timerRevision,
      isSupported: options.platform === 'android',
      deepLink: `pomi://timer-action?${query.toString()}`,
    };
  });

  const intentionEmoji =
    sanitizeDisplay(timer.subIntentionEmoji, 16) ??
    sanitizeDisplay(timer.intentionEmoji, 16);
  const intentionTitle = options.includeIntentionTitle
    ? (sanitizeDisplay(timer.subIntentionTitle, 80) ??
      sanitizeDisplay(timer.intentionTitle, 80))
    : undefined;
  const intention =
    intentionEmoji || intentionTitle
      ? {
          ...(intentionEmoji ? { emoji: intentionEmoji } : {}),
          ...(intentionTitle ? { title: intentionTitle } : {}),
          titlePrivacy: options.includeIntentionTitle
            ? ('public' as const)
            : ('private' as const),
        }
      : undefined;

  const projection: LiveTimerProjection = {
    version: LIVE_TIMER_PROJECTION_VERSION,
    timerID: timer.id,
    timerRevision,
    status: timer.status,
    timerType: timer.type,
    emoji: timerTypeEmoji(timer.type),
    ...(timer.status === 'running'
      ? {
          absoluteDeadline: new Date(
            Math.max(
              options.nowMs ?? Date.now(),
              timer.startTime + timer.duration
            )
          ).toISOString(),
        }
      : {
          pausedRemainingSeconds: Math.max(
            0,
            Math.ceil(timer.remainingTime / 1000)
          ),
        }),
    ...(intention ? { intention } : {}),
    actions,
    deepLink: 'pomi://timer',
  };

  return liveTimerProjectionSchema.parse(projection);
}

function actionKindsFor(status: 'running' | 'paused'): LiveTimerActionKind[] {
  return [status === 'running' ? 'pause' : 'resume', 'addFive', 'skip'];
}

function nativeActionID(
  timerID: string,
  timerRevision: string,
  kind: LiveTimerActionKind
): string {
  const candidate = `native:${timerID}:${timerRevision}:${kind}`;
  if (candidate.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(candidate)) {
    return candidate;
  }
  return `native:${stableHash(candidate)}:${kind}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeDisplay(value: string | undefined, maxLength: number) {
  const normalized = Array.from(value ?? '')
    .filter(character => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function timerTypeEmoji(type: TimerTypes): string {
  if (type === 'break') return '☕️';
  if (type === 'longBreak') return '🌿';
  return '🎯';
}
