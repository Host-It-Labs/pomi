import {
  environmentVariables,
  getBackendUrl,
} from '../config/environmentVariables';
import { isLoopbackBackendHost, parseBackendOrigin } from './backendUrlStorage';

const getHttpProtocol = (): string => {
  return environmentVariables.USE_HTTPS ? 'https' : 'http';
};

export const alignDevelopmentLoopbackOrigin = (
  backendOrigin: string,
  frontendOrigin: string
): string => {
  const backend = new URL(backendOrigin);
  const frontend = new URL(frontendOrigin);
  if (
    backend.protocol === 'http:' &&
    frontend.protocol === 'http:' &&
    isLoopbackBackendHost(backend.hostname) &&
    isLoopbackBackendHost(frontend.hostname)
  ) {
    backend.hostname = frontend.hostname;
  }
  return backend.origin;
};

export const getBackendOrigin = (): string => {
  const backendUrl = getBackendUrl();
  const candidate = /^https?:\/\//i.test(backendUrl)
    ? backendUrl
    : `${getHttpProtocol()}://${backendUrl}`;
  const origin = parseBackendOrigin(candidate);
  return typeof window === 'undefined'
    ? origin
    : alignDevelopmentLoopbackOrigin(origin, window.location.origin);
};

export const getBackendSocketOrigin = (): string => {
  const parsedUrl = new URL(getBackendOrigin());
  const socketProtocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${socketProtocol}//${parsedUrl.host}`;
};
