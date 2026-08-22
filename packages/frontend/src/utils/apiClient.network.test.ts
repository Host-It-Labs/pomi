import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBrowserNetworkError, retryReadOnce } from './apiClient';

const mocks = vi.hoisted(() => ({ forceReconnect: vi.fn() }));

vi.mock('./backendConnectionRecovery', () => ({
  requestBackendConnectionRecovery: () => mocks.forceReconnect(false),
}));

describe('API read recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    mocks.forceReconnect.mockReset();
  });

  it.each(['Failed to fetch', 'Load failed', 'Network request failed'])(
    'retries the browser network failure %s once',
    async message => {
      vi.useFakeTimers();
      const call = vi
        .fn()
        .mockRejectedValueOnce(new TypeError(message))
        .mockResolvedValueOnce({ status: 200, body: [] });

      const result = retryReadOnce(call, { query: {} });
      await vi.advanceTimersByTimeAsync(250);

      await expect(result).resolves.toEqual({ status: 200, body: [] });
      expect(call).toHaveBeenCalledTimes(2);
      expect(mocks.forceReconnect).toHaveBeenCalledWith(false);
      expect(call.mock.calls[0][0].overrideClientOptions.baseUrl).toBe(
        call.mock.calls[1][0].overrideClientOptions.baseUrl
      );
    }
  );

  it('does not retry application failures', async () => {
    const error = new Error('response validation failed');
    const call = vi.fn().mockRejectedValue(error);

    await expect(retryReadOnce(call, undefined)).rejects.toBe(error);
    expect(call).toHaveBeenCalledOnce();
    expect(mocks.forceReconnect).not.toHaveBeenCalled();
  });

  it('recognizes browser-native NetworkError failures', () => {
    expect(
      isBrowserNetworkError(new DOMException('offline', 'NetworkError'))
    ).toBe(true);
  });
});
