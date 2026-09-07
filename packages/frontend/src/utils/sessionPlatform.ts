import { isTauri, platformName } from './osUtils';

const NATIVE_SESSION_PLATFORMS = new Set([
  'macos',
  'windows',
  'linux',
  'android',
]);

export const usesNativeRefreshVault =
  isTauri && NATIVE_SESSION_PLATFORMS.has(platformName);

export const sessionPlatform = usesNativeRefreshVault
  ? (platformName as 'macos' | 'windows' | 'linux' | 'android')
  : 'web';
