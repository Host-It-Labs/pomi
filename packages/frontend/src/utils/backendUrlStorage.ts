const STORAGE_KEY = 'pomi-backend-url';

export const sanitizeBackendUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.replace(/\/+$/g, '');
};

export const backendUrlHasProtocol = (value: string): boolean => {
  return /^https?:\/\//i.test(value);
};

export const getStoredBackendUrl = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) {
      return null;
    }

    const sanitized = sanitizeBackendUrl(value);
    return sanitized ? sanitized : null;
  } catch {
    return null;
  }
};

export const setStoredBackendUrl = (value: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  const sanitized = sanitizeBackendUrl(value);
  if (!sanitized) {
    return;
  }

  localStorage.setItem(STORAGE_KEY, sanitized);
};

export const clearStoredBackendUrl = () => {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
};
