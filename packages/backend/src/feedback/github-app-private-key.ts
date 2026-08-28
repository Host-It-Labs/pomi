import { createPrivateKey, type KeyObject } from 'node:crypto';

const PRIVATE_KEY_BEGIN_PATTERN =
  /^-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----/;
const PRIVATE_KEY_END_PATTERN = /-----END ((?:[A-Z0-9]+ )*PRIVATE KEY)-----$/;

function stripSurroundingQuotes(value: string) {
  let result = value.trim();
  while (result.length >= 2) {
    const first = result[0];
    const last = result[result.length - 1];
    if (!((first === '"' && last === '"') || (first === "'" && last === "'"))) {
      break;
    }
    result = result.slice(1, -1).trim();
  }
  return result;
}

function normalizeLineBreaks(value: string) {
  return value
    .replaceAll('\\r\\n', '\n')
    .replaceAll('\\n', '\n')
    .replaceAll('\\r', '\r')
    .replace(/\r\n?/g, '\n');
}

function privateKeyBodyToDer(value: string) {
  const begin = value.match(PRIVATE_KEY_BEGIN_PATTERN);
  const end = value.match(PRIVATE_KEY_END_PATTERN);
  if (begin && end && begin[1] !== end[1]) {
    throw new Error('Private-key wrapper labels do not match.');
  }

  const bodyStart = begin?.[0].length ?? 0;
  const bodyEnd = end ? value.length - end[0].length : value.length;
  if (bodyEnd < bodyStart) throw new Error('Private-key body is invalid.');

  const body = value.slice(bodyStart, bodyEnd).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new Error('Private-key body is not valid base64.');
  }
  const paddedBody = body + '='.repeat((4 - (body.length % 4)) % 4);
  return Buffer.from(paddedBody, 'base64');
}

export function normalizePrivateKey(value: string) {
  const normalized = stripSurroundingQuotes(normalizeLineBreaks(value));
  const begin = normalized.match(PRIVATE_KEY_BEGIN_PATTERN);
  const end = normalized.match(PRIVATE_KEY_END_PATTERN);

  if (begin && end && begin[1] === end[1]) {
    const body = normalized
      .slice(begin[0].length, normalized.length - end[0].length)
      .replace(/\s+/g, '');
    return `${begin[0]}\n${body}\n${end[0]}`;
  }
  if (!begin && !end) return normalized.replace(/\s+/g, '');
  return normalized;
}

export function createPrivateKeyForSigning(
  value: string | KeyObject
): KeyObject {
  if (typeof value !== 'string') return value;

  const normalized = normalizePrivateKey(value);
  try {
    return createPrivateKey(normalized);
  } catch (pemError) {
    try {
      const der = privateKeyBodyToDer(normalized);
      for (const type of ['pkcs8', 'pkcs1'] as const) {
        try {
          return createPrivateKey({ key: der, format: 'der', type });
        } catch {
          // Try the other supported RSA encoding before returning the PEM error.
        }
      }
    } catch {
      // Preserve the original crypto error for the caller's redacted handling.
    }
    throw pemError;
  }
}
