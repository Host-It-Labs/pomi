import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  configureHttpApp,
  createValidationException,
  formatValidationErrors,
  getTrustedProxyHops,
} from '../../src/configure-app';

describe('configureHttpApp', () => {
  it('shares body parsing, CORS, and strict global validation', () => {
    const app = {
      use: vi.fn(),
      set: vi.fn(),
      enableCors: vi.fn(),
      useGlobalPipes: vi.fn(),
    };

    configureHttpApp(app as never);

    expect(app.use).toHaveBeenCalledTimes(5);
    expect(app.use.mock.calls[0][0]).toBe('/system/user-data/import');
    expect(app.use.mock.calls[1][0]).toBe('/assistant');
    expect(app.use.mock.calls[2][0]).toBe('/feedback/transcribe');
    expect(app.set).toHaveBeenCalledWith('trust proxy', expect.any(Number));
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

  it('accepts only a non-negative trusted proxy hop count', () => {
    expect(getTrustedProxyHops(undefined)).toBe(0);
    expect(getTrustedProxyHops('2')).toBe(2);
    expect(() => getTrustedProxyHops('1.5')).toThrow(
      'TRUST_PROXY_HOPS must be a non-negative integer'
    );
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
