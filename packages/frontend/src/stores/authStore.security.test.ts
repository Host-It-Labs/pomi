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
      isRecoveringSession: false,
    });
  });

  afterEach(() => {
    useAuthStoreBase.getState().expireSession();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries temporary startup failures without asking for another login', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(sessionBody), { status: 200 })
      );
    vi.stubGlobal('fetch', request);
    await useAuthStoreBase.getState().initializeSession();
    expect(useAuthStoreBase.getState()).toMatchObject({
      isLoading: true,
      isRecoveringSession: true,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useAuthStoreBase.getState()).toMatchObject({
      isLoading: false,
      isAuthenticated: true,
      isRecoveringSession: false,
    });
  });

  it('keeps an active session during a temporary refresh failure and expires a rejected credential', async () => {
    vi.useFakeTimers();
    await useAuthStoreBase.getState().acceptSession(sessionBody);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
    );
    expect(await useAuthStoreBase.getState().refreshSession()).toBe(false);
    expect(useAuthStoreBase.getState()).toMatchObject({
      isAuthenticated: true,
      isRecoveringSession: true,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useAuthStoreBase.getState()).toMatchObject({
      isAuthenticated: false,
      isRecoveringSession: false,
    });
  });

  it('cancels scheduled recovery on explicit logout', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', request);
    await useAuthStoreBase.getState().initializeSession();
    await useAuthStoreBase.getState().signOut();
    const calls = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(request).toHaveBeenCalledTimes(calls);
    expect(useAuthStoreBase.getState().hasExplicitlySignedOut).toBe(true);
  });

  it('does not restore a session when an in-flight refresh finishes after logout', async () => {
    let resolveRefresh!: (response: Response) => void;
    const response = new Promise<Response>(resolve => {
      resolveRefresh = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response)
    );
    const refreshing = useAuthStoreBase.getState().refreshSession();
    const signingOut = useAuthStoreBase.getState().signOut();
    resolveRefresh(new Response(JSON.stringify(sessionBody), { status: 200 }));
    await Promise.all([refreshing, signingOut]);
    expect(useAuthStoreBase.getState()).toMatchObject({
      isAuthenticated: false,
      hasExplicitlySignedOut: true,
    });
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

  it('preserves a legacy token when migration is temporarily unavailable', async () => {
    localStorage.setItem(
      'pomi-auth-storage',
      JSON.stringify({ state: { token: 'legacy-token' } })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 }))
    );

    await useAuthStoreBase.getState().initializeSession();

    expect(localStorage.getItem('pomi-auth-storage')).toContain('legacy-token');
  });

  it('removes a legacy token after the migration endpoint rejects it', async () => {
    localStorage.setItem(
      'pomi-auth-storage',
      JSON.stringify({ state: { token: 'legacy-token' } })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 }))
    );

    await useAuthStoreBase.getState().initializeSession();

    expect(localStorage.getItem('pomi-auth-storage')).toBeNull();
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
