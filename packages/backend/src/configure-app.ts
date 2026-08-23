import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ValidationError } from 'class-validator';
import { json, urlencoded } from 'express';
import { isIP } from 'node:net';
import { USER_DATA_IMPORT_JSON_LIMIT } from './system/user-data-transfer.constants';
import { isCorsOriginAllowed } from './config/environment';

const TRUST_PROXY_ALIASES = new Set(['loopback', 'linklocal', 'uniquelocal']);

export type TrustedProxySetting = number | string[] | false;

export function parseTrustedProxySetting(
  value: string | undefined
): TrustedProxySetting {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === 'false') return false;
  if (normalized.toLowerCase() === 'true') {
    throw new Error(
      'POMI_TRUST_PROXY=true is unsafe; configure a hop count or trusted proxy CIDRs'
    );
  }
  if (/^\d+$/.test(normalized)) {
    const hops = Number(normalized);
    if (hops >= 1 && hops <= 10) return hops;
    throw new Error('POMI_TRUST_PROXY hop count must be between 1 and 10');
  }

  const proxies = normalized
    .split(',')
    .map(proxy => proxy.trim().toLowerCase())
    .filter(Boolean);
  if (proxies.length === 0 || !proxies.every(isTrustedProxyEntry)) {
    throw new Error(
      'POMI_TRUST_PROXY must contain valid IP addresses, CIDRs, or safe proxy aliases'
    );
  }
  return proxies;
}

function isTrustedProxyEntry(entry: string): boolean {
  if (TRUST_PROXY_ALIASES.has(entry) || isIP(entry) !== 0) return true;
  const [address, prefix, extra] = entry.split('/');
  if (extra !== undefined || !prefix || !/^\d+$/.test(prefix)) return false;
  const version = isIP(address);
  const bits = Number(prefix);
  return (version === 4 && bits <= 32) || (version === 6 && bits <= 128);
}

export function formatValidationErrors(errors: ValidationError[]): string[] {
  const messages: string[] = [];

  const visit = (error: ValidationError, parentPath?: string) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    for (const message of Object.values(error.constraints ?? {})) {
      messages.push(
        message.startsWith(`${path} `) ? message : `${path}: ${message}`
      );
    }
    for (const child of error.children ?? []) {
      visit(child, path);
    }
  };

  for (const error of errors) {
    visit(error);
  }

  return messages.length > 0 ? messages : ['Request validation failed'];
}

export function createValidationException(errors: ValidationError[]) {
  return new BadRequestException(formatValidationErrors(errors).join('; '));
}

export function configureHttpApp(app: NestExpressApplication): void {
  const trustedProxy = parseTrustedProxySetting(process.env.POMI_TRUST_PROXY);
  if (trustedProxy !== false) app.set('trust proxy', trustedProxy);
  app.use(
    '/system/user-data/import',
    json({ limit: USER_DATA_IMPORT_JSON_LIMIT })
  );
  app.use('/assistant', json({ limit: '10mb' }));
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));
  app.enableCors({
    origin: (origin, callback) => {
      try {
        callback(null, isCorsOriginAllowed(origin));
      } catch (error) {
        callback(
          error instanceof Error
            ? error
            : new Error('Invalid CORS configuration')
        );
      }
    },
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: createValidationException,
    })
  );
}
