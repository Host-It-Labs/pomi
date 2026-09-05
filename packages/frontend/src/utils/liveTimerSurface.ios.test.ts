import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStoreBase } from '../stores/authStore';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  updatePushToken: vi.fn(),
}));

vi.mock('./osUtils', () => ({
  isAndroid: false,
  isDesktop: false,
  isIos: true,
  isMobile: true,
  isTauri: true,
  platformName: 'ios',
}));
vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: vi.fn(),
  invoke: mocks.invoke,
}));
vi.mock('./apiClient', () => ({
  apiClient: {
    users: { updatePushToken: mocks.updatePushToken },
  },
}));
vi.mock('./userActionQueue', () => ({ submitUserMutation: vi.fn() }));
vi.mock('./socketManager', () => ({ waitForAuthoritativeTimer: vi.fn() }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: vi.fn(async () => null),
  onOpenUrl: vi.fn(async () => () => undefined),
}));

import { clearLiveTimerProjection } from './liveTimerSurface';

describe('iOS Live Activity cleanup', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.updatePushToken.mockReset();
    mocks.updatePushToken.mockResolvedValue({ status: 200 });
    useAuthStoreBase.setState({ user: { id: 'user-1' } as never });
  });

  it('retains the authenticated user across the awaited native clear', async () => {
    const authenticatedUserId = useAuthStoreBase.getState().user?.id;
    useAuthStoreBase.setState({ user: null, token: null });
    mocks.invoke.mockImplementation(async () => {
      await Promise.resolve();
    });

    await clearLiveTimerProjection(authenticatedUserId);

    expect(mocks.updatePushToken).toHaveBeenCalledWith({
      params: { userId: 'user-1' },
      body: { token: null, platform: 'ios-live-activity' },
    });
  });
});
