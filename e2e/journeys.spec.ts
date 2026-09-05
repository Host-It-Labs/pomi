import { expect, test } from './test';
import { getApiAuthContext, TestHelpers } from './helpers';
import {
  createIntention,
  createSession,
  createTask,
  deterministicUsername,
  E2E_PASSWORD,
  enableFeatures,
  expectTaskOrder,
  fetchIntentions,
  fetchPreferences,
  fetchTaskLogs,
  fetchTasks,
  fetchWatchStatus,
  fetchWorkTimerLogs,
  loginJourneyUser,
  openTasks,
  parseTimerSeconds,
  postWatchTimerAction,
  revertTaskLog,
  taskRow,
  timerDisplay,
  updatePreferences,
  updateTask,
  waitForPreferencesBootstrap,
  waitForTimerConnection,
} from './journey-helpers';

test.describe.configure({ timeout: 45_000 });

const tomorrow = () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

test('1. creates an account, reloads authenticated, logs out, and logs in again', async ({
  page,
}, testInfo) => {
  const username = deterministicUsername(testInfo, 'user');
  const helpers = new TestHelpers(page);
  await helpers.login(username, E2E_PASSWORD);
  await helpers.expandWindow();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#username')).toHaveCount(0);
  await helpers.openSettings();
  const logoutResponse = page.waitForResponse(
    response =>
      new URL(response.url()).pathname === '/sessions/current' &&
      response.request().method() === 'DELETE'
  );
  await page.getByRole('button', { name: 'Log Out' }).click();
  expect((await logoutResponse).ok()).toBeTruthy();
  await expect(page.locator('#username')).toBeVisible();

  await helpers.login(username, E2E_PASSWORD);
  await expect(page.locator('button[aria-label="Settings"]')).toBeVisible();
});

