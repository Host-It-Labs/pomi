import type { Locator, TestInfo } from '@playwright/test';
import { expect, type Page } from './test';
import { getApiAuthContext, TestHelpers } from './helpers';

declare global {
  interface Window {
    __POMI_TEST_CONTEXT_SLUG__?: string;
  }
}

export const E2E_PASSWORD = 'testpass1234';

export function deterministicUsername(testInfo: TestInfo, suffix: string) {
  const slug = testInfo.testId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  return `testuser_${slug}_${testInfo.repeatEachIndex}_${testInfo.parallelIndex}_r${testInfo.retry}_${suffix}`;
}

export async function loginJourneyUser(page: Page, testInfo: TestInfo) {
  const username = deterministicUsername(testInfo, 'user');
  await new TestHelpers(page).login(username, E2E_PASSWORD);
  await new TestHelpers(page).expandWindow();
  await waitForPreferencesBootstrap(page);
  await waitForTimerConnection(page);
  return username;
}

export async function waitForPreferencesBootstrap(page: Page) {
  const clientTimeZone = await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  await expect
    .poll(async () => (await fetchPreferences(page)).timeZone, {
      timeout: 15_000,
    })
    .toBe(clientTimeZone);
}

export async function waitForTimerConnection(page: Page) {
  await expect(timerDisplay(page).locator('../..')).not.toHaveClass(
    /opacity-50/,
    {
      timeout: 15_000,
    }
  );
}

async function apiContext(page: Page) {
  const context = await getApiAuthContext(page);
  expect(context).not.toBeNull();
  return context!;
}

export async function updatePreferences(
  page: Page,
  updates: Record<string, boolean | number>
) {
  const context = await apiContext(page);
  const response = await page.request.put(
    `${context.backendOrigin}/preferences`,
    {
      headers: {
        Authorization: `Bearer ${context.token}`,
        'Content-Type': 'application/json',
      },
      data: updates,
    }
  );
  expect(response.ok()).toBeTruthy();
  await expect
    .poll(
      async () => {
        const preferences = await fetchPreferences(page);
        return Object.fromEntries(
          Object.keys(updates).map(key => [key, preferences[key]])
        );
      },
      { timeout: 15_000 }
    )
    .toEqual(updates);
}

