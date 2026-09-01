import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStoreBase } from './authStore';

const sessionBody = {
  user: {
    id: 'user-1',
    username: 'person',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  token: 'access-token',
  isNewUser: false,
  language: 'en',
};

describe('client session storage', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStoreBase.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,
      hasExplicitlySignedOut: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps access tokens and user state out of localStorage', () => {
    useAuthStoreBase.getState().setToken('memory-only-token');
    useAuthStoreBase.getState().setUser(sessionBody.user);

    expect(useAuthStoreBase.getState().token).toBe('memory-only-token');
    expect(localStorage.getItem('pomi-auth-storage')).toBeNull();
  });

  it('removes a legacy persisted token while migrating it to a server session', async () => {
    localStorage.setItem(
      'pomi-auth-storage',
      JSON.stringify({ state: { token: 'legacy-token' } })
    );
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify(sessionBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', request);

    await useAuthStoreBase.getState().initializeSession();

    expect(localStorage.getItem('pomi-auth-storage')).toBeNull();
    expect(request).toHaveBeenCalledWith(
      'http://localhost:3000/sessions/migrate',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer legacy-token',
        }),
      })
    );
    expect(useAuthStoreBase.getState()).toMatchObject({
      token: 'access-token',
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it('coalesces concurrent refreshes into one rotating request', async () => {
    let resolveRequest!: (response: Response) => void;
    const request = vi.fn(
      () => new Promise<Response>(resolve => (resolveRequest = resolve))
    );
    vi.stubGlobal('fetch', request);

    const first = useAuthStoreBase.getState().refreshSession();
    const second = useAuthStoreBase.getState().refreshSession();
    resolveRequest(
      new Response(JSON.stringify(sessionBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(request).toHaveBeenCalledOnce();
  });

  it('keeps an offline explicit sign-out sticky without persisting auth data', async () => {
    useAuthStoreBase.setState({
      user: sessionBody.user,
      token: 'access-token',
      isAuthenticated: true,
    });
    const request = vi.fn(async () => {
      throw new TypeError('offline');
    });
    vi.stubGlobal('fetch', request);

    await useAuthStoreBase.getState().signOut();
    expect(localStorage.getItem('pomi-session-explicitly-signed-out')).toBe(
      'true'
    );
    expect(localStorage.getItem('pomi-auth-storage')).toBeNull();

    request.mockClear();
    await useAuthStoreBase.getState().initializeSession();
    expect(request).not.toHaveBeenCalled();
  });
});
