import { Page, expect } from '@playwright/test';

type SettingsFeatureName = 'Sessions' | 'Intentions' | 'Tasks';

export async function getApiAuthContext(page: Page) {
  const authContext = await page.evaluate(() => {
    const authData = localStorage.getItem('pomi-auth-storage');
    if (!authData) {
      return null;
    }

    let token: string | null = null;
    try {
      token = JSON.parse(authData)?.state?.token ?? null;
    } catch {
      return null;
    }

    if (!token) {
      return null;
    }

    return {
      token,
      storedBackend: localStorage.getItem('pomi-backend-url') ?? '',
      protocol: window.location.protocol,
    };
  });

  if (!authContext) {
    return null;
  }

  const sanitizedBackend = authContext.storedBackend
    .trim()
    .replace(/\/+$/g, '');
  const fallbackBackend =
    process.env.POMI_BACKEND_BASE_URL ||
    `http://localhost:${process.env.POMI_BACKEND_PORT || '3000'}`;
  const backendHost = sanitizedBackend || fallbackBackend;
  const protocol = authContext.protocol === 'https:' ? 'https://' : 'http://';
  const backendOrigin = /^https?:\/\//i.test(backendHost)
    ? backendHost
    : `${protocol}${backendHost}`;

  return {
    token: authContext.token,
    backendOrigin,
  };
}

export async function createIntentionViaApi(
  page: Page,
  title: string,
  emoji = '🎯',
  type: 'work' | 'break' | 'longBreak' = 'work',
  options?: { isHabit?: boolean }
) {
  const authContext = await getApiAuthContext(page);

  expect(authContext).not.toBeNull();

  const response = await page.request.post(
    `${authContext!.backendOrigin}/intentions`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authContext!.token}`,
      },
      data: {
        title,
        emoji,
        type,
        ...options,
      },
    }
  );

  if (!response.ok()) {
    throw new Error(
      `Failed to create intention ${title}: ${response.status()} ${await response.text()}`
    );
  }
  return response.json();
}

export async function createWorkIntentionViaApi(
  page: Page,
  title: string,
  emoji = '🎯'
) {
  await createIntentionViaApi(page, title, emoji, 'work');
}

export async function fetchIntentionsByTypeViaApi(
  page: Page,
  type: 'work' | 'break' | 'longBreak'
) {
  const authContext = await getApiAuthContext(page);
  expect(authContext).not.toBeNull();

  const response = await page.request.get(
    `${authContext!.backendOrigin}/intentions?type=${type}`,
    {
      headers: {
        Authorization: `Bearer ${authContext!.token}`,
      },
    }
  );

  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Array<{ title: string; slug: string }>;
}

export async function fetchTodayCountBySlugViaApi(
  page: Page,
  type: 'work' | 'break'
) {
  const authContext = await getApiAuthContext(page);
  expect(authContext).not.toBeNull();

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const url = new URL(
    `${authContext!.backendOrigin}/statistics/intentions/today`
  );
  url.searchParams.set('type', type);
  url.searchParams.set('start', String(start.getTime()));
  url.searchParams.set('end', String(end.getTime()));

  const response = await page.request.get(url.toString(), {
    headers: {
      Authorization: `Bearer ${authContext!.token}`,
    },
  });

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.bySlug as Record<string, number>;
}

export async function updatePreferencesViaApi(
  page: Page,
  updates: Record<string, boolean | number>
) {
  const authContext = await getApiAuthContext(page);
  expect(authContext).not.toBeNull();

  const response = await page.request.put(
    `${authContext!.backendOrigin}/preferences`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authContext!.token}`,
      },
      data: updates,
    }
  );

  if (!response.ok()) {
    throw new Error(
      `Failed to update preferences ${Object.keys(updates).join(', ')}: ${response.status()} ${await response.text()}`
    );
  }
}

export async function updatePreferenceViaApi(
  page: Page,
  preferenceKey: string,
  value: boolean | number
) {
  await updatePreferencesViaApi(page, { [preferenceKey]: value });
}

export class TestHelpers {
  constructor(public readonly page: Page) {}

