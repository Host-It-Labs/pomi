import { afterEach, expect, it, vi } from 'vitest';
import { useAuthStoreBase } from '../stores/authStore';
import { apiClient } from './apiClient';

const requests = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@ts-rest/core', () => ({
  initClient: () => ({ tasks: { list: requests.list } }),
}));

afterEach(() => {
  useAuthStoreBase.getState().expireSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  requests.list.mockReset();
});

it('does not turn an expired access token into logout when refresh is temporarily offline', async () => {
  vi.useFakeTimers();
  useAuthStoreBase.setState({
    isAuthenticated: true,
    token: 'expired-access',
    hasExplicitlySignedOut: false,
  });
  requests.list.mockResolvedValue({ status: 401, body: {} });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
  );
  await expect(apiClient.tasks.list({ query: {} } as never)).rejects.toThrow(
    'Session refresh temporarily unavailable'
  );
  expect(useAuthStoreBase.getState()).toMatchObject({
    isAuthenticated: true,
    isRecoveringSession: true,
  });
});
