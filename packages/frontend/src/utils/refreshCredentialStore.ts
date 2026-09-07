import { isDevAutoLoginEnabled } from '../config/environmentVariables';
import { sessionPlatform, usesNativeRefreshVault } from './sessionPlatform';

// Rebuilt development binaries have unstable Keychain identities. The disposable
// auto-login fixture needs only an in-memory session; production stays in Keychain.
const fixtureTokens = new Map<string, string>();
const usesFixtureMemory =
  import.meta.env.DEV && isDevAutoLoginEnabled && sessionPlatform !== 'android';

const KEYRING_SERVICE = 'app.pomi.community.refresh-session';

const credentialAccount = (backendOrigin: string): string =>
  new URL(backendOrigin).origin;

export const readNativeRefreshToken = async (
  backendOrigin: string
): Promise<string | null> => {
  if (usesFixtureMemory)
    return fixtureTokens.get(credentialAccount(backendOrigin)) ?? null;
  if (!usesNativeRefreshVault) return null;
  if (sessionPlatform === 'android') {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string | null>('read_android_refresh_token', {
      account: credentialAccount(backendOrigin),
    });
  }
  const { getPassword } = await import('tauri-plugin-keyring-api');
  return getPassword(KEYRING_SERVICE, credentialAccount(backendOrigin));
};

export const writeNativeRefreshToken = async (
  backendOrigin: string,
  refreshToken: string | undefined
): Promise<void> => {
  if (usesFixtureMemory) {
    if (refreshToken)
      fixtureTokens.set(credentialAccount(backendOrigin), refreshToken);
    return;
  }
  if (!usesNativeRefreshVault) return;
  if (!refreshToken) throw new Error('Missing persistent refresh session');
  if (sessionPlatform === 'android') {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_android_refresh_token', {
      account: credentialAccount(backendOrigin),
      value: refreshToken,
    });
    return;
  }
  const { setPassword } = await import('tauri-plugin-keyring-api');
  await setPassword(
    KEYRING_SERVICE,
    credentialAccount(backendOrigin),
    refreshToken
  );
};

export const deleteNativeRefreshToken = async (
  backendOrigin: string
): Promise<void> => {
  if (usesFixtureMemory) {
    fixtureTokens.delete(credentialAccount(backendOrigin));
    return;
  }
  if (!usesNativeRefreshVault) return;
  if (sessionPlatform === 'android') {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('delete_android_refresh_token', {
      account: credentialAccount(backendOrigin),
    });
    return;
  }
  const { deletePassword } = await import('tauri-plugin-keyring-api');
  await deletePassword(KEYRING_SERVICE, credentialAccount(backendOrigin));
};
