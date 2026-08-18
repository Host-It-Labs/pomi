import { expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

function slugifyTestTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
}

const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const slug = slugifyTestTitle(testInfo.title);

    await page.addInitScript(testSlug => {
      window.__POMI_TEST_CONTEXT_SLUG__ = testSlug;
    }, slug);

    await use(page);
  },
});

export { expect, test };
export type { Page };
