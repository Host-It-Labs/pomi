import { HttpException } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  formatSafeError,
  sanitizeSentryError,
  sanitizeLogText,
  sanitizeLogValue,
} from './sanitize-log';

export class SentryLoggerService implements LoggerService {
  private readonly appLabel: string;
  private readonly envLabel: string;

  constructor(appLabelOverride?: string) {
    this.appLabel = appLabelOverride || process.env.APP_NAME || 'pomi-backend';
    this.envLabel = process.env.NODE_ENV || 'development';
  }

  log(message: any, context?: string) {
    console.log(this.prefix('LOG', context), this.formatMessage(message));
  }

  info(message: any, context?: string) {
    console.info(this.prefix('INFO', context), this.formatMessage(message));
    this.sendLog('info', message, context);
  }

  error(message: any, trace?: string, context?: string) {
    console.error(
      this.prefix('ERROR', context),
      this.formatMessage(message),
      trace ? sanitizeLogText(trace) : ''
    );
    this.captureError(message, trace, context);
  }

  warn(message: any, context?: string) {
    console.warn(this.prefix('WARN', context), this.formatMessage(message));
    this.sendLog('warn', message, context);
  }

  debug?(message: any, context?: string) {
    console.debug(this.prefix('DEBUG', context), this.formatMessage(message));
  }

  verbose?(message: any, context?: string) {
    console.debug(this.prefix('VERBOSE', context), this.formatMessage(message));
  }

  private prefix(level: string, context?: string) {
    return `[${level}]${context ? ` [${context}]` : ''}`;
  }

  private formatMessage(message: any): string {
    if (message instanceof Error) {
      return formatSafeError(message);
    }
    if (typeof message === 'string') {
      return sanitizeLogText(message);
    }
    try {
      return JSON.stringify(sanitizeLogValue(message));
    } catch {
      return 'UnserializableLogValue';
    }
  }

  private sendLog(
    level: 'info' | 'warn' | 'error',
    message: any,
    context?: string
  ) {
    const formatted = this.formatMessage(message);
    Sentry.logger[level](formatted, {
      app: this.appLabel,
      env: this.envLabel,
      context: context || 'App',
    });
  }

  private captureError(message: any, trace?: string, context?: string) {
    if (message instanceof HttpException && message.getStatus() < 500) {
      return;
    }

    const error =
      message instanceof Error
        ? sanitizeSentryError(message)
        : new Error(this.formatMessage(message));
    if (!(message instanceof Error)) {
      error.name = 'LoggedError';
    }

    Sentry.withScope(scope => {
      scope.setLevel('error');
      scope.setTag('app', this.appLabel);
      scope.setTag('env', this.envLabel);
      scope.setTag('context', context || 'App');
      if (trace) scope.setExtra('trace', sanitizeLogText(trace));
      Sentry.captureException(error);
    });
  }
}
