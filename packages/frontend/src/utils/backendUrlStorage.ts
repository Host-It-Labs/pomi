const STORAGE_KEY = 'pomi-backend-url';
const QUARANTINE_KEY = 'pomi-backend-url-quarantine';

export type BackendOriginRejection = 'invalid' | 'insecure-remote';

export class BackendOriginError extends Error {
  constructor(readonly reason: BackendOriginRejection) {
    super(reason);
    this.name = 'BackendOriginError';
  }
}

const isIpv4Loopback = (hostname: string): boolean => {
  const parts = hostname.split('.');
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
};

export const isLoopbackBackendHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    isIpv4Loopback(normalized)
  );
};

const allowsDevelopmentPlaintext = (hostname: string): boolean => {
  if (isLoopbackBackendHost(hostname)) return true;
  if (import.meta.env.PROD) return false;
  if (hostname === '10.0.2.2') return true;
  return import.meta.env.VITE_ALLOW_INSECURE_REMOTE_BACKEND === 'true';
};

export const parseBackendOrigin = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    throw new BackendOriginError('invalid');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BackendOriginError('invalid');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new BackendOriginError('invalid');
  }

  if (
    parsed.protocol === 'http:' &&
    !allowsDevelopmentPlaintext(parsed.hostname)
  ) {
    throw new BackendOriginError('insecure-remote');
  }

  return parsed.origin;
};

export const sanitizeBackendUrl = (value: string): string => {
  try {
    return parseBackendOrigin(value);
  } catch {
    return '';
  }
};

export const backendUrlHasProtocol = (value: string): boolean => {
  return /^https?:\/\//i.test(value);
};

const quarantineStoredBackend = (reason: BackendOriginRejection): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(QUARANTINE_KEY, reason);
    localStorage.removeItem('pomi-auth-storage');
  } catch {
    // Storage can be unavailable in hardened webviews.
  }
};

export const getStoredBackendUrl = (): string | null => {
  if (typeof window === 'undefined') return null;

  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    try {
      return parseBackendOrigin(value);
    } catch (error) {
      quarantineStoredBackend(
        error instanceof BackendOriginError ? error.reason : 'invalid'
      );
      return null;
    }
  } catch {
    return null;
  }
};

export const getBackendUrlQuarantine = (): BackendOriginRejection | null => {
  if (typeof window === 'undefined') return null;
  try {
    const value = localStorage.getItem(QUARANTINE_KEY);
    return value === 'invalid' || value === 'insecure-remote' ? value : null;
  } catch {
    return null;
  }
};

export const clearBackendUrlQuarantine = (): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(QUARANTINE_KEY);
  } catch {
    // Storage can be unavailable in hardened webviews.
  }
};

export const setStoredBackendUrl = (value: string): void => {
  if (typeof window === 'undefined') return;
  const origin = parseBackendOrigin(value);
  localStorage.setItem(STORAGE_KEY, origin);
  clearBackendUrlQuarantine();
};

export const clearStoredBackendUrl = (): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    clearBackendUrlQuarantine();
  } catch {
    // Storage can be unavailable in hardened webviews.
  }
};
