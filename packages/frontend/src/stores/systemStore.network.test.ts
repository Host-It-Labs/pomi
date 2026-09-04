import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { apiClient } from '../utils/apiClient';
import { createSystemStore } from './systemStore';

const server = setupServer(
  http.get('http://localhost:3000/system', () =>
    HttpResponse.json({
      hostingMode: 'self-hosted',
      selfHosted: true,
      requiresAdminBootstrapToken: false,
    })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('system store network boundary', () => {
  it('loads validated server state through the real ts-rest client', async () => {
    const store = createSystemStore(apiClient);

    await store.getState().loadSystemInfo();

    expect(store.getState().systemInfo).toEqual({
      hostingMode: 'self-hosted',
      selfHosted: true,
      requiresAdminBootstrapToken: false,
    });
  });

  it('does not replace confirmed state after an HTTP failure', async () => {
    const store = createSystemStore(apiClient);
    await store.getState().loadSystemInfo();
    server.use(
      http.get('http://localhost:3000/system', () =>
        HttpResponse.json({ message: 'unavailable' }, { status: 503 })
      )
    );

    await store.getState().loadSystemInfo();

    expect(store.getState().systemInfo?.selfHosted).toBe(true);
  });
});
