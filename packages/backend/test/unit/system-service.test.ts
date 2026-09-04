import { describe, expect, it, vi } from 'vitest';
import { SystemService } from '../../src/system/system.service';

function createService(hostingMode: string | undefined, adminCount: number) {
  return new SystemService(
    { get: vi.fn(() => hostingMode) } as never,
    { countAdmins: vi.fn(async () => adminCount) } as never
  );
}

describe('system service authentication bootstrap status', () => {
  it('requires the bootstrap token only before the first self-hosted admin', async () => {
    await expect(createService(undefined, 0).getSystemInfo()).resolves.toEqual({
      hostingMode: 'self-hosted',
      selfHosted: true,
      requiresAdminBootstrapToken: true,
    });
    await expect(createService(undefined, 1).getSystemInfo()).resolves.toEqual({
      hostingMode: 'self-hosted',
      selfHosted: true,
      requiresAdminBootstrapToken: false,
    });
  });

  it('never requests a bootstrap token in hosted mode', async () => {
    await expect(createService('hosted', 0).getSystemInfo()).resolves.toEqual({
      hostingMode: 'hosted',
      selfHosted: false,
      requiresAdminBootstrapToken: false,
    });
  });
});
