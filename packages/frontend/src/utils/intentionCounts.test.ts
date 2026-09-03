import { TIMER_TYPES } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import {
  getTypedAggregateCount,
  getTypedLeafCount,
  mergeIntentionCounts,
} from './intentionCounts';
import { orderIntentionsForHabits } from './habits';

describe('intention count aggregation', () => {
  it('keeps same-slug Break and Long Break counts separate', () => {
    const counts = mergeIntentionCounts([
      {
        type: TIMER_TYPES.BREAK,
        count: 2,
        bySlug: { reset: 2 },
        subBySlug: {},
      },
      {
        type: TIMER_TYPES.LONG_BREAK,
        count: 1,
        bySlug: { reset: 0 },
        subBySlug: { breathe: 1 },
      },
    ]);

    expect(counts.count).toBe(3);
    expect(
      getTypedLeafCount(
        TIMER_TYPES.BREAK,
        'reset',
        counts.byTypedSlug,
        counts.subByTypedSlug
      )
    ).toBe(2);
    expect(
      getTypedLeafCount(
        TIMER_TYPES.LONG_BREAK,
        'reset',
        counts.byTypedSlug,
        counts.subByTypedSlug
      )
    ).toBe(0);
  });

  it('counts child sessions toward their weekly Parent', () => {
    const counts = mergeIntentionCounts([
      {
        type: TIMER_TYPES.WORK,
        count: 1,
        bySlug: {},
        subBySlug: { review: 1 },
      },
    ]);

    expect(
      getTypedAggregateCount(
        TIMER_TYPES.WORK,
        'focus',
        ['review'],
        counts.byTypedSlug,
        counts.subByTypedSlug
      )
    ).toBe(1);
  });

  it('moves pending habits first without disturbing either group', () => {
    const intentions = [
      { slug: 'done', state: 'done' as const },
      { slug: 'pending-1', state: 'pending' as const },
      { slug: 'ordinary', state: null },
      { slug: 'pending-2', state: 'pending' as const },
    ];

    expect(orderIntentionsForHabits(intentions, item => item.state)).toEqual([
      intentions[1],
      intentions[3],
      intentions[0],
      intentions[2],
    ]);
  });
});