  async login(username: string, password: string) {
    await this.page.goto('/');
    const usernameInput = this.page.locator('#username');
    const welcomeLoginButton = this.page.getByRole('button', {
      name: 'Log in',
      exact: true,
    });
    await expect(usernameInput.or(welcomeLoginButton)).toBeVisible({
      timeout: 10000,
    });
    if (await welcomeLoginButton.isVisible()) {
      await welcomeLoginButton.click();
    }
    await usernameInput.fill(username);
    await this.page.locator('#password').fill(password);
    const authResponsePromise = this.page
      .waitForResponse(
        response => {
          return (
            response.url().includes('/sessions') &&
            response.request().method() === 'POST'
          );
        },
        { timeout: 8000 }
      )
      .catch(() => null);
    const continueButton = this.page.getByRole('button', { name: 'Continue' });
    await expect(continueButton).toBeVisible({ timeout: 10000 });
    await continueButton.click();
    const authResponse = await authResponsePromise;

    if (authResponse && authResponse.status() !== 200) {
      throw new Error(
        `Authentication failed with status ${authResponse.status()}`
      );
    }

    const settingsButton = this.page.locator('button[aria-label="Settings"]');
    await expect(settingsButton).toBeVisible({ timeout: 10000 });
    await expect(settingsButton).toBeEnabled({ timeout: 10000 });
  }

  async navigateToTab(
    tab: 'timer' | 'statistics' | 'settings' | 'intentions' | 'debug'
  ) {
    const buttonMap = {
      timer: 'Timer',
      statistics: 'Statistics',
      settings: 'Settings',
      intentions: 'Intentions',
      debug: 'Debug',
    };

    await this.page.click(`button[aria-label="${buttonMap[tab]}"]`);
  }

  async openSettings() {
    await this.expandWindow();

    const backToTimerButton = this.page
      .locator('button:has-text("Back")')
      .first();
    const settingsTimerTab = this.page.locator(
      'nav button[data-section-key="timer"]'
    );
    const settingsMarker = backToTimerButton.or(settingsTimerTab);
    const isAlreadyInSettings = await settingsMarker
      .first()
      .isVisible()
      .catch(() => false);
    if (isAlreadyInSettings) {
      await expect(settingsMarker.first()).toBeVisible({ timeout: 10000 });
      return;
    }

    const settingsButton = this.page.locator('button[aria-label="Settings"]');
    await expect(settingsButton).toBeVisible({ timeout: 10000 });

    await expect(settingsButton).toBeEnabled({ timeout: 10000 });
    await settingsButton.click();
    await expect(settingsMarker.first()).toBeVisible({ timeout: 10000 });
  }

  async getSettingsFeatureCard(name: SettingsFeatureName) {
    return this.page
      .locator('section[data-section="features"] div.rounded-xl', {
        has: this.page.getByRole('heading', { name }),
      })
      .first();
  }

  private async returnToTimerIfVisible() {
    const backToTimerButton = this.page
      .locator('button:has-text("Back")')
      .first();
    if (await backToTimerButton.isVisible().catch(() => false)) {
      await backToTimerButton.click();
    }
  }

  private async getApiAuthContext() {
    return getApiAuthContext(this.page);
  }

  private async setPreferenceViaApi(
    preferenceKey:
      | 'sessionsExtension'
      | 'intentionExtension'
      | 'tasksExtension',
    value: boolean
  ) {
    try {
      await updatePreferenceViaApi(this.page, preferenceKey, value);
      return true;
    } catch {
      return false;
    }
  }

