import { describe, expect, it, vi } from 'vitest';
import { createInAppNotificationStore } from './inAppNotificationStore';
import { createSystemStore } from './systemStore';

describe('isolated store factories', () => {
  it('loads system state without mutating the production singleton', async () => {
    const systemInfo = { version: 'test' };
    const get = vi.fn().mockResolvedValue({ status: 200, body: systemInfo });
    const store = createSystemStore({ system: { get } } as never);

    await store.getState().loadSystemInfo();

    expect(get).toHaveBeenCalledOnce();
    expect(store.getState().systemInfo).toEqual(systemInfo);
  });

  it('shares concurrent system bootstrap requests', async () => {
    let resolveRequest!: (value: {
      status: number;
      body: {
        hostingMode: 'self-hosted';
        selfHosted: true;
        paymentsRequired: false;
        authProviders: { google: false; apple: false };
      };
    }) => void;
    const response = new Promise<{
      status: number;
      body: {
        hostingMode: 'self-hosted';
        selfHosted: true;
        paymentsRequired: false;
        authProviders: { google: false; apple: false };
      };
    }>(resolve => {
      resolveRequest = resolve;
    });
    const get = vi.fn(() => response);
    const store = createSystemStore({ system: { get } } as never);

    const first = store.getState().loadSystemInfo();
    const second = store.getState().loadSystemInfo();
    expect(get).toHaveBeenCalledOnce();

    resolveRequest({
      status: 200,
      body: {
        hostingMode: 'self-hosted',
        selfHosted: true,
        paymentsRequired: false,
        authProviders: { google: false, apple: false },
      },
    });
    await Promise.all([first, second]);
    expect(store.getState().systemInfo?.selfHosted).toBe(true);
  });

  it('injects stable notification IDs and resets independently', () => {
    const store = createInAppNotificationStore(() => 'notification-id');

    store.getState().showNotification({
      title: 'Saved',
      body: 'The change is durable.',
      type: 'work',
    });
    expect(store.getState().notification).toMatchObject({
      id: 'notification-id',
      title: 'Saved',
      body: 'The change is durable.',
      type: 'work',
    });

    store.getState().dismissNotification();
    expect(store.getState().notification).toBeNull();
  });
});
