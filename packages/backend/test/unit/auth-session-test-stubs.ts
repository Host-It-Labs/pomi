import { vi } from 'vitest';

export const createSessionServiceStub = () =>
  ({
    createSession: vi.fn(async () => ({
      sessionId: '00000000-0000-4000-8000-000000000001',
      refreshToken: 'refresh-token',
    })),
    getRefreshSessionUserId: vi.fn(async () => 'user-1'),
    isAccessSessionActive: vi.fn(async () => true),
    isLegacyTokenAllowed: vi.fn(() => true),
  }) as never;
