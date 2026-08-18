import { IntentionType, TimerTypes } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';

type BreakPickerIntention = {
  slug: string;
  title: string;
  sourceType: IntentionType;
};

export function shouldMixBreakIntentionTypes(
  type: TimerTypes | IntentionType | undefined,
  enabled?: boolean
): boolean {
  return !!enabled && type === TIMER_TYPES.LONG_BREAK;
}

export function getBreakIntentionQueryTypes(
  type: IntentionType,
  enabled?: boolean
): IntentionType[] {
  if (!shouldMixBreakIntentionTypes(type, enabled)) {
    return [type];
  }

  return [TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK];
}

export function sortMixedBreakIntentionsByTypeAndCount<
  T extends BreakPickerIntention,
>(intentions: T[], getCount: (intention: T) => number): T[] {
  const getTypeRank = (sourceType: IntentionType) =>
    sourceType === TIMER_TYPES.LONG_BREAK
      ? 0
      : sourceType === TIMER_TYPES.BREAK
        ? 1
        : 2;

  return [...intentions]
    .map((intention, index) => ({ intention, index }))
    .sort((a, b) => {
      const typeDifference =
        getTypeRank(a.intention.sourceType) -
        getTypeRank(b.intention.sourceType);
      if (typeDifference !== 0) {
        return typeDifference;
      }

      const countDifference = getCount(b.intention) - getCount(a.intention);
      if (countDifference !== 0) {
        return countDifference;
      }

      const titleDifference = a.intention.title.localeCompare(
        b.intention.title
      );
      return titleDifference || a.index - b.index;
    })
    .map(({ intention }) => intention);
}

export function getMixedBreakButtonClasses(
  sourceType: IntentionType,
  selected: boolean,
  mixedBreakContext: boolean
): {
  buttonClass: string;
  markerClass: string;
} {
  const markerClass =
    mixedBreakContext && sourceType !== TIMER_TYPES.WORK
      ? sourceType === TIMER_TYPES.LONG_BREAK
        ? 'bg-violet-400'
        : 'bg-emerald-400'
      : '';

  if (sourceType === TIMER_TYPES.LONG_BREAK) {
    return {
      buttonClass: selected
        ? 'bg-violet-950/35 ring-2 ring-violet-400 text-violet-100 shadow-md'
        : 'bg-violet-950/18 ring-2 ring-violet-700/45 text-slate-100 hover:ring-violet-500/70',
      markerClass,
    };
  }

  if (sourceType === TIMER_TYPES.BREAK) {
    return {
      buttonClass: selected
        ? 'bg-emerald-950/35 ring-2 ring-emerald-400 text-emerald-100 shadow-md'
        : 'bg-emerald-950/18 ring-2 ring-emerald-700/45 text-slate-100 hover:ring-emerald-500/70',
      markerClass,
    };
  }

  return {
    buttonClass: selected
      ? 'bg-indigo-950/35 ring-2 ring-indigo-400 text-indigo-100 shadow-md'
      : 'bg-indigo-950/18 ring-2 ring-indigo-700/45 text-slate-100 hover:ring-indigo-500/70',
    markerClass,
  };
}
