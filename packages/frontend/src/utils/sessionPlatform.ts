import { isDesktop, isTauri, platformName } from './osUtils';

const NATIVE_SESSION_PLATFORMS = new Set(['macos', 'windows', 'linux']);

export const usesNativeRefreshVault =
  isTauri && isDesktop && NATIVE_SESSION_PLATFORMS.has(platformName);

export const sessionPlatform = usesNativeRefreshVault
  ? (platformName as 'macos' | 'windows' | 'linux')
  : 'web';
