const SAFE_READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const NETWORK_RETRY_DELAYS_MS = Object.freeze([0, 250, 1000]);
export const NO_NETWORK_RETRY_DELAYS_MS = Object.freeze([0]);

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input?.url ?? String(input);
}

function describeNetworkError(error) {
  const cause = error?.cause;
  const code = cause?.code;
  const message = cause?.message ?? error?.message;
  return (
    [code, message && message !== code ? message : null]
      .filter(Boolean)
      .join(': ') || 'unknown network error'
  );
}

export async function fetchWithRetry(input, init, fetchImpl, retryDelays) {
  const method = String(init?.method ?? 'GET').toUpperCase();
  const delays = SAFE_READ_METHODS.has(method)
    ? retryDelays
    : NO_NETWORK_RETRY_DELAYS_MS;
  let lastError;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt])
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    try {
      return await fetchImpl(input, init);
    } catch (error) {
      lastError = error;
    }
  }

  const attempts = delays.length;
  throw new Error(
    `${method} ${requestUrl(input)} network request failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${describeNetworkError(lastError)}`,
    { cause: lastError }
  );
}
