import {
  environmentVariables,
  getBackendUrl,
} from '../config/environmentVariables';
import { backendUrlHasProtocol } from './backendUrlStorage';

const getHttpProtocol = (): string => {
  return environmentVariables.USE_HTTPS ? 'https' : 'http';
};

const getWsProtocol = (): string => {
  return environmentVariables.USE_HTTPS ? 'wss' : 'ws';
};

export const getBackendOrigin = (): string => {
  const backendUrl = getBackendUrl();
  if (backendUrlHasProtocol(backendUrl)) {
    return backendUrl;
  }

  return `${getHttpProtocol()}://${backendUrl}`;
};

export const getBackendSocketOrigin = (): string => {
  const backendUrl = getBackendUrl();
  if (backendUrlHasProtocol(backendUrl)) {
    try {
      const parsedUrl = new URL(backendUrl);
      const socketProtocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${socketProtocol}//${parsedUrl.host}`;
    } catch {
      return `${getWsProtocol()}://${backendUrl}`;
    }
  }

  return `${getWsProtocol()}://${backendUrl}`;
};
