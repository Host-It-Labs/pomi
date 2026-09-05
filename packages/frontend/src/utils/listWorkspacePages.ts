import type { ListItem } from '@pomi/shared';

const ACTIVE_PAGE_SIZE = 5;
// Historical pages reserve space for the status heading and reset action.
const HISTORY_PAGE_SIZE = 4;

export function getListWorkspacePages(
  active: ListItem[],
  completed: ListItem[],
  archived: ListItem[]
) {
  const pages: Array<{
    active: ListItem[];
    completed: ListItem[];
    archived: ListItem[];
  }> = [];
  for (const [status, items, size] of [
    ['active', active, ACTIVE_PAGE_SIZE],
    ['completed', completed, HISTORY_PAGE_SIZE],
    ['archived', archived, HISTORY_PAGE_SIZE],
  ] as const) {
    for (let index = 0; index < items.length; index += size) {
      pages.push({
        active: [],
        completed: [],
        archived: [],
        [status]: items.slice(index, index + size),
      });
    }
  }
  return pages.length ? pages : [{ active: [], completed: [], archived: [] }];
}
