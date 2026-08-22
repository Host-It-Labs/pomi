import { ValidationPipe } from '@nestjs/common';
import express, { type Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureHttpApp,
  createValidationException,
  formatValidationErrors,
  parseTrustedProxySetting,
} from '../../src/configure-app';

describe('configureHttpApp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shares body parsing, CORS, and strict global validation', () => {
    const app = {
      use: vi.fn(),
      enableCors: vi.fn(),
      useGlobalPipes: vi.fn(),
    };

    configureHttpApp(app as never);

    expect(app.use).toHaveBeenCalledTimes(4);
    expect(app.use.mock.calls[0][0]).toBe('/system/user-data/import');
    expect(app.use.mock.calls[1][0]).toBe('/assistant');
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: expect.any(Function),
    });
    expect(app.useGlobalPipes).toHaveBeenCalledWith(expect.any(ValidationPipe));

    const [{ origin }] = app.enableCors.mock.calls[0];
    const callback = vi.fn();
    origin('http://localhost:1424', callback);
    expect(callback).toHaveBeenCalledWith(null, true);

    callback.mockClear();
    origin('https://attacker.example', callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('configures only an explicit bounded proxy trust policy', () => {
    const app = {
      set: vi.fn(),
      use: vi.fn(),
      enableCors: vi.fn(),
      useGlobalPipes: vi.fn(),
    };
    vi.stubEnv('POMI_TRUST_PROXY', '192.0.2.0/24, 2001:db8::/48');

    configureHttpApp(app as never);

    expect(app.set).toHaveBeenCalledWith('trust proxy', [
      '192.0.2.0/24',
      '2001:db8::/48',
    ]);
  });

  it('keeps forwarded headers untrusted by default', () => {
    expect(parseTrustedProxySetting(undefined)).toBe(false);
    expect(parseTrustedProxySetting('false')).toBe(false);
  });

  it('supports a bounded hop count and rejects unsafe or invalid policies', () => {
    expect(parseTrustedProxySetting('1')).toBe(1);
    expect(() => parseTrustedProxySetting('true')).toThrow(/unsafe/);
    expect(() => parseTrustedProxySetting('0')).toThrow(/between 1 and 10/);
    expect(() => parseTrustedProxySetting('not-a-network')).toThrow(
      /valid IP addresses/
    );
  });

  it('uses forwarded client addresses only through a trusted proxy path', () => {
    expect(resolveClientIp(false, '127.0.0.1', '203.0.113.40')).toBe(
      '127.0.0.1'
    );
    expect(resolveClientIp(['loopback'], '127.0.0.1', '203.0.113.40')).toBe(
      '203.0.113.40'
    );
    expect(
      resolveClientIp(['198.51.100.0/24'], '127.0.0.1', '203.0.113.40')
    ).toBe('127.0.0.1');
  });

  it('formats nested validation failures as field-oriented safe messages', () => {
    expect(
      formatValidationErrors([
        {
          property: 'defaults',
          constraints: undefined,
          children: [
            {
              property: 'description',
              constraints: {
                maxLength:
                  'description must be shorter than or equal to 1000 characters',
              },
              children: [],
            },
          ],
          target: {},
          value: 'private text',
        },
      ])
    ).toEqual([
      'defaults.description: description must be shorter than or equal to 1000 characters',
    ]);
  });

  it('returns validation messages in the string shape used by the API contract', () => {
    const exception = createValidationException([
      {
        property: 'title',
        constraints: {
          maxLength: 'title must be shorter than or equal to 500 characters',
        },
        children: [],
        target: {},
        value: 'private text',
      },
      {
        property: 'description',
        constraints: {
          maxLength:
            'description must be shorter than or equal to 10000 characters',
        },
        children: [],
        target: {},
        value: 'private text',
      },
    ]);

    expect(exception.getResponse()).toMatchObject({
      message:
        'title must be shorter than or equal to 500 characters; description must be shorter than or equal to 10000 characters',
    });
  });
});

function resolveClientIp(
  trustProxy: false | number | string[],
  remoteAddress: string,
  forwardedFor: string
): string | undefined {
  const app = express();
  app.set('trust proxy', trustProxy);
  const request = Object.create(app.request) as Request;
  Object.assign(request, {
    app,
    socket: { remoteAddress },
    headers: { 'x-forwarded-for': forwardedFor },
  });
  return request.ip;
}
