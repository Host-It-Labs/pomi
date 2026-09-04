import { beforeEach, describe, expect, it } from 'vitest';
import {
  BackendOriginError,
  getBackendUrlQuarantine,
  getStoredBackendUrl,
  parseBackendOrigin,
} from './backendUrlStorage';

describe('backend origin security policy', () => {
  beforeEach(() => localStorage.clear());

  it('accepts exact HTTPS origins and development loopback HTTP', () => {
    expect(parseBackendOrigin('https://pomi.example:8443/')).toBe(
      'https://pomi.example:8443'
    );
    expect(parseBackendOrigin('http://localhost:3000')).toBe(
      'http://localhost:3000'
    );
    expect(parseBackendOrigin('http://127.0.0.2:3000')).toBe(
      'http://127.0.0.2:3000'
    );
    expect(parseBackendOrigin('http://10.0.2.2:3000')).toBe(
      'http://10.0.2.2:3000'
    );
  });

  it('rejects plaintext remote hosts and non-origin URL parts', () => {
    expect(() => parseBackendOrigin('http://pomi.example')).toThrow(
      new BackendOriginError('insecure-remote')
    );
    for (const value of [
      'pomi.example',
      'ftp://pomi.example',
      'https://user@pomi.example',
      'https://pomi.example/api',
      'https://pomi.example?token=value',
      'https://pomi.example/#fragment',
    ]) {
      expect(() => parseBackendOrigin(value)).toThrow(BackendOriginError);
    }
  });

  it('quarantines unsafe persisted endpoints before auth state can be reused', () => {
    localStorage.setItem('pomi-backend-url', 'http://pomi.example');
    localStorage.setItem(
      'pomi-auth-storage',
      JSON.stringify({ state: { token: 'legacy-bearer' } })
    );

    expect(getStoredBackendUrl()).toBeNull();
    expect(localStorage.getItem('pomi-backend-url')).toBeNull();
    expect(localStorage.getItem('pomi-auth-storage')).toBeNull();
    expect(getBackendUrlQuarantine()).toBe('insecure-remote');
  });
});
