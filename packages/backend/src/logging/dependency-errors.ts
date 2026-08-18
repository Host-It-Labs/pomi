const TRANSIENT_DEPENDENCY_ERROR_CODES = new Set([
  '08001',
  '08003',
  '08004',
  '08006',
  '53300',
  '57P01',
  '57P03',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

export function isTransientDependencyError(error: unknown): boolean {
  return isTransientDependencyErrorWithSeen(error, new WeakSet<object>());
}

function isTransientDependencyErrorWithSeen(
  error: unknown,
  seen: WeakSet<object>
): boolean {
  if (!error || typeof error !== 'object') return false;
  if (seen.has(error)) return false;
  seen.add(error);

  const candidate = error as {
    code?: unknown;
    cause?: unknown;
    driverError?: { code?: unknown };
  };
  if (
    (typeof candidate.code === 'string' &&
      TRANSIENT_DEPENDENCY_ERROR_CODES.has(candidate.code)) ||
    (typeof candidate.driverError?.code === 'string' &&
      TRANSIENT_DEPENDENCY_ERROR_CODES.has(candidate.driverError.code))
  ) {
    return true;
  }
  return isTransientDependencyErrorWithSeen(candidate.cause, seen);
}
