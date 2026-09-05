import { usesNativeRefreshVault } from './sessionPlatform';

const KEYRING_SERVICE = 'app.pomi.community.refresh-session';

const credentialAccount = (backendOrigin: string): string =>
  new URL(backendOrigin).origin;

export const readNativeRefreshToken = async (
  backendOrigin: string
): Promise<string | null> => {
  if (!usesNativeRefreshVault) return null;
  const { getPassword } = await import('tauri-plugin-keyring-api');
  return getPassword(KEYRING_SERVICE, credentialAccount(backendOrigin));
};

export const writeNativeRefreshToken = async (
  backendOrigin: string,
  refreshToken: string | undefined
): Promise<void> => {
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
  if (!usesNativeRefreshVault) return;
  const { deletePassword } = await import('tauri-plugin-keyring-api');
  await deletePassword(KEYRING_SERVICE, credentialAccount(backendOrigin));
};