export async function fetchPreferences(page: Page) {
  const context = await apiContext(page);
  const response = await page.request.get(
    `${context.backendOrigin}/preferences`,
    {
      headers: { Authorization: `Bearer ${context.token}` },
    }
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Record<string, unknown>>;
}

export async function createIntention(
  page: Page,
  data: {
    title: string;
    emoji: string;
    type?: 'work' | 'break' | 'longBreak';
    parentIntentionId?: string;
  }
) {
  const context = await apiContext(page);
  const response = await page.request.post(
    `${context.backendOrigin}/intentions`,
    {
      headers: {
        Authorization: `Bearer ${context.token}`,
        'Content-Type': 'application/json',
      },
      data: { type: 'work', ...data },
    }
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{
    id: string;
    slug: string;
    title: string;
    emoji: string;
  }>;
}

export async function fetchIntentions(page: Page, type: string) {
  const context = await apiContext(page);
  const response = await page.request.get(
    `${context.backendOrigin}/intentions?type=${type}&includeSubIntentions=true`,
    { headers: { Authorization: `Bearer ${context.token}` } }
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Array<Record<string, any>>>;
}

export async function createTask(
  page: Page,
  data: {
    title: string;
    description?: string | null;
    dueDate?: string | null;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    intentionSlug?: string | null;
    subIntentionSlug?: string | null;
    timerType?: 'work' | 'break' | 'longBreak';
    recurrenceRule?: string | null;
    recurrenceAnchorMode?: 'planned' | 'completion';
  }
) {
  const context = await apiContext(page);
  const response = await page.request.post(`${context.backendOrigin}/tasks`, {
    headers: {
      Authorization: `Bearer ${context.token}`,
      'Content-Type': 'application/json',
    },
    data: { priority: 'normal', ...data },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Record<string, any>>;
}

export async function fetchTasks(page: Page) {
  const context = await apiContext(page);
  const response = await page.request.get(`${context.backendOrigin}/tasks`, {
    headers: { Authorization: `Bearer ${context.token}` },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Array<Record<string, any>>>;
}

export async function fetchTaskLogs(page: Page) {
  const context = await apiContext(page);
  const response = await page.request.get(
    `${context.backendOrigin}/tasks/logs?limit=20&offset=0`,
    { headers: { Authorization: `Bearer ${context.token}` } }
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Array<Record<string, any>>>;
}

export async function revertTaskLog(page: Page, eventId: string) {
  const context = await apiContext(page);
  const response = await page.request.post(
    `${context.backendOrigin}/tasks/logs/${eventId}/revert`,
    {
      headers: {
        Authorization: `Bearer ${context.token}`,
        'Content-Type': 'application/json',
      },
      data: {},
    }
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Record<string, any>>;
}

export async function updateTask(
  page: Page,
  taskId: string,
  updates: Record<string, unknown>
) {
  const context = await apiContext(page);
  const response = await page.request.patch(
    `${context.backendOrigin}/tasks/${taskId}`,
    {
      headers: {
        Authorization: `Bearer ${context.token}`,
        'Content-Type': 'application/json',
      },
      data: updates,
    }
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Record<string, any>>;
}

export async function fetchWatchStatus(page: Page) {
  const context = await apiContext(page);
  const response = await page.request.get(
    `${context.backendOrigin}/watch/status`,
    {
      headers: { Authorization: `Bearer ${context.token}` },
    }
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Record<string, any>>;
}

export async function postWatchTimerAction(
  page: Page,
  testInfo: TestInfo,
  action: 'startOrResume' | 'pause' | 'reset' | 'skip',
  options: {
    actionIndex: number;
    skipLogMode?: 'none' | 'elapsed' | 'full';
  }
) {
  const context = await apiContext(page);
  const actionId = `${deterministicUsername(testInfo, 'watch_action')}:${action}:${options.actionIndex}`;
  const operation = action === 'startOrResume' ? 'createOrResume' : action;
  const response = await page.request.post(
    `${context.backendOrigin}/user-actions`,
    {
      headers: {
        Authorization: `Bearer ${context.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        actionId,
        action: {
          kind: 'timer',
          operation,
          ...(options.skipLogMode
            ? { requestedLogMode: options.skipLogMode }
            : {}),
          ...(operation === 'createOrResume' ? { timerType: 'work' } : {}),
        },
      },
    }
  );
  expect(response.status()).toBe(202);
  const terminal = await page.request.get(
    `${context.backendOrigin}/user-actions/${actionId}?waitMs=30000`,
    { headers: { Authorization: `Bearer ${context.token}` } }
  );
  expect(terminal.ok()).toBeTruthy();
  const lifecycle = (await terminal.json()) as Record<string, any>;
  expect(lifecycle.status).toBe('succeeded');
  return lifecycle.result as Record<string, any>;
}

export async function fetchWorkTimerLogs(page: Page) {
  const context = await apiContext(page);
  const response = await page.request.get(
    `${context.backendOrigin}/work-timer-logs?limit=20&offset=0`,
    { headers: { Authorization: `Bearer ${context.token}` } }
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Array<Record<string, any>>>;
}

export async function createSession(
  page: Page,
  username: string,
  password: string
) {
  const context = await apiContext(page);
  const response = await page.request.post(
    `${context.backendOrigin}/sessions`,
    {
      data: { username, password },
    }
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Record<string, any>>;
}

export async function openTasks(page: Page) {
  const marker = page.getByTestId('task-search-field');
  if (await marker.isVisible().catch(() => false)) return;

  const button = page
    .getByRole('button', { name: 'Open Tasks view', exact: true })
    .or(page.getByRole('button', { name: 'Open Tasks', exact: true }))
    .or(page.getByRole('button', { name: 'Tasks', exact: true }))
    .first();
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
  await expect(marker).toBeVisible({ timeout: 10_000 });
}

export async function enableFeatures(
  page: Page,
  features: Array<'sessionsExtension' | 'intentionExtension' | 'tasksExtension'>
) {
  await updatePreferences(
    page,
    Object.fromEntries(features.map(feature => [feature, true]))
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
}

export function timerDisplay(page: Page) {
  return page.locator('h1', { hasText: /\d{1,2}:\d{2}/ }).first();
}

export function parseTimerSeconds(value: string) {
  const [minutes, seconds] = value.trim().split(':').map(Number);
  return minutes * 60 + seconds;
}

export function taskRow(page: Page, title: string) {
  return page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
}

export async function expectTaskOrder(page: Page, titles: string[]) {
  await expect
    .poll(() =>
      page
        .locator('[data-testid="task-row"]')
        .evaluateAll(rows =>
          rows.map(row => row.getAttribute('data-task-title'))
        )
    )
    .toEqual(titles);
}

export async function dragAfter(page: Page, handle: Locator, target: Locator) {
  const [handleBox, targetBox] = await Promise.all([
    handle.boundingBox(),
    target.boundingBox(),
  ]);
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const start = {
    x: handleBox!.x + handleBox!.width / 2,
    y: handleBox!.y + handleBox!.height / 2,
  };
  const finish = {
    x: targetBox!.x + 12,
    y: targetBox!.y + targetBox!.height - 2,
  };
  const taskList = page.getByTestId('task-list');
  const [draggedTaskId, targetTaskId] = await Promise.all([
    handle
      .locator('xpath=ancestor::*[@data-testid="task-row"]')
      .getAttribute('data-task-id'),
    target.getAttribute('data-task-id'),
  ]);
  expect(draggedTaskId).toBeTruthy();
  expect(targetTaskId).toBeTruthy();
  await handle.dispatchEvent('mousedown', {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
  });
  await expect(taskList).toHaveAttribute(
    'data-dragging-task-id',
    draggedTaskId!
  );
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      })
    );
  }, finish);
  await expect(taskList).toHaveAttribute('data-drop-target-id', targetTaskId!);
  await expect(taskList).toHaveAttribute('data-drop-placement', 'after');
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        button: 0,
        buttons: 0,
        clientX: x,
        clientY: y,
      })
    );
  }, finish);
}