test('2. enables Intentions, selects a Parent and Sub-intention, then records a Timer', async ({
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  const suffix = deterministicUsername(testInfo, 'intentions');
  await enableFeatures(page, ['intentionExtension']);
  await updatePreferences(page, {
    autoStartBreak: false,
    timerExtension: false,
    advancedSkip: true,
    keyboardShortcuts: true,
    intentionSubIntentions: true,
    intentionRequireSelection: true,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
  await waitForPreferencesBootstrap(page);
  await waitForTimerConnection(page);
  const parentTitle = `${suffix} parent`;
  const childTitle = `${suffix} child`;
  await page.getByRole('button', { name: 'Edit intentions' }).click();
  await page
    .locator('button')
    .filter({ hasText: /^New(?: Intention)?$/ })
    .first()
    .click();
  const parentDialog = page.getByRole('dialog', { name: 'New Intention' });
  await parentDialog.locator('input[type="text"]').first().fill('🧭');
  await parentDialog.locator('input[type="text"]').nth(1).fill(parentTitle);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const editParent = page
    .getByRole('button', { name: `Edit ${parentTitle}`, exact: true })
    .first();
  await expect(parentDialog).not.toBeVisible();
  await expect(editParent).toBeVisible({ timeout: 10_000 });
  await editParent.click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Intention' });
  await editDialog.locator('summary[aria-label="Manage"]').click();
  await editDialog.getByRole('button', { name: 'Add Sub-intention' }).click();
  const childDialog = page.getByRole('dialog', { name: 'New Intention' });
  await childDialog.locator('input[type="text"]').first().fill('🗺️');
  await childDialog.locator('input[type="text"]').nth(1).fill(childTitle);
  await childDialog
    .getByRole('button', { name: 'Create', exact: true })
    .click();
  await expect(childDialog).not.toBeVisible({ timeout: 10_000 });
  const intentions = await fetchIntentions(page, 'work');
  const intentionRows = intentions.flatMap(intention => [
    intention,
    ...(Array.isArray(intention.children) ? intention.children : []),
    ...(Array.isArray(intention.subIntentions) ? intention.subIntentions : []),
  ]);
  const parent = intentionRows.find(
    intention => intention.title === parentTitle
  );
  const child = intentionRows.find(intention => intention.title === childTitle);
  expect(parent).toBeDefined();
  expect(child).toBeDefined();
  if (!parent || !child) {
    throw new Error('Created Parent/Sub-intention pair was not returned');
  }
  expect(child.parentIntentionId).toBe(parent.id);
  const display = timerDisplay(page);
  if (!(await display.isVisible().catch(() => false))) {
    const timerButton = page.getByRole('button', {
      name: 'Timer',
      exact: true,
    });
    if (await timerButton.isVisible().catch(() => false)) {
      await timerButton.click();
    } else {
      await page
        .getByRole('button', { name: 'Back to Timer', exact: true })
        .click();
    }
  }
  await expect(display).toBeVisible();

  await page.locator(`button[title*="${parentTitle}"]`).first().click();
  const subPicker = page.getByTestId('expanded-sub-intentions-picker');
  await expect(subPicker).toBeVisible();
  await subPicker.locator(`button[title*="${childTitle}"]`).click();
  await expect
    .poll(async () => {
      const timer = (await fetchWatchStatus(page)).timer;
      return {
        status: timer?.status,
        intentions: timer?.intentions?.map(
          (intention: { slug: string; subSlug?: string }) => [
            intention.slug,
            intention.subSlug,
          ]
        ),
      };
    })
    .toEqual({
      status: 'running',
      intentions: [[parent.slug, child.slug]],
    });

  await postWatchTimerAction(page, testInfo, 'skip', {
    actionIndex: 0,
    skipLogMode: 'elapsed',
  });

  await expect
    .poll(async () => (await fetchWatchStatus(page)).timer?.type)
    .toBe('break');

  await expect
    .poll(
      async () => {
        const logs = await fetchWorkTimerLogs(page);
        return logs.some(log =>
          (log.intentions ?? []).some(
            (intention: { slug: string; subIntention?: { slug: string } }) =>
              intention.slug === parent.slug &&
              intention.subIntention?.slug === child.slug
          )
        );
      },
      { timeout: 12_000 }
    )
    .toBe(true);
});

test('3. confirms primary Timer start, pause, add-five, undo, and reset actions', async ({
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  await updatePreferences(page, {
    undoAlerts: true,
    workTimerDuration: 600_000,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
  await waitForPreferencesBootstrap(page);
  await waitForTimerConnection(page);
  const display = timerDisplay(page);
  await display.click({ force: true });
  await expect
    .poll(async () => (await fetchWatchStatus(page)).timer?.status, {
      timeout: 15_000,
    })
    .toBe('running');
  await expect(page.getByRole('button', { name: 'Reset Timer' })).toBeVisible({
    timeout: 15_000,
  });

  const beforeAdd = parseTimerSeconds((await display.textContent()) ?? '0:00');
  await page.locator('button[aria-label^="Add 5 Minutes"]').first().click();
  await expect
    .poll(async () =>
      parseTimerSeconds((await display.textContent()) ?? '0:00')
    )
    .toBeGreaterThan(beforeAdd + 240);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(async () =>
      parseTimerSeconds((await display.textContent()) ?? '0:00')
    )
    .toBeLessThan(beforeAdd + 60);

  await display.click({ force: true });
  await expect
    .poll(async () => (await fetchWatchStatus(page)).timer?.status)
    .toBe('paused');
  await display.click({ force: true });
  await expect
    .poll(async () => (await fetchWatchStatus(page)).timer?.status)
    .toBe('running');
  await page.getByRole('button', { name: 'Reset Timer' }).click();
  await expect
    .poll(async () => {
      const timer = (await fetchWatchStatus(page)).timer;
      return {
        status: timer?.status,
        duration: timer?.duration,
        remainingNearDuration:
          typeof timer?.remainingTime === 'number' &&
          timer.remainingTime >= 595_000,
      };
    })
    .toEqual({
      status: 'running',
      duration: 600_000,
      remainingNearDuration: true,
    });
});

test('4. runs a Session through Long break and persists native Timer state across reload', async ({
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  await updatePreferences(page, {
    sessionsExtension: true,
    sessionHasLongBreak: true,
    sessionShowLongBreakButton: true,
    sessionLongBreakDuration: 60_000,
    sessionPomodorosCount: 3,
  });
  await expect
    .poll(async () => (await fetchPreferences(page)).sessionsExtension)
    .toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();

  await page.getByRole('button', { name: 'Start Long Break' }).click();
  await expect
    .poll(async () => (await fetchWatchStatus(page)).timer?.type)
    .toBe('longBreak');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
  const status = await fetchWatchStatus(page);
  expect(status.timer?.type).toBe('longBreak');
  expect((await fetchPreferences(page)).sessionsExtension).toBe(true);
});

test('5. enables Tasks, creates and edits through the shared editor, and reloads persisted data', async ({
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  await enableFeatures(page, ['tasksExtension']);
  await openTasks(page);
  const original = `${deterministicUsername(testInfo, 'task')} original`;
  const edited = `${deterministicUsername(testInfo, 'task')} edited`;

  await page.getByLabel('Create task').click();
  const createDialog = page.getByRole('dialog', { name: 'Add task' });
  await createDialog.getByLabel('Task title').fill(original);
  await createDialog.getByLabel('Task due date').fill(tomorrow());
  await createDialog
    .getByRole('button', { name: 'Create', exact: true })
    .click();
  await expect(taskRow(page, original)).toBeVisible();

  await taskRow(page, original)
    .getByRole('button', { name: `Edit ${original}` })
    .click();
  const editDialog = page.getByRole('dialog', { name: 'Edit task' });
  await editDialog.getByLabel('Task title').fill(edited);
  await editDialog.getByRole('button', { name: 'More options' }).click();
  await editDialog.getByLabel('Task priority').selectOption('high');
  await editDialog.getByRole('button', { name: 'Save' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
  await openTasks(page);
  await expect(taskRow(page, edited)).toBeVisible();
  await expect
    .poll(
      async () =>
        (await fetchTasks(page)).find(task => task.title === edited)?.priority
    )
    .toBe('high');
});

test('6. pins a linked Task, reconciles Timer Intentions, and confirms completion', async ({
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  await enableFeatures(page, ['intentionExtension', 'tasksExtension']);
  const prefix = deterministicUsername(testInfo, 'pin');
  const parent = await createIntention(page, {
    title: `${prefix} parent`,
    emoji: '🧭',
  });
  const child = await createIntention(page, {
    title: `${prefix} child`,
    emoji: '🗺️',
    parentIntentionId: parent.id,
  });
  const task = await createTask(page, {
    title: `${prefix} task`,
    intentionSlug: parent.slug,
    subIntentionSlug: child.slug,
    timerType: 'work',
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
  await openTasks(page);
  const row = taskRow(page, task.title);
  await row.getByRole('button', { name: `Pin ${task.title}` }).click();
  await expect
    .poll(async () => {
      const status = await fetchWatchStatus(page);
      return {
        intentions: status.timer?.intentions?.map(
          (intention: { slug: string; subSlug?: string }) => [
            intention.slug,
            intention.subSlug,
          ]
        ),
        focused: status.tasks
          ?.filter((item: { isFocused: boolean }) => item.isFocused)
          .map((item: { id: string }) => item.id),
      };
    })
    .toEqual({ intentions: [[parent.slug, child.slug]], focused: [task.id] });
  await row.getByRole('button', { name: `Complete ${task.title}` }).click();
  await expect
    .poll(async () =>
      (await fetchTasks(page)).some(item => item.id === task.id)
    )
    .toBe(false);
  await expect
    .poll(async () =>
      (await fetchTaskLogs(page)).some(
        event => event.taskId === task.id && event.eventType === 'completed'
      )
    )
    .toBe(true);
});

test('7. completes, undoes, and archives a recurring Task without violating its successor contract', async ({
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  await enableFeatures(page, ['tasksExtension']);
  const title = `${deterministicUsername(testInfo, 'recurring')} recurring`;
  const task = await createTask(page, {
    title,
    dueDate: tomorrow(),
    recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
    recurrenceAnchorMode: 'planned',
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
  await openTasks(page);
  const row = taskRow(page, title);
  const originalDueDate = task.dueDate as string;
  await row.getByRole('button', { name: `Complete ${title}` }).click();
  await expect
    .poll(async () =>
      (await fetchTaskLogs(page)).some(
        event => event.taskId === task.id && event.eventType === 'completed'
      )
    )
    .toBe(true);
  const completionEvent = (await fetchTaskLogs(page)).find(
    event => event.taskId === task.id && event.eventType === 'completed'
  )!;
  await revertTaskLog(page, completionEvent.id as string);
  await expect
    .poll(
      async () =>
        (await fetchTasks(page)).find(item => item.id === task.id)?.dueDate
    )
    .toBe(originalDueDate);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
  await openTasks(page);
  const restoredRow = taskRow(page, title);
  await restoredRow.getByRole('button', { name: `Complete ${title}` }).click();
  await expect
    .poll(async () => {
      const matches = (await fetchTasks(page)).filter(
        item => item.title === title
      );
      return {
        count: matches.length,
        active: matches[0]?.status === 'active',
        advanced:
          typeof matches[0]?.dueDate === 'string' &&
          matches[0].dueDate.localeCompare(originalDueDate) > 0,
      };
    })
    .toEqual({ count: 1, active: true, advanced: true });
  const successor = (await fetchTasks(page)).find(
    item => item.title === title
  )!;
  expect(successor.status).toBe('active');
  expect(successor.dueDate).not.toBe(originalDueDate);
  expect(successor.dueDate.localeCompare(originalDueDate)).toBeGreaterThan(0);
  await taskRow(page, title)
    .getByRole('button', { name: `Edit ${title}` })
    .click();
  await page
    .getByRole('dialog', { name: 'Edit task' })
    .getByRole('button', { name: `Archive ${title}` })
    .click();
  await page
    .getByRole('dialog', { name: 'Confirm task archive' })
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect
    .poll(async () =>
      (await fetchTaskLogs(page)).some(
        event => event.taskId === successor.id && event.eventType === 'archived'
      )
    )
    .toBe(true);
  await expect
    .poll(async () =>
      (await fetchTasks(page)).some(item => item.id === successor.id)
    )
    .toBe(false);
});

test('8. applies the saved Task sort preference across refresh', async ({
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  await enableFeatures(page, ['intentionExtension', 'tasksExtension']);
  await updatePreferences(page, { taskDefaultSortMode: 'created-asc' });
  const prefix = deterministicUsername(testInfo, 'order');
  const intention = await createIntention(page, {
    title: `${prefix} lane`,
    emoji: '↕️',
  });
  const first = `${prefix} first`;
  const second = `${prefix} second`;
  await createTask(page, {
    title: first,
    dueDate: null,
    intentionSlug: intention.slug,
  });
  await createTask(page, {
    title: second,
    dueDate: null,
    intentionSlug: intention.slug,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
  await openTasks(page);
  await page.getByTestId('task-intention-filter-trigger').click();
  await page
    .getByTestId(`task-intention-filter-work:${intention.slug}`)
    .click();
  const taskRows = page.locator('[data-testid="task-row"]');
  await expect(taskRows).toHaveCount(2, { timeout: 15_000 });
  await expectTaskOrder(page, [first, second]);
  await updatePreferences(page, { taskDefaultSortMode: 'created-desc' });
  const persistedOrder = [second, first];
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
  await openTasks(page);
  await page.getByTestId('task-intention-filter-trigger').click();
  await page
    .getByTestId(`task-intention-filter-work:${intention.slug}`)
    .click();
  await expectTaskOrder(page, persistedOrder);
});

test('9. reconciles Task updates across two clients while isolating another user', async ({
  browser,
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  await enableFeatures(page, ['tasksExtension']);
  const peerContext = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  const otherContext = await browser.newContext();
  const peerPage = await peerContext.newPage();
  const otherPage = await otherContext.newPage();
  try {
    await peerPage.goto('/');
    await new TestHelpers(peerPage).expandWindow();
    await waitForTimerConnection(peerPage);
    await openTasks(peerPage);

    await otherPage.goto('/');
    await createSession(
      otherPage,
      deterministicUsername(testInfo, 'isolated'),
      E2E_PASSWORD
    );
    await otherPage.reload({ waitUntil: 'domcontentloaded' });
    await waitForPreferencesBootstrap(otherPage);
    await updatePreferences(otherPage, { tasksExtension: true });
    await otherPage.reload({ waitUntil: 'domcontentloaded' });
    await new TestHelpers(otherPage).expandWindow();
    await openTasks(otherPage);

    const title = `${deterministicUsername(testInfo, 'sync')} shared`;
    await createTask(page, { title });
    await expect(taskRow(peerPage, title)).toBeVisible({ timeout: 10_000 });
    await expect(taskRow(otherPage, title)).toHaveCount(0);
  } finally {
    await peerContext.close();
    await otherContext.close();
  }
});

test('10. syncs settings across clients into affected Timer behavior', async ({
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  const peer = await page.context().newPage();
  try {
    await peer.goto('/');
    await new TestHelpers(peer).expandWindow();
    const helpers = new TestHelpers(page);
    await helpers.openSettings();
    await expect(page.locator('section[data-section="timer"]')).toBeVisible();
    const label = page.getByText('Focus length', { exact: true });
    const setting = label.locator('..');
    await setting.getByText('min', { exact: true }).click();
    const valueInput = setting.locator('input[type="text"]');
    await valueInput.fill('2');
    await valueInput.press('Enter');
    await expect
      .poll(async () => (await fetchPreferences(peer)).workTimerDuration)
      .toBe(120_000);

    await peer.reload({ waitUntil: 'domcontentloaded' });
    await new TestHelpers(peer).expandWindow();
    await waitForTimerConnection(peer);
    const display = timerDisplay(peer);
    await display.click();
    await expect
      .poll(async () => (await fetchWatchStatus(peer)).timer?.status, {
        timeout: 15_000,
      })
      .toBe('running');
    const reset = peer.getByRole('button', { name: 'Reset Timer' });
    await expect(reset).toBeVisible({ timeout: 15_000 });
    await reset.click({ force: true });
    await expect
      .poll(async () => {
        const timer = (await fetchWatchStatus(peer)).timer;
        const displayedSeconds = parseTimerSeconds(
          (await display.textContent()) ?? '0:00'
        );
        return {
          status: timer?.status,
          duration: timer?.duration,
          displayedNearDuration:
            displayedSeconds >= 115 && displayedSeconds <= 120,
        };
      })
      .toEqual({
        status: 'running',
        duration: 120_000,
        displayedNearDuration: true,
      });
  } finally {
    await peer.close();
  }
});

test('11. produces real Timer and Task activity for statistics and work-Timer logs', async ({
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  await enableFeatures(page, ['tasksExtension']);
  await updatePreferences(page, {
    workTimerDuration: 60_000,
    autoStartBreak: false,
    timerExtension: false,
    advancedSkip: true,
  });
  const task = await createTask(page, {
    title: `${deterministicUsername(testInfo, 'stats')} task`,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new TestHelpers(page).expandWindow();
  await waitForPreferencesBootstrap(page);
  await waitForTimerConnection(page);
  const display = timerDisplay(page);
  await display.click();
  await expect(page.getByRole('button', { name: 'Reset Timer' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip to Break' }).click();
  const advancedSkip = page.getByRole('dialog', { name: 'Advanced Skip' });
  await expect(advancedSkip).toBeVisible();
  await advancedSkip.getByRole('button').filter({ hasText: 'Elapsed' }).click();
  await expect
    .poll(async () => (await fetchWorkTimerLogs(page)).length, {
      timeout: 12_000,
    })
    .toBeGreaterThan(0);
  await openTasks(page);
  await taskRow(page, task.title)
    .getByRole('button', { name: `Complete ${task.title}` })
    .click();
  await expect
    .poll(async () =>
      (await fetchTasks(page)).some(item => item.id === task.id)
    )
    .toBe(false);
  await expect
    .poll(async () =>
      (await fetchTaskLogs(page)).some(
        event => event.taskId === task.id && event.eventType === 'completed'
      )
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Statistics', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Today', exact: true })
  ).toBeVisible();
  await page
    .getByTestId('statistics-controls')
    .getByRole('button', { name: 'Tasks' })
    .click();
  const todayTaskCount = page
    .getByTestId('task-statistics-panel')
    .getByText('Today', { exact: true })
    .locator('..')
    .locator('p')
    .nth(1);
  await expect(todayTaskCount).toHaveText('1');
  await page
    .getByTestId('statistics-controls')
    .getByRole('button', { name: 'Timers' })
    .click();
  await page
    .getByRole('button', { name: 'Work timer logs', exact: true })
    .click();
  await expect(page.getByTestId('work-timer-log-row').first()).toBeVisible();
});

test('12. preserves accepted-action FIFO through delayed indication, reconnect, and authoritative reconciliation', async ({
  page,
}, testInfo) => {
  await loginJourneyUser(page, testInfo);
  const helpers = new TestHelpers(page);
  await helpers.openSettings();
  await page.getByRole('button', { name: 'Open Debug Panel' }).click();
  await page
    .locator('button:has(h2:has-text("Network Lag Simulator"))')
    .click();
  await page.getByRole('button', { name: '2000ms', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Settings' }).click();
  await page.getByRole('button', { name: 'Back to Timer' }).click();

  const display = timerDisplay(page);
  await display.click();
  await page.locator('button[aria-label^="Add 5 Minutes"]').first().click();
  const indicator = page.getByTestId('user-action-indicator');
  await expect(indicator).toBeVisible({ timeout: 4_000 });
  await expect(indicator).toBeHidden({ timeout: 15_000 });
  await helpers.openSettings();
  await page.getByRole('button', { name: 'Open Debug Panel' }).click();
  await page
    .locator('button:has(h2:has-text("Network Lag Simulator"))')
    .click();
  await page.getByRole('button', { name: 'Off', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Settings' }).click();
  await page.getByRole('button', { name: 'Back to Timer' }).click();
  const statusBeforeReconnect = await fetchWatchStatus(page);
  const timerDurationBeforeReconnect = statusBeforeReconnect.timer?.duration;
  expect(timerDurationBeforeReconnect).toBe(30 * 60_000);

  const acceptedAction = page.waitForResponse(
    response =>
      new URL(response.url()).pathname === '/user-actions' &&
      response.request().method() === 'POST' &&
      response.status() === 202
  );
  await page.locator('button[aria-label^="Add 5 Minutes"]').first().click();
  await acceptedAction;
  await page.context().setOffline(true);
  await expect(page.getByTestId('connection-status-dismiss')).toBeVisible({
    timeout: 10_000,
  });
  await page.context().setOffline(false);
  await expect
    .poll(
      async () => {
        const status = await fetchWatchStatus(page);
        return {
          timerStatus: status.timer?.status,
          timerDuration: status.timer?.duration,
        };
      },
      { timeout: 15_000 }
    )
    .toEqual({
      timerStatus: 'running',
      timerDuration: timerDurationBeforeReconnect! + 5 * 60_000,
    });
  await expect(indicator).toBeHidden({ timeout: 15_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await helpers.expandWindow();
  await expect
    .poll(async () => {
      const status = await fetchWatchStatus(page);
      return {
        timerStatus: status.timer?.status,
        timerDuration: status.timer?.duration,
      };
    })
    .toEqual({
      timerStatus: 'running',
      timerDuration: timerDurationBeforeReconnect! + 5 * 60_000,
    });
});

test('13. exports and imports complete user data as an administrator', async ({
  page,
}, testInfo) => {
  const adminPattern = process.env.POMI_E2E_ADMIN_USERNAME_PATTERN;
  expect(
    adminPattern,
    'The E2E wrapper must provision isolated admins and set POMI_E2E_ADMIN_USERNAME_PATTERN'
  ).toBeTruthy();
  const adminUsername = adminPattern!
    .replaceAll('{repeatIndex}', String(testInfo.repeatEachIndex))
    .replaceAll('{parallelIndex}', String(testInfo.parallelIndex));
  const adminPassword = process.env.POMI_E2E_ADMIN_PASSWORD ?? E2E_PASSWORD;
  const helpers = new TestHelpers(page);
  await helpers.login(adminUsername, adminPassword);
  await helpers.expandWindow();
  const auth = await getApiAuthContext(page);
  expect(
    auth?.user?.isAdmin,
    'E2E admin fixture must be provisioned before Playwright'
  ).toBe(true);
  const title = `${deterministicUsername(testInfo, 'export')} task`;
  const task = await createTask(page, { title });

  await helpers.openSettings();
  await page.getByRole('button', { name: 'Open Debug Panel' }).click();
  await page.locator('button:has(h2:has-text("User Data"))').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export data' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const payload = Buffer.concat(chunks);
  expect(payload.length).toBeGreaterThan(0);

  await updateTask(page, task.id, { title: `${title} changed` });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: payload,
  });
  await expect
    .poll(async () =>
      (await fetchTasks(page)).some(candidate => candidate.title === title)
    )
    .toBe(true);
  await expect
    .poll(async () =>
      (await fetchTasks(page)).some(
        candidate => candidate.title === `${title} changed`
      )
    )
    .toBe(false);
});
