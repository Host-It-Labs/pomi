import type { ListItem } from '@pomi/shared';
import { expect, it } from 'vitest';
import { getListWorkspacePages } from './listWorkspacePages';

it('makes every active and historical item reachable without mixing status headings', () => {
  const items = Array.from(
    { length: 19 },
    (_, id) => ({ id: String(id) }) as ListItem
  );
  const pages = getListWorkspacePages(
    items.slice(0, 6),
    items.slice(6, 13),
    items.slice(13)
  );
  expect(pages).toHaveLength(6);
  expect(
    pages.flatMap(page => [...page.active, ...page.completed, ...page.archived])
  ).toEqual(items);
  expect(
    pages.every(
      page =>
        page.active.length <= 5 &&
        page.completed.length <= 4 &&
        page.archived.length <= 4
    )
  ).toBe(true);
  expect(
    pages.every(
      page =>
        [page.active, page.completed, page.archived].filter(
          group => group.length
        ).length === 1
    )
  ).toBe(true);
});
