import { platform } from '@tauri-apps/plugin-os';

// Check if we're running in Tauri context (not in browser for e2e tests)
export const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
declare global {
  interface Window {
    __POMI_TEST_PLATFORM__?: string;
  }
}

const testPlatform =
  typeof window !== 'undefined' ? window.__POMI_TEST_PLATFORM__ : undefined;
const requestedDevPlatform =
  typeof window !== 'undefined' &&
  (import.meta.env.DEV || import.meta.env.VITE_DEBUG_PANEL_ENABLED === 'true')
    ? new URLSearchParams(window.location.search).get('__pomi_platform')
    : undefined;
const devPlatform =
  requestedDevPlatform &&
  ['macos', 'windows', 'linux', 'android', 'ios', 'web'].includes(
    requestedDevPlatform
  )
    ? requestedDevPlatform
    : undefined;
const currentPlatform =
  testPlatform ?? devPlatform ?? (isTauri ? platform() : 'web');

export const platformName = currentPlatform;

export const isDesktop =
  currentPlatform === 'macos' ||
  currentPlatform === 'windows' ||
  currentPlatform === 'linux';
export const isMobile =
  currentPlatform === 'android' || currentPlatform === 'ios';
export const isAndroid = currentPlatform === 'android';
export const isIos = currentPlatform === 'ios';
export const isMac = currentPlatform === 'macos';
export const isWindows = currentPlatform === 'windows';
export const isLinux = currentPlatform === 'linux';

export const isDebugMobileSimulator =
  typeof window !== 'undefined' &&
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('__pomi_mobile_simulator') ===
    '1';
