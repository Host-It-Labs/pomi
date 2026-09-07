import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./osUtils', () => ({ isTauri: true, platformName: 'android' }));
vi.mock('../config/environmentVariables', () => ({
  isDevAutoLoginEnabled: false,
}));
vi.mock('./backendUrl', () => ({
  getBackendOrigin: () => 'https://pomi.example',
}));

import { useAuthStoreBase } from '../stores/authStore';
import { sessionPlatform, usesNativeRefreshVault } from './sessionPlatform';
import {
  deleteNativeRefreshToken,
  readNativeRefreshToken,
  writeNativeRefreshToken,
} from './refreshCredentialStore';

describe('Android persistent refresh credentials', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  afterEach(() => {
    useAuthStoreBase.getState().expireSession();
    vi.unstubAllGlobals();
  });

  it('restores a cold session from the vault and persists the rotated token', async () => {
    useAuthStoreBase.setState({ hasExplicitlySignedOut: false });
    const session = {
      user: {
        id: 'android-user',
        username: 'android-user',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      token: 'access-token',
      refreshToken: 'rotated-refresh',
      isNewUser: false,
    };
    mocks.invoke.mockResolvedValueOnce('saved-refresh');
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(session), { status: 200 })
      );
    vi.stubGlobal('fetch', request);
    await useAuthStoreBase.getState().initializeSession();
    expect(request).toHaveBeenCalledWith(
      'https://pomi.example/sessions/refresh',
      expect.objectContaining({
        body: JSON.stringify({
          platform: 'android',
          refreshToken: 'saved-refresh',
        }),
      })
    );
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      'write_android_refresh_token',
      { account: 'https://pomi.example', value: 'rotated-refresh' }
    );
    expect(useAuthStoreBase.getState().isAuthenticated).toBe(true);
  });

  it('uses the Android token contract instead of web cookies', () => {
    expect(sessionPlatform).toBe('android');
    expect(usesNativeRefreshVault).toBe(true);
  });

  it('stores, restores and deletes the credential for the backend origin', async () => {
    await writeNativeRefreshToken('https://pomi.example/api', 'refresh-1');
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      'write_android_refresh_token',
      {
        account: 'https://pomi.example',
        value: 'refresh-1',
      }
    );
    mocks.invoke.mockResolvedValueOnce('refresh-1');
    expect(await readNativeRefreshToken('https://pomi.example')).toBe(
      'refresh-1'
    );
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      'read_android_refresh_token',
      { account: 'https://pomi.example' }
    );
    await deleteNativeRefreshToken('https://pomi.example');
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      'delete_android_refresh_token',
      { account: 'https://pomi.example' }
    );
  });

  it('rejects login without a durable refresh credential', async () => {
    await expect(
      writeNativeRefreshToken('https://pomi.example', undefined)
    ).rejects.toThrow('Missing persistent refresh session');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('propagates storage failures so restoration can retry instead of logging out', async () => {
    mocks.invoke.mockRejectedValue(new Error('Keystore unavailable'));
    await expect(
      readNativeRefreshToken('https://pomi.example')
    ).rejects.toThrow('Keystore unavailable');
    await expect(
      writeNativeRefreshToken('https://pomi.example', 'refresh')
    ).rejects.toThrow('Keystore unavailable');
  });
});
