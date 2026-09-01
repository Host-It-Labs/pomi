import {
  environmentVariables,
  getBackendUrl,
} from '../config/environmentVariables';
import { parseBackendOrigin } from './backendUrlStorage';

const getHttpProtocol = (): string => {
  return environmentVariables.USE_HTTPS ? 'https' : 'http';
};

export const getBackendOrigin = (): string => {
  const backendUrl = getBackendUrl();
  const candidate = /^https?:\/\//i.test(backendUrl)
    ? backendUrl
    : `${getHttpProtocol()}://${backendUrl}`;
  return parseBackendOrigin(candidate);
};

export const getBackendSocketOrigin = (): string => {
  const parsedUrl = new URL(getBackendOrigin());
  const socketProtocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${socketProtocol}//${parsedUrl.host}`;
};
