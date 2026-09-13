import type { List, ListItem, TaskListChange } from '@pomi/shared';

const LIST_REFRESH_REQUESTED_EVENT = 'pomi:list-refresh-requested';

export type ListRealtimeChange = Extract<
  TaskListChange,
  { entityType: 'list' | 'listItem' }
>;
export type ListRefreshUpdate =
  ListRealtimeChange[] | { snapshot: { lists: List[]; listItems: ListItem[] } };

export function requestListRefresh() {
  window.dispatchEvent(new Event(LIST_REFRESH_REQUESTED_EVENT));
}

export function applyListRealtimeChanges(changes: ListRealtimeChange[]) {
  window.dispatchEvent(
    new CustomEvent(LIST_REFRESH_REQUESTED_EVENT, { detail: changes })
  );
}

export function applyListSnapshot(lists: List[], listItems: ListItem[]) {
  window.dispatchEvent(
    new CustomEvent(LIST_REFRESH_REQUESTED_EVENT, {
      detail: { snapshot: { lists, listItems } } satisfies ListRefreshUpdate,
    })
  );
}

export function reduceRealtimeLists(
  current: List[],
  changes: ListRealtimeChange[]
) {
  return changes.reduce((lists, change) => {
    if (change.entityType !== 'list') return lists;
    if (
      change.operation === 'delete' ||
      !change.payload ||
      change.payload.isArchived
    ) {
      return lists.filter(list => list.id !== change.entityId);
    }
    const next = change.payload;
    return [...lists.filter(list => list.id !== next.id), next];
  }, current);
}

export function reduceRealtimeListItems(
  current: ListItem[],
  changes: ListRealtimeChange[]
) {
  return changes.reduce((items, change) => {
    if (change.entityType !== 'listItem') return items;
    if (
      change.operation === 'delete' ||
      !change.payload ||
      change.payload.status !== 'active'
    ) {
      return items.filter(item => item.id !== change.entityId);
    }
    const next = change.payload;
    return [...items.filter(item => item.id !== next.id), next];
  }, current);
}

export function subscribeToListRefresh(
  listener: (update?: ListRefreshUpdate) => void
) {
  const eventListener = (event: Event) => {
    listener((event as CustomEvent<ListRefreshUpdate>).detail);
  };
  window.addEventListener(LIST_REFRESH_REQUESTED_EVENT, eventListener);
  return () =>
    window.removeEventListener(LIST_REFRESH_REQUESTED_EVENT, eventListener);
}
