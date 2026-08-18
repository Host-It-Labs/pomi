import { BadRequestException } from '@nestjs/common';

export const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
};

export const requireEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T => {
  if (!allowed.includes(value as T)) {
    throw new BadRequestException(`${field} is invalid`);
  }

  return value as T;
};

export const parseOptionalInt = (
  value: unknown,
  fallback: number,
  field: string,
  min?: number,
  max?: number
): number => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed =
    typeof value === 'number'
      ? Math.trunc(value)
      : typeof value === 'string'
        ? parseInt(value, 10)
        : NaN;

  if (Number.isNaN(parsed)) {
    throw new BadRequestException(`${field} must be a number`);
  }

  let result = parsed;
  if (min !== undefined && result < min) {
    result = min;
  }
  if (max !== undefined && result > max) {
    result = max;
  }

  return result;
};
