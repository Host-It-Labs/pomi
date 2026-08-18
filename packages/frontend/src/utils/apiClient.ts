import { apiContract } from '@pomi/shared/src/api/contract';
import { initClient } from '@ts-rest/core';
import { useAuthStore } from '../stores/authStore';
import { getBackendOrigin } from './backendUrl';
import { startServerResponseWatch } from './serverResponseMonitor';

const getAuthFromStorage = () => {
  try {
    const authData = localStorage.getItem('pomi-auth-storage');
    return authData ? JSON.parse(authData) : {};
  } catch (error) {
    console.error('Failed to parse auth data from localStorage:', error);
    return {};
  }
};

export const baseUrl = () => {
  return getBackendOrigin();
};

const rawClient = initClient(apiContract, {
  baseUrl: baseUrl(),
  baseHeaders: {
    'Content-Type': 'application/json',
    Authorization: () => {
      const authData = getAuthFromStorage();
      const token = authData.state?.token;
      return token ? `Bearer ${token}` : '';
    },
  },
  validateResponse: true,
});

const withAuthHandling = <T>(response: T) => {
  if (
    response &&
    typeof response === 'object' &&
    'status' in response &&
    (response as { status: number }).status === 401 &&
    window.location.pathname !== '/login'
  ) {
    useAuthStore.getState().expireSession();
  }

  return response;
};

const withDynamicBaseUrl = (request: unknown) => {
  const overrideClientOptions = { baseUrl: baseUrl() };

  if (!request || typeof request !== 'object') {
    return { overrideClientOptions };
  }

  const requestOptions = request as Record<string, unknown>;
  const existingOverrides =
    typeof requestOptions.overrideClientOptions === 'object'
      ? (requestOptions.overrideClientOptions as Record<string, unknown>)
      : {};

  return {
    ...requestOptions,
    overrideClientOptions: {
      ...existingOverrides,
      ...overrideClientOptions,
    },
  };
};

const SERVER_RESPONSE_WATCHED_ROUTES = new Set([
  'intentions.archive',
  'intentions.create',
  'intentions.delete',
  'intentions.reparent',
  'intentions.unarchive',
  'intentions.update',
  'notifications.test',
  'preferences.update',
  'sessions.deleteCurrent',
  'system.debugSentry',
  'system.importUserData',
  'tasks.create',
  'users.updatePushToken',
  'workTimerLogs.delete',
  'workTimerLogs.update',
]);

const wrapClientWithPath = <T extends object>(
  client: T,
  pathParts: string[]
): T => {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof value === 'function') {
        return async (...args: unknown[]) => {
          const request = args.length > 0 ? args[0] : undefined;
          const call = value as (input: unknown) => Promise<unknown>;
          const routePath = [...pathParts, String(prop)].join('.');
          const stopWatchingServer = SERVER_RESPONSE_WATCHED_ROUTES.has(
            routePath
          )
            ? startServerResponseWatch()
            : undefined;
          try {
            const response = await call(withDynamicBaseUrl(request));
            if (routePath === 'sessions.deleteCurrent') {
              return response;
            }
            return withAuthHandling(response);
          } finally {
            stopWatchingServer?.();
          }
        };
      }

      if (value && typeof value === 'object') {
        return wrapClientWithPath(value, [...pathParts, String(prop)]);
      }

      return value;
    },
  });
};

const wrapClient = <T extends object>(client: T): T => {
  return wrapClientWithPath(client, []);
};

export const apiClient = wrapClient(rawClient);
