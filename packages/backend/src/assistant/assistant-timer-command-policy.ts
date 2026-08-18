import { TIMER_TYPES, TimerTypes } from '@pomi/shared';
import { normalizeOptionalString, toRecord } from './assistant-input-utils';
import {
  AssistantCaptureIntention,
  ParsedTimerCommand,
} from './assistant-input-types';

export const EMPTY_TIMER_COMMAND: ParsedTimerCommand = {
  action: 'none',
  intentionSlugs: [],
  subIntentions: {},
};

export class AssistantTimerCommandPolicy {
  normalize(
    input: unknown,
    intentions: AssistantCaptureIntention[],
    sourceText = ''
  ): ParsedTimerCommand {
    const value = toRecord(input);
    const action =
      this.sanitizeAction(value.action) === 'none'
        ? this.inferAction(sourceText)
        : this.sanitizeAction(value.action);
    const timerType =
      this.sanitizeTimerType(value.timerType) ??
      this.inferTimerType(sourceText) ??
      TIMER_TYPES.WORK;
    if (action !== 'startTimer') {
      return { action, timerType, intentionSlugs: [], subIntentions: {} };
    }

    const intentionSlugs = new Set<string>();
    const subIntentions: Record<string, string> = {};
    const rawSlugs = Array.isArray(value.intentionSlugs)
      ? value.intentionSlugs
      : value.intentionSlug
        ? [value.intentionSlug]
        : [];
    for (const rawSlug of rawSlugs) {
      const parent = this.findParent(rawSlug, timerType, intentions);
      if (parent) intentionSlugs.add(parent.slug);
    }

    const rawSubs = toRecord(value.subIntentions);
    for (const [rawParent, rawChild] of Object.entries(rawSubs)) {
      const parent = this.findParent(rawParent, timerType, intentions);
      const child = this.findChild(
        rawChild,
        parent?.slug,
        timerType,
        intentions
      );
      if (parent && child) {
        intentionSlugs.add(parent.slug);
        subIntentions[parent.slug] = child.slug;
      }
    }

    const parent = this.findParent(value.intentionSlug, timerType, intentions);
    const child = this.findChild(
      value.subIntentionSlug,
      parent?.slug,
      timerType,
      intentions
    );
    if (parent && child) {
      intentionSlugs.add(parent.slug);
      subIntentions[parent.slug] = child.slug;
    }

    return {
      action,
      timerType,
      intentionSlugs: Array.from(intentionSlugs),
      subIntentions,
    };
  }

  private findParent(
    value: unknown,
    timerType: TimerTypes,
    intentions: AssistantCaptureIntention[]
  ) {
    const slug = normalizeOptionalString(value);
    return slug
      ? (intentions.find(
          intention =>
            intention.slug === slug &&
            intention.type === timerType &&
            !intention.parentSlug
        ) ?? null)
      : null;
  }

  private findChild(
    value: unknown,
    parentSlug: string | undefined,
    timerType: TimerTypes,
    intentions: AssistantCaptureIntention[]
  ) {
    const slug = normalizeOptionalString(value);
    return slug && parentSlug
      ? (intentions.find(
          intention =>
            intention.slug === slug &&
            intention.type === timerType &&
            intention.parentSlug === parentSlug
        ) ?? null)
      : null;
  }

  private sanitizeTimerType(value: unknown): TimerTypes | undefined {
    return value === TIMER_TYPES.WORK ||
      value === TIMER_TYPES.BREAK ||
      value === TIMER_TYPES.LONG_BREAK
      ? value
      : undefined;
  }

  private sanitizeAction(value: unknown): ParsedTimerCommand['action'] {
    return value === 'startTimer' ||
      value === 'pauseTimer' ||
      value === 'addFiveMinutes'
      ? value
      : 'none';
  }

  private inferAction(sourceText: string): ParsedTimerCommand['action'] {
    if (
      /\b(?:add|give|put)\s+(?:me\s+)?(?:five|5)\s+minutes?\b/i.test(sourceText)
    ) {
      return 'addFiveMinutes';
    }
    if (
      /\b(?:pause|stop|hold)\b[\s\S]{0,24}\b(?:timer|pomodoro|session)\b/i.test(
        sourceText
      )
    ) {
      return 'pauseTimer';
    }
    if (
      /\b(?:start|begin|launch|activate|set|put)\b[\s\S]{0,36}\b(?:timer|pomodoro|session)\b/i.test(
        sourceText
      )
    ) {
      return 'startTimer';
    }
    return 'none';
  }

  private inferTimerType(sourceText: string): TimerTypes | undefined {
    if (
      !/\b(?:timer|pomodoro|session)\b/i.test(sourceText) &&
      !/\b(?:start|begin|pause|stop|add)\b[\s\S]{0,24}\b(?:minutes?|time)\b/i.test(
        sourceText
      )
    ) {
      return undefined;
    }
    if (/\blong[- ]?break\b/i.test(sourceText)) {
      return TIMER_TYPES.LONG_BREAK;
    }
    if (/\bbreak\b/i.test(sourceText)) {
      return TIMER_TYPES.BREAK;
    }
    if (/\bwork\b/i.test(sourceText)) {
      return TIMER_TYPES.WORK;
    }
    return undefined;
  }
}
