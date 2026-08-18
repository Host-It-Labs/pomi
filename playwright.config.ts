import { defineConfig, devices } from '@playwright/test';
import {
  DEFAULT_PORTS,
  getBackendBaseUrl,
  getFrontendBaseUrl,
  parsePortNumber,
  readDevPorts,
} from './scripts/dev-ports.mjs';

const devPorts = readDevPorts();

if (!process.env.POMI_BACKEND_PORT) {
  process.env.POMI_BACKEND_PORT = String(
    parsePortNumber(devPorts.POMI_BACKEND_PORT, DEFAULT_PORTS.backend)
  );
}
if (!process.env.POMI_BACKEND_BASE_URL) {
  process.env.POMI_BACKEND_BASE_URL =
    devPorts.POMI_BACKEND_BASE_URL ||
    getBackendBaseUrl(Number(process.env.POMI_BACKEND_PORT));
}

const ciWorkers = Number(process.env.PLAYWRIGHT_CI_WORKERS || '10');
const ciFrontendBaseUrl = getFrontendBaseUrl(DEFAULT_PORTS.frontend);
const fullyParallel = process.env.PLAYWRIGHT_FULLY_PARALLEL !== '0';

const frontendBaseUrl = process.env.CI
  ? ciFrontendBaseUrl
  : process.env.POMI_FRONTEND_BASE_URL ||
    devPorts.POMI_FRONTEND_BASE_URL ||
    getFrontendBaseUrl(DEFAULT_PORTS.frontend);

export default defineConfig({
  testDir: './e2e',
  fullyParallel,
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: !!process.env.CI,
  retries: process.env.CI ? 0 : 1,
  workers: process.env.CI ? ciWorkers : undefined,
  timeout: process.env.CI ? 45000 : 30000,
  expect: {
    timeout: process.env.CI ? 10000 : 5000,
  },
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never' }],
        ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
      ]
    : 'html',
  use: {
    baseURL: frontendBaseUrl,
    actionTimeout: process.env.CI ? 35000 : 0,
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    // Use incognito context to ensure clean state for each test
    contextOptions: {
      ignoreHTTPSErrors: true,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? { channel: 'chrome' as const } : {}),
        // Each test gets a fresh browser context
        storageState: undefined,
      },
    },
  ],
  // webServer is only used in CI - locally you should have frontend running via `pnpm dev:frontend`
  ...(process.env.CI && {
    webServer: {
      command: `cd packages/frontend && POMI_FRONTEND_PORT=${DEFAULT_PORTS.frontend} POMI_FRONTEND_HMR_PORT=${DEFAULT_PORTS.frontendHmr} pnpm dev`,
      url: ciFrontendBaseUrl,
      reuseExistingServer: !!process.env.PLAYWRIGHT_REUSE_SERVER,
      timeout: 120000,
    },
  }),
});
