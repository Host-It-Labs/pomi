import {
  backendUrlHasProtocol,
  getStoredBackendUrl,
} from '../utils/backendUrlStorage';
import { isAndroid, isTauri } from '../utils/osUtils';

const ANDROID_EMULATOR_HOST = '10.0.2.2';
const LOCAL_BACKEND_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const getAndroidReachableBackendUrl = (backendUrl: string): string => {
  const trimmedUrl = backendUrl.trim();
  const hasProtocol = backendUrlHasProtocol(trimmedUrl);

  try {
    const parsedUrl = new URL(
      hasProtocol ? trimmedUrl : `http://${trimmedUrl}`
    );
    if (!LOCAL_BACKEND_HOSTS.has(parsedUrl.hostname)) {
      return trimmedUrl;
    }

    const port = parsedUrl.port ? `:${parsedUrl.port}` : '';
    const path = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname;
    const suffix = `${path}${parsedUrl.search}${parsedUrl.hash}`;

    if (hasProtocol) {
      return `${parsedUrl.protocol}//${ANDROID_EMULATOR_HOST}${port}${suffix}`;
    }

    return `${ANDROID_EMULATOR_HOST}${port}${suffix}`;
  } catch {
    return trimmedUrl;
  }
};

const getDefaultBackendUrl = (): string => {
  const isAndroidApp = isTauri && isAndroid;
  const androidUrl = import.meta.env.VITE_ANDROID_BACKEND_URL;
  const defaultUrl = import.meta.env.VITE_BACKEND_URL || 'localhost:3000';

  if (isAndroidApp && androidUrl) {
    return androidUrl;
  }

  if (isAndroidApp) {
    return getAndroidReachableBackendUrl(defaultUrl);
  }

  return defaultUrl;
};

export const getBackendUrl = (): string => {
  const storedUrl = getStoredBackendUrl();
  if (!storedUrl) {
    return getDefaultBackendUrl();
  }

  return isTauri && isAndroid
    ? getAndroidReachableBackendUrl(storedUrl)
    : storedUrl;
};

const isProductionBuild = import.meta.env.PROD;

export const environmentVariables = {
  NODE_ENV: isProductionBuild ? 'production' : 'development',
  USE_HTTPS: import.meta.env.VITE_USE_HTTPS === 'true',
  RENDER_SYSTEM_TRAY_ICON:
    import.meta.env.VITE_RENDER_SYSTEM_TRAY_ICON === 'true',
  DEBUG_PANEL_ENABLED:
    import.meta.env.VITE_DEBUG_PANEL_ENABLED !== undefined
      ? import.meta.env.VITE_DEBUG_PANEL_ENABLED === 'true'
      : !isProductionBuild,
  BACKEND_URL: getBackendUrl(),
  GOOGLE_AUTH_CLIENT_ID: import.meta.env.VITE_GOOGLE_AUTH_CLIENT_ID || '',
  GOOGLE_AUTH_CLIENT_SECRET:
    import.meta.env.VITE_GOOGLE_AUTH_CLIENT_SECRET || '',
  SUBSCRIPTION_MONTHLY_PRODUCT_ID:
    import.meta.env.VITE_SUBSCRIPTION_MONTHLY_PRODUCT_ID ||
    'app.pomi.community.pro.monthly',
  SUBSCRIPTION_YEARLY_PRODUCT_ID:
    import.meta.env.VITE_SUBSCRIPTION_YEARLY_PRODUCT_ID ||
    'app.pomi.community.pro.yearly',
  DEV_AUTO_LOGIN_USERNAME: isProductionBuild
    ? ''
    : import.meta.env.VITE_DEV_AUTO_LOGIN_USERNAME || '',
  DEV_AUTO_LOGIN_PASSWORD: isProductionBuild
    ? ''
    : import.meta.env.VITE_DEV_AUTO_LOGIN_PASSWORD || '',
  TEST_CONTEXT_SLUG: isProductionBuild
    ? ''
    : import.meta.env.VITE_TEST_CONTEXT_SLUG || '',
};
