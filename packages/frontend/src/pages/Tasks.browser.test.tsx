import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../App.css';
import { PageContainer } from '../components/ui/PageContainer';
import {
  TASKS_PAGE_BOTTOM_CLEARANCE_REM,
  TASKS_PAGE_CONTAINER_CLASS,
} from '../constants/taskLayout';

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
  await page.viewport(1280, 720);
});

describe('Tasks page bottom clearance', () => {
  it('clears the action queue indicator at compact and desktop widths', async () => {
    for (const width of [440, 800]) {
      await page.viewport(width, 700);
      root?.unmount();
      host?.remove();
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
      root.render(
        <PageContainer className={TASKS_PAGE_CONTAINER_CLASS}>
          <div data-testid="tasks-page-content" />
        </PageContainer>
      );

      await vi.waitFor(() =>
        expect(
          host?.querySelector('[data-testid="tasks-page-content"]')
        ).toBeTruthy()
      );
      const container = host!.firstElementChild as HTMLElement;
      const rootFontSize = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize
      );
      const safeAreaBottom = readSafeAreaBottom();

      expect(Number.parseFloat(getComputedStyle(container).paddingBottom)).toBe(
        TASKS_PAGE_BOTTOM_CLEARANCE_REM * rootFontSize + safeAreaBottom
      );
    }
  });
});

function readSafeAreaBottom() {
  const probe = document.createElement('div');
  probe.style.paddingBottom = 'env(safe-area-inset-bottom)';
  document.body.append(probe);
  const value = Number.parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return value;
}
