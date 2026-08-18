import type { List, ListItem, Task, TaskSortMode } from '@pomi/shared';
import { compareTasksByDueAndPriority } from './taskView';

export type MixedTaskItem =
  | { kind: 'task'; task: Task }
  | { kind: 'listItem'; item: ListItem; list: List };

export type MixedTaskSortMode = TaskSortMode;

export type MixedListItemEntry = {
  item: ListItem;
  list: List;
};

function getOrderingItem(entry: MixedTaskItem) {
  if (entry.kind === 'task') return entry.task;
  return { ...entry.item, dueTime: null };
}

function getCreatedAt(entry: MixedTaskItem) {
  return entry.kind === 'task' ? entry.task.createdAt : entry.item.createdAt;
}

function getId(entry: MixedTaskItem) {
  return entry.kind === 'task' ? entry.task.id : entry.item.id;
}

export function sortMixedTaskItems(
  entries: MixedTaskItem[],
  mode: MixedTaskSortMode
) {
  return [...entries].sort((a, b) => {
    if (mode !== 'default') {
      const createdCompare =
        mode === 'created-desc'
          ? getCreatedAt(b).localeCompare(getCreatedAt(a))
          : getCreatedAt(a).localeCompare(getCreatedAt(b));
      return createdCompare || getId(a).localeCompare(getId(b));
    }

    const aPinned = a.kind === 'task' && a.task.pinnedAt !== null;
    const bPinned = b.kind === 'task' && b.task.pinnedAt !== null;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (aPinned && bPinned && a.kind === 'task' && b.kind === 'task') {
      return (a.task.pinnedAt ?? '').localeCompare(b.task.pinnedAt ?? '');
    }

    return (
      compareTasksByDueAndPriority(
        getOrderingItem(a),
        getOrderingItem(b),
        getTodayDate(),
        getCurrentTime()
      ) || getId(a).localeCompare(getId(b))
    );
  });
}

export function mixTaskAndListItems(
  tasks: Task[],
  listItems: MixedListItemEntry[],
  mode: MixedTaskSortMode
): MixedTaskItem[] {
  const taskEntries = tasks.map(task => ({
    kind: 'task' as const,
    task,
  }));
  if (listItems.length === 0) {
    return taskEntries;
  }

  return sortMixedTaskItems(
    [
      ...taskEntries,
      ...listItems.map(({ item, list }) => ({
        kind: 'listItem' as const,
        item,
        list,
      })),
    ],
    mode
  );
}

function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}`;
}
