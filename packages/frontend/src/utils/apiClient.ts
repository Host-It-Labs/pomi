import { apiContract } from '@pomi/shared/src/api/contract';
import { initClient } from '@ts-rest/core';
import { useAuthStore } from '../stores/authStore';
import { requestBackendConnectionRecovery } from './backendConnectionRecovery';
import { getBackendOrigin } from './backendUrl';
import { startServerResponseWatch } from './serverResponseMonitor';
import type { TsRestZod4Client } from './tsRestZod4Client';

export const baseUrl = () => {
  return getBackendOrigin();
};

const rawClient = initClient(apiContract as never, {
  baseUrl: baseUrl(),
  baseHeaders: {
    'Content-Type': 'application/json',
    Authorization: () => {
      const token = useAuthStore.getState().token;
      return token ? `Bearer ${token}` : '';
    },
  },
  credentials: 'include',
  validateResponse: true,
}) as unknown as TsRestZod4Client<typeof apiContract>;

const responseStatus = (response: unknown): number | null =>
  response && typeof response === 'object' && 'status' in response
    ? Number((response as { status: unknown }).status)
    : null;

const SESSION_ROUTES = new Set([
  'sessions.create',
  'sessions.deleteCurrent',
  'sessions.migrate',
  'sessions.refresh',
]);

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

const READ_RECOVERY_ROUTES = new Set([
  'assistant.debugLogs',
  'assistant.debugStatus',
  'assistant.models',
  'assistant.settings',
  'assistant.status',
  'intentions.list',
  'lists.items',
  'lists.list',
  'notifications.provider',
  'preferences.get',
  'statistics.heatmap',
  'statistics.intentionsToday',
  'statistics.summary',
  'statistics.topIntentions',
  'system.get',
  'tasks.importStatus',
  'tasks.archive',
  'tasks.list',
  'tasks.logs',
  'tasks.statistics',
  'users.getPushToken',
  'vacation.status',
  'workTimerLogs.list',
]);

const READ_RECOVERY_DELAY_MS = 250;

export const isBrowserNetworkError = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof DOMException && error.name === 'NetworkError');

export const retryReadOnce = async (
  call: (input: unknown) => Promise<unknown>,
  request: unknown
): Promise<unknown> => {
  try {
    return await call(withDynamicBaseUrl(request));
  } catch (error) {
    if (!isBrowserNetworkError(error)) throw error;
    requestBackendConnectionRecovery();
    await new Promise(resolve => setTimeout(resolve, READ_RECOVERY_DELAY_MS));
    return call(withDynamicBaseUrl(request));
  }
};

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
            const response = READ_RECOVERY_ROUTES.has(routePath)
              ? await retryReadOnce(call, request)
              : await call(withDynamicBaseUrl(request));
            if (
              responseStatus(response) === 401 &&
              !SESSION_ROUTES.has(routePath)
            ) {
              const refreshed = await useAuthStore.getState().refreshSession();
              if (refreshed) {
                const retryResponse = await call(withDynamicBaseUrl(request));
                if (responseStatus(retryResponse) === 401) {
                  useAuthStore.getState().expireSession();
                }
                return retryResponse;
              }
              useAuthStore.getState().expireSession();
            }
            return response;
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
