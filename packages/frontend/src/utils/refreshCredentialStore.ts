import { isDevAutoLoginEnabled } from '../config/environmentVariables';
import { usesNativeRefreshVault } from './sessionPlatform';

// Rebuilt development binaries have unstable Keychain identities. The disposable
// auto-login fixture needs only an in-memory session; production stays in Keychain.
const fixtureTokens = new Map<string, string>();
const usesFixtureMemory = import.meta.env.DEV && isDevAutoLoginEnabled;

const KEYRING_SERVICE = 'app.pomi.community.refresh-session';

const credentialAccount = (backendOrigin: string): string =>
  new URL(backendOrigin).origin;

export const readNativeRefreshToken = async (
  backendOrigin: string
): Promise<string | null> => {
  if (usesFixtureMemory)
    return fixtureTokens.get(credentialAccount(backendOrigin)) ?? null;
  if (!usesNativeRefreshVault) return null;
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
  if (!usesNativeRefreshVault || !refreshToken) return;
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
  const { deletePassword } = await import('tauri-plugin-keyring-api');
  await deletePassword(KEYRING_SERVICE, credentialAccount(backendOrigin));
};
