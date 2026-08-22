import { invoke } from '@tauri-apps/api/core';
import type { User } from '@pomi/shared';
import { getBackendOrigin } from './backendUrl';
import { isIos, isTauri } from './osUtils';

export async function syncAppleWatchSession(user: User, token: string) {
  if (!isTauri || !isIos) return;
  await invoke('plugin:watch-sync|update_session', {
    payload: {
      backendUrl: getBackendOrigin(),
      token,
      userId: user.id,
      username: user.username,
    },
  });
}

export async function clearAppleWatchSession() {
  if (!isTauri || !isIos) return;
  await invoke('plugin:watch-sync|clear_session');
}
