import { Timer, TimerExtensionState } from '@pomi/shared';

function normalizeIntentions(
  intention?: string,
  intentionSlugs?: string[]
): string[] {
  const values = Array.isArray(intentionSlugs)
    ? intentionSlugs
    : intention
      ? [intention]
      : [];

  return Array.from(new Set(values.filter(Boolean)));
}

export function getSelectedTimerIntentions(
  timer?: Pick<Timer, 'intention' | 'intentionSlugs'> | null
): string[] {
  if (!timer) {
    return [];
  }

  return normalizeIntentions(timer.intention, timer.intentionSlugs);
}

export function getSelectedExtensionIntentions(
  extensionState?: Pick<
    TimerExtensionState,
    'intention' | 'intentionSlugs'
  > | null
): string[] {
  if (!extensionState) {
    return [];
  }

  return normalizeIntentions(
    extensionState.intention,
    extensionState.intentionSlugs
  );
}

export function getAdditionalSelectedIntentionsCount(
  timer?: Pick<Timer, 'intention' | 'intentionSlugs'> | null
): number {
  const selectedIntentions = getSelectedTimerIntentions(timer);
  return selectedIntentions.length > 1 ? selectedIntentions.length - 1 : 0;
}
