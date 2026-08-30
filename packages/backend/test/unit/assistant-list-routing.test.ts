import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TIMER_TYPES } from '@pomi/shared';
import { AssistantListRoutingService } from '../../src/assistant/assistant-list-routing.service';

type RouteListItems = (
  drafts: Array<{
    title: string;
    dueDate?: string | null;
    dueTime?: string | null;
    priority?: string;
    description?: string | null;
    recurrenceRule?: string | null;
    recurrenceInterval?: number | null;
    sourceTranscript?: string | null;
    timerType?: string | null;
    listId?: string | null;
  }>,
  sourceText: string,
  lists: Array<{ id: string; title: string }>,
  language?: string | null
) => Array<{ title: string; listId?: string | null }>;

const routingService = new AssistantListRoutingService();
const routeListItems = (
  routingService as unknown as {
    routeExplicitListItems: RouteListItems;
  }
).routeExplicitListItems;
const routeSelectedListItems = (
  routingService as unknown as {
    routeSelectedListItems: (
      drafts: Parameters<RouteListItems>[0],
      sourceText: string,
      selectedListId: string,
      lists: Array<{ id: string; title: string }>,
      language?: string | null
    ) => ReturnType<RouteListItems>;
  }
).routeSelectedListItems;

describe('Assistant explicit List routing', () => {
  const lists = [
    { id: 'groceries-id', title: 'Groceries' },
    { id: 'packing-id', title: 'Packing' },
  ];

  it('routes every extracted item when the whole request explicitly targets one List', () => {
    const drafts = [{ title: 'Milk' }, { title: 'Eggs' }];

    expect(
      routeListItems.call(
        routingService,
        drafts,
        'Add milk and eggs to the Groceries list',
        lists
      )
    ).toEqual([
      { title: 'Milk', listId: 'groceries-id' },
      { title: 'Eggs', listId: 'groceries-id' },
    ]);
  });

  it('routes a Task when the destination is phrased as its linked List', () => {
    expect(
      routeListItems.call(
        routingService,
        [{ title: 'Buy milk' }],
        'Create a task to buy milk with Groceries as its List',
        lists
      )
    ).toEqual([{ title: 'Buy milk', listId: 'groceries-id' }]);
  });

  it('rejects mixed requests after an explicit List target', () => {
    const drafts = [{ title: 'Milk' }, { title: 'Call Mum' }];

    expect(() =>
      routeListItems.call(
        routingService,
        drafts,
        'Add milk to the Groceries list and call Mum',
        lists
      )
    ).toThrow(BadRequestException);
    expect(
      routeListItems.call(
        routingService,
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
          routingService,
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
        routingService,
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

  it('routes a List target before trailing supported metadata', () => {
    const drafts = [
      { title: 'Milk', dueDate: '2026-08-30', priority: 'high' },
      { title: 'Eggs', dueDate: '2026-08-30', priority: 'high' },
    ];

    expect(
      routeListItems.call(
        routingService,
        drafts,
        'Add milk and eggs to the Groceries list, due tomorrow, high priority',
        lists
      )
    ).toEqual([
      {
        title: 'Milk',
        dueDate: '2026-08-30',
        priority: 'high',
        listId: 'groceries-id',
      },
      {
        title: 'Eggs',
        dueDate: '2026-08-30',
        priority: 'high',
        listId: 'groceries-id',
      },
    ]);
  });

  it('rejects mixed unsupported text after a List target', () => {
    const drafts = [{ title: 'Milk', dueDate: '2026-08-30' }];

    expect(() =>
      routeListItems.call(
        routingService,
        drafts,
        'Add milk to the Groceries list due tomorrow and include a note',
        lists
      )
    ).toThrow(
      'List items support title, due date, priority, and Vacation Coverage only'
    );
  });

  it('rejects an explicitly named List that is unavailable', () => {
    const drafts = [{ title: 'Milk' }];

    expect(() =>
      routeListItems.call(
        routingService,
        drafts,
        'Add milk to the Errands list',
        lists
      )
    ).toThrow(
      'That List is unavailable. Choose an existing List before saving'
    );
  });

  it('reports an unavailable explicit List even when extraction returned no drafts', () => {
    expect(() =>
      routeListItems.call(
        routingService,
        [],
        'Add milk to the Errands list',
        lists
      )
    ).toThrow(
      'That List is unavailable. Choose an existing List before saving'
    );
  });

  it('returns localized feedback for unsupported metadata after a List target', () => {
    const drafts = [{ title: 'Milk', dueTime: '17:00' }];

    expect(() =>
      routeListItems.call(
        routingService,
        drafts,
        'Add milk to the Groceries list at 17:00',
        lists,
        'fr'
      )
    ).toThrow(
      'Les éléments de liste prennent uniquement en charge le titre, la date d’échéance, la priorité et Vacation Coverage.'
    );
  });

  it('prefers the longest exact List name when names overlap', () => {
    const drafts = [{ title: 'Review the plan' }];
    const overlappingLists = [
      { id: 'work-id', title: 'Work' },
      { id: 'work-projects-id', title: 'Work Projects' },
    ];

    expect(
      routeListItems.call(
        routingService,
        drafts,
        'Add review the plan to Work Projects list tomorrow',
        overlappingLists
      )
    ).toEqual([{ title: 'Review the plan', listId: 'work-projects-id' }]);
  });

  it('rejects multiple explicit List destinations as ambiguous', () => {
    const drafts = [{ title: 'Milk' }, { title: 'Bread' }];

    expect(() =>
      routeListItems.call(
        routingService,
        drafts,
        'Add milk to the Groceries list and bread to the Packing list',
        lists
      )
    ).toThrow('Choose one List destination before saving');
  });

  it('rejects a conflicting List destination returned by the parser', () => {
    const drafts = [{ title: 'Milk', listId: 'packing-id' }];

    expect(() =>
      routeListItems.call(
        routingService,
        drafts,
        'Add milk to the Groceries list',
        lists
      )
    ).toThrow('Choose one List destination before saving');
  });

  it('routes a selected List through the same explicit destination path', () => {
    const drafts = [{ title: 'Milk', dueDate: '2026-08-30', priority: 'high' }];

    expect(
      routeSelectedListItems.call(
        routingService,
        drafts,
        'Add milk due tomorrow, high priority',
        'groceries-id',
        lists
      )
    ).toEqual([
      {
        title: 'Milk',
        dueDate: '2026-08-30',
        priority: 'high',
        listId: 'groceries-id',
      },
    ]);
  });

  it('rejects an over-split selected List quick add instead of creating multiple items', () => {
    expect(() =>
      routeSelectedListItems.call(
        routingService,
        [{ title: 'Milk' }, { title: 'Eggs' }],
        'Add milk and eggs',
        'groceries-id',
        lists
      )
    ).toThrow('Add one List item at a time');
  });

  it('rejects a selected List that conflicts with an explicit List mention', () => {
    expect(() =>
      routeSelectedListItems.call(
        routingService,
        [{ title: 'Milk' }],
        'Add milk to the Packing list',
        'groceries-id',
        lists
      )
    ).toThrow('Choose one List destination before saving');
  });

  it('requires a deterministic exact List name', () => {
    const drafts = [{ title: 'Milk' }];
    const ambiguousLists = [
      { id: 'one', title: 'Groceries!' },
      { id: 'two', title: 'Groceries' },
    ];

    expect(() =>
      routeListItems.call(
        routingService,
        drafts,
        'Add milk to groceries',
        ambiguousLists
      )
    ).toThrow('Choose one List destination before saving');
  });
});
