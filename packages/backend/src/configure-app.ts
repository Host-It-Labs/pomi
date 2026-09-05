import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { FEEDBACK_TRANSCRIPTION_JSON_LIMIT } from '@pomi/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ValidationError } from 'class-validator';
import { json, urlencoded } from 'express';
import { USER_DATA_IMPORT_JSON_LIMIT } from './system/user-data-transfer.constants';
import { isCorsOriginAllowed } from './config/environment';

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

export function getTrustedProxyHops(
  rawValue = process.env.TRUST_PROXY_HOPS
): number {
  if (rawValue === undefined || rawValue === '') return 0;
  if (!/^\d+$/.test(rawValue)) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  }
  const hops = Number(rawValue);
  if (!Number.isSafeInteger(hops)) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  }
  return hops;
}

export function configureHttpApp(app: NestExpressApplication): void {
  app.use(
    '/system/user-data/import',
    json({ limit: USER_DATA_IMPORT_JSON_LIMIT })
  );
  app.use('/assistant', json({ limit: '10mb' }));
  app.use(
    '/feedback/transcribe',
    json({ limit: FEEDBACK_TRANSCRIPTION_JSON_LIMIT })
  );
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));
  app.set('trust proxy', getTrustedProxyHops());
  app.enableCors({
    credentials: true,
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
