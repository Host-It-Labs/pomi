import { TIMER_TYPES, TimerTypes } from '@pomi/shared';
import { normalizeOptionalString } from './assistant-input-utils';
import type { AssistantTimerActionOutput } from './assistant-output-schemas';
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
    input: AssistantTimerActionOutput,
    intentions: AssistantCaptureIntention[],
    sourceText: string
  ): ParsedTimerCommand {
    const value = input;
    const action =
      value.action === 'none' ? this.inferAction(sourceText) : value.action;
    const timerType =
      value.timerType ?? this.inferTimerType(sourceText) ?? TIMER_TYPES.WORK;
    if (action !== 'startTimer') {
      return { action, timerType, intentionSlugs: [], subIntentions: {} };
    }

    const intentionSlugs = new Set<string>();
    const subIntentions: Record<string, string> = {};
    for (const rawSlug of value.intentionSlugs) {
      const parent = this.findParent(rawSlug, timerType, intentions);
      if (parent) intentionSlugs.add(parent.slug);
    }

    for (const {
      intentionSlug: rawParent,
      subIntentionSlug: rawChild,
    } of value.subIntentions) {
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

    return {
      action,
      timerType,
      intentionSlugs: Array.from(intentionSlugs),
      subIntentions,
    };
  }

  private findParent(
    value: string,
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
    value: string,
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
