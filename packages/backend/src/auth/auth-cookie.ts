import type { Request, Response } from 'express';

export const REFRESH_COOKIE_NAME = 'pomi_refresh';
export const REFRESH_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function getRefreshTokenCookieValue(
  request: Request
): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;

  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    if (name !== REFRESH_COOKIE_NAME) continue;

    const value = entry.slice(separator + 1).trim();
    if (!value) return undefined;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

function cookieOptions(request: Request) {
  const secure = request.secure || request.protocol === 'https';
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ('none' as const) : ('lax' as const),
    path: '/sessions',
  };
}

export function setRefreshTokenCookieValue(
  response: Response,
  request: Request,
  encryptedRefreshToken: string
): void {
  response.cookie(REFRESH_COOKIE_NAME, encryptedRefreshToken, {
    ...cookieOptions(request),
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

export function clearRefreshTokenCookie(
  response: Response,
  request: Request
): void {
  response.clearCookie(REFRESH_COOKIE_NAME, cookieOptions(request));
}
