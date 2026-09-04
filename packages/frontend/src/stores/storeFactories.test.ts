import { describe, expect, it, vi } from 'vitest';
import { createInAppNotificationStore } from './inAppNotificationStore';
import { createSystemStore } from './systemStore';

describe('isolated store factories', () => {
  it('loads system state without mutating the production singleton', async () => {
    const systemInfo = { version: 'test' };
    const get = vi.fn().mockResolvedValue({ status: 200, body: systemInfo });
    const store = createSystemStore(
      { system: { get } } as never,
      () => 'https://backend.example'
    );

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
        requiresAdminBootstrapToken: false;
      };
    }) => void;
    const response = new Promise<{
      status: number;
      body: {
        hostingMode: 'self-hosted';
        selfHosted: true;
        requiresAdminBootstrapToken: false;
      };
    }>(resolve => {
      resolveRequest = resolve;
    });
    const get = vi.fn(() => response);
    const store = createSystemStore(
      { system: { get } } as never,
      () => 'https://backend.example'
    );

    const first = store.getState().loadSystemInfo();
    const second = store.getState().loadSystemInfo();
    expect(get).toHaveBeenCalledOnce();

    resolveRequest({
      status: 200,
      body: {
        hostingMode: 'self-hosted',
        selfHosted: true,
        requiresAdminBootstrapToken: false,
      },
    });
    await Promise.all([first, second]);
    expect(store.getState().systemInfo?.selfHosted).toBe(true);
  });

  it('starts a new load and ignores stale results after the backend changes', async () => {
    const resolvers: Array<(value: any) => void> = [];
    const get = vi.fn(() => new Promise(resolve => resolvers.push(resolve)));
    let backendOrigin = 'https://old.example';
    const store = createSystemStore(
      { system: { get } } as never,
      () => backendOrigin
    );

    const oldLoad = store.getState().loadSystemInfo();
    backendOrigin = 'https://new.example';
    const newLoad = store.getState().loadSystemInfo();
    expect(get).toHaveBeenCalledTimes(2);

    resolvers[0]({
      status: 200,
      body: {
        hostingMode: 'hosted',
        selfHosted: false,
        requiresAdminBootstrapToken: false,
      },
    });
    await oldLoad;
    expect(store.getState().systemInfo).toBeNull();

    resolvers[1]({
      status: 200,
      body: {
        hostingMode: 'self-hosted',
        selfHosted: true,
        requiresAdminBootstrapToken: true,
      },
    });
    await newLoad;
    expect(store.getState().systemInfo).toMatchObject({
      selfHosted: true,
      requiresAdminBootstrapToken: true,
    });
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
