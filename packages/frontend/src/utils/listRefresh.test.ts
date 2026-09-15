import type { List, ListItem } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import {
  type ListRealtimeChange,
  reduceRealtimeListItems,
  reduceRealtimeLists,
} from './listRefresh';

describe('list realtime reducers', () => {
  it('applies List upserts and tombstones without a collection reload', () => {
    const original = [{ id: 'old', isArchived: false }] as List[];
    const next = { id: 'new', isArchived: false } as List;
    const changes = [
      {
        revision: 1,
        entityType: 'list',
        entityId: 'old',
        operation: 'delete',
        payload: null,
      },
      {
        revision: 2,
        entityType: 'list',
        entityId: 'new',
        operation: 'upsert',
        payload: next,
      },
    ] as ListRealtimeChange[];

    expect(reduceRealtimeLists(original, changes)).toEqual([next]);
  });

  it('removes completed List items and upserts active items', () => {
    const original = [{ id: 'done', status: 'active' }] as ListItem[];
    const active = { id: 'active', status: 'active' } as ListItem;
    const completed = { id: 'done', status: 'completed' } as ListItem;
    const changes = [
      {
        revision: 1,
        entityType: 'listItem',
        entityId: 'active',
        operation: 'upsert',
        payload: active,
      },
      {
        revision: 2,
        entityType: 'listItem',
        entityId: 'done',
        operation: 'upsert',
        payload: completed,
      },
    ] as ListRealtimeChange[];

    expect(reduceRealtimeListItems(original, changes)).toEqual([active]);
  });
});
