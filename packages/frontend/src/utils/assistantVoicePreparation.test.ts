import { describe, expect, it, vi } from 'vitest';
import { prepareAssistantVoiceWithRetry } from './assistantVoicePreparation';

describe('prepareAssistantVoiceWithRetry', () => {
  it('retries network loss and server failure with the same preparation body', async () => {
    const body = {
      preparationId: 'same-id',
      kind: 'audio' as const,
      audioBase64: 'audio',
      mimeType: 'audio/webm',
    };
    const prepare = vi
      .fn()
      .mockRejectedValueOnce(new Error('network lost'))
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({
        status: 202,
        body: { preparationId: 'same-id' },
      });
    const onRetry = vi.fn();
    const waitForRetry = vi.fn(async () => undefined);

    await expect(
      prepareAssistantVoiceWithRetry({
        body,
        prepare,
        isAuthenticated: () => true,
        onRetry,
        waitForRetry,
      })
    ).resolves.toMatchObject({ status: 202 });

    expect(prepare).toHaveBeenCalledTimes(3);
    expect(prepare.mock.calls.every(([value]) => value === body)).toBe(true);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenNthCalledWith(1, 500);
    expect(waitForRetry).toHaveBeenNthCalledWith(2, 1000);
  });

  it('stops retrying when authentication disappears', async () => {
    const error = new Error('offline');

    await expect(
      prepareAssistantVoiceWithRetry({
        body: { preparationId: 'same-id' },
        prepare: async () => Promise.reject(error),
        isAuthenticated: () => false,
        onRetry: vi.fn(),
        waitForRetry: vi.fn(async () => undefined),
      })
    ).rejects.toBe(error);
  });

  it('surfaces persistent server failure after a bounded retry budget', async () => {
    const prepare = vi.fn(async () => ({ status: 503 }));
    const waitForRetry = vi.fn(async () => undefined);

    await expect(
      prepareAssistantVoiceWithRetry({
        body: { preparationId: 'same-id' },
        prepare,
        isAuthenticated: () => true,
        onRetry: vi.fn(),
        waitForRetry,
      })
    ).rejects.toThrow('Assistant preparation failed (503)');

    expect(prepare).toHaveBeenCalledTimes(5);
    expect(waitForRetry).toHaveBeenCalledTimes(4);
  });
});
