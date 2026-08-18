import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TIMER_TYPES } from '@pomi/shared';
import { AssistantCaptureService } from '../../src/assistant/assistant-capture.service';

type RouteListItems = (
  drafts: Array<{
    title: string;
    dueTime?: string | null;
    description?: string | null;
    recurrenceRule?: string | null;
    sourceTranscript?: string | null;
    timerType?: string | null;
  }>,
  sourceText: string,
  lists: Array<{ id: string; title: string }>
) => Array<{ title: string; listId?: string | null }>;

const routeListItems = (
  AssistantCaptureService.prototype as unknown as {
    routeExplicitListItems: RouteListItems;
  }
).routeExplicitListItems;

describe('Assistant explicit List routing', () => {
  const lists = [
    { id: 'groceries-id', title: 'Groceries' },
    { id: 'packing-id', title: 'Packing' },
  ];

  it('routes every extracted item when the whole request explicitly targets one List', () => {
    const drafts = [{ title: 'Milk' }, { title: 'Eggs' }];

    expect(
      routeListItems.call(
        AssistantCaptureService.prototype,
        drafts,
        'Add milk and eggs to the Groceries list',
        lists
      )
    ).toEqual([
      { title: 'Milk', listId: 'groceries-id' },
      { title: 'Eggs', listId: 'groceries-id' },
    ]);
  });

  it('keeps ambiguous or mixed requests as Tasks', () => {
    const drafts = [{ title: 'Milk' }, { title: 'Call Mum' }];

    expect(
      routeListItems.call(
        AssistantCaptureService.prototype,
        drafts,
        'Add milk to the Groceries list and call Mum',
        lists
      )
    ).toBe(drafts);
    expect(
      routeListItems.call(
        AssistantCaptureService.prototype,
        drafts,
        'Remember milk and eggs for groceries',
        lists
      )
    ).toBe(drafts);
  });

  it('rejects explicitly targeted List items with unsupported metadata', () => {
    for (const draft of [
      { title: 'Milk', dueTime: '17:00' },
      { title: 'Milk', description: 'Use the lactose-free brand' },
      { title: 'Milk', recurrenceRule: 'FREQ=WEEKLY' },
      { title: 'Milk', timerType: TIMER_TYPES.BREAK },
      { title: 'Milk', timerType: TIMER_TYPES.LONG_BREAK },
    ]) {
      const drafts = [draft];
      expect(() =>
        routeListItems.call(
          AssistantCaptureService.prototype,
          drafts,
          'Add milk to the Groceries list',
          lists
        )
      ).toThrow(BadRequestException);
    }
  });

  it('keeps voice transcripts while routing supported List items', () => {
    const drafts = [
      { title: 'Milk', sourceTranscript: 'milk from the farm shop' },
    ];

    expect(
      routeListItems.call(
        AssistantCaptureService.prototype,
        drafts,
        'Put milk into groceries',
        lists
      )
    ).toEqual([
      {
        title: 'Milk',
        sourceTranscript: 'milk from the farm shop',
        listId: 'groceries-id',
      },
    ]);
  });

  it('requires a deterministic exact List name', () => {
    const drafts = [{ title: 'Milk' }];
    const ambiguousLists = [
      { id: 'one', title: 'Groceries!' },
      { id: 'two', title: 'Groceries' },
    ];

    expect(
      routeListItems.call(
        AssistantCaptureService.prototype,
        drafts,
        'Add milk to groceries',
        ambiguousLists
      )
    ).toBe(drafts);
  });
});