  async ensureSettingsFeatureEnabled(name: SettingsFeatureName) {
    const preferenceKey =
      name === 'Sessions'
        ? 'sessionsExtension'
        : name === 'Intentions'
          ? 'intentionExtension'
          : 'tasksExtension';
    const sectionKey =
      name === 'Sessions'
        ? 'sessions'
        : name === 'Intentions'
          ? 'intentions'
          : 'tasks';
    const activeSection = this.page.locator(
      `section[data-section="${sectionKey}"]`
    );

    const fastPathEnabled = await this.setPreferenceViaApi(preferenceKey, true);
    if (fastPathEnabled) {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.expandWindow();
      return;
    }

    await this.openSettings();
    if (await activeSection.count()) {
      await this.returnToTimerIfVisible();
      return;
    }

    const featuresTab = this.page.locator(
      'nav button[data-section-key="features"]'
    );
    await expect(featuresTab).toBeVisible({ timeout: 10000 });
    await featuresTab.click();
    await expect(
      this.page.locator('section[data-section="features"]')
    ).toBeVisible({ timeout: 10000 });

    const card = await this.getSettingsFeatureCard(name);
    await expect(card).toBeVisible({ timeout: 10000 });

    const activateButton = card
      .getByRole('button', { name: /^(?:Activate|Enable)(?:\s+.+)?$/ })
      .first();
    if (
      (await activateButton.count()) > 0 &&
      (await activateButton.isVisible())
    ) {
      await activateButton.click();

      if (name === 'Sessions') {
        const configureSessionsHeading = this.page.locator(
          'h2:has-text("Configure Sessions")'
        );
        if (await configureSessionsHeading.isVisible().catch(() => false)) {
          const saveButton = this.page
            .getByRole('button', { name: 'Save' })
            .last();
          await expect(saveButton).toBeVisible({ timeout: 10000 });
          await saveButton.click();
          await expect(configureSessionsHeading).not.toBeVisible({
            timeout: 10000,
          });
        }
      }
    }

    await this.openSettings();
    await expect(activeSection.first()).toBeVisible({ timeout: 10000 });
    await this.returnToTimerIfVisible();
  }

  async disableSettingsFeature(name: SettingsFeatureName) {
    const preferenceKey =
      name === 'Sessions'
        ? 'sessionsExtension'
        : name === 'Intentions'
          ? 'intentionExtension'
          : 'tasksExtension';

    const fastPathDisabled = await this.setPreferenceViaApi(
      preferenceKey,
      false
    );
    if (fastPathDisabled) {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.expandWindow();
      return;
    }

    await this.openSettings();

    const sectionKey =
      name === 'Sessions'
        ? 'sessions'
        : name === 'Intentions'
          ? 'intentions'
          : 'tasks';
    const section = this.page
      .locator(`section[data-section="${sectionKey}"]`)
      .first();
    if (await section.count()) {
      const toggleInput = section.locator(`#${preferenceKey}`).first();
      if (await toggleInput.isChecked().catch(() => false)) {
        const toggleLabel = section
          .locator(`label[for="${preferenceKey}"]`)
          .first();
        await expect(toggleLabel).toBeVisible({ timeout: 10000 });
        await toggleLabel.click();
        await expect(toggleInput).not.toBeChecked({ timeout: 10000 });
      }
    }

    await this.returnToTimerIfVisible();
  }

  async waitForTimerState(state: 'running' | 'paused' | 'completed') {
    await this.page.waitForSelector(`[data-timer-status="${state}"]`, {
      timeout: 20000,
    });
  }

  async expandWindow() {
    const expandButton = this.page.locator(
      'button[aria-label="Expand Application"]'
    );
    const canExpand = await expandButton.isVisible().catch(() => false);
    if (canExpand) {
      await expandButton.click();
    }
  }

  async takeScreenshot(name: string) {
    await this.page.screenshot({
      path: `e2e/screenshots/${name}.png`,
      fullPage: true,
    });
  }

  async waitForToast(message: string, _type: 'success' | 'error' = 'success') {
    await expect(
      this.page.locator(`[role="alert"]:has-text("${message}")`)
    ).toBeVisible();
  }

  async dismissToast() {
    const closeButton = this.page.locator('[role="alert"] button');
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }
  }

  async waitForConnectionStatus(connected: boolean = true) {
    if (connected) {
      await expect(this.page.locator('text=Disconnected')).not.toBeVisible();
    } else {
      await expect(this.page.locator('text=Disconnected')).toBeVisible();
    }
  }
}

export const mockUser = {
  username: 'testuser',
  password: 'testpass123',
  email: 'test@example.com',
};

export const testTimeouts = {
  short: 5000,
  medium: 10000,
  long: 10000,
};
