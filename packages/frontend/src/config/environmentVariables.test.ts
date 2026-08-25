import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('development backend URL resolution', () => {
  it('ignores a stored self-hosted URL when dev auto-login is enabled', async () => {
    localStorage.setItem('pomi-backend-url', 'https://stale.example');
    vi.stubEnv('VITE_BACKEND_URL', 'localhost:3000');
    vi.stubEnv('VITE_DEV_AUTO_LOGIN_USERNAME', 'copyme');
    vi.stubEnv('VITE_DEV_AUTO_LOGIN_PASSWORD', 'copyme');

    const { getBackendUrl, isDevAutoLoginEnabled } =
      await import('./environmentVariables');

    expect(isDevAutoLoginEnabled).toBe(true);
    expect(getBackendUrl()).toBe('localhost:3000');
  });

  it('keeps the stored self-hosted URL when dev auto-login is disabled', async () => {
    localStorage.setItem('pomi-backend-url', 'https://self-hosted.example');
    vi.stubEnv('VITE_BACKEND_URL', 'localhost:3000');
    vi.stubEnv('VITE_DEV_AUTO_LOGIN_USERNAME', '');
    vi.stubEnv('VITE_DEV_AUTO_LOGIN_PASSWORD', '');

    const { getBackendUrl, isDevAutoLoginEnabled } =
      await import('./environmentVariables');

    expect(isDevAutoLoginEnabled).toBe(false);
    expect(getBackendUrl()).toBe('https://self-hosted.example');
  });
});
