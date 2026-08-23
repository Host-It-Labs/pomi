import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../../src/auth/auth.guard';

function context(path: string) {
  const request = {
    path,
    headers: { authorization: 'Bearer token' },
  };
  return {
    request,
    executionContext: {
      switchToHttp: () => ({ getRequest: () => request }),
    },
  };
}

describe('hosted subscription enforcement', () => {
  it('blocks hosted product APIs without an active entitlement', async () => {
    const billing = { hasProductAccess: vi.fn(async () => false) };
    const guard = new AuthGuard(
      { verifyAsync: vi.fn(async () => ({ sub: 'user-1' })) } as never,
      { userExists: vi.fn(async () => true) } as never,
      billing as never
    );

    await expect(
      guard.canActivate(context('/watch/status').executionContext as never)
    ).rejects.toMatchObject<HttpException>({ status: 402 });
    expect(billing.hasProductAccess).toHaveBeenCalledOnce();
  });

  it('allows entitlement sync and self-hosted APIs', async () => {
    const hostedBilling = { hasProductAccess: vi.fn(async () => false) };
    const hostedGuard = new AuthGuard(
      { verifyAsync: vi.fn(async () => ({ sub: 'user-1' })) } as never,
      { userExists: vi.fn(async () => true) } as never,
      hostedBilling as never
    );
    await expect(
      hostedGuard.canActivate(
        context('/billing/entitlement/sync').executionContext as never
      )
    ).resolves.toBe(true);

    const selfHostedBilling = { hasProductAccess: vi.fn(async () => true) };
    const selfHostedGuard = new AuthGuard(
      { verifyAsync: vi.fn(async () => ({ sub: 'user-1' })) } as never,
      { userExists: vi.fn(async () => true) } as never,
      selfHostedBilling as never
    );
    await expect(
      selfHostedGuard.canActivate(
        context('/watch/status').executionContext as never
      )
    ).resolves.toBe(true);
    expect(hostedBilling.hasProductAccess).not.toHaveBeenCalled();
    expect(selfHostedBilling.hasProductAccess).toHaveBeenCalledOnce();
  });

  it('preserves entitlement dependency failures as retryable server errors', async () => {
    const dependencyError = new Error('billing database unavailable');
    const guard = new AuthGuard(
      { verifyAsync: vi.fn(async () => ({ sub: 'user-1' })) } as never,
      { userExists: vi.fn(async () => true) } as never,
      {
        hasProductAccess: vi.fn(async () => {
          throw dependencyError;
        }),
      } as never
    );

    await expect(
      guard.canActivate(context('/watch/status').executionContext as never)
    ).rejects.toBe(dependencyError);
  });
});
