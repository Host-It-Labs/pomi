import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function refreshSecretsMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function encryptionKey(keyMaterial: string): Buffer {
  return createHash('sha256').update(keyMaterial).digest();
}

export function encryptRefreshSecret(
  secret: string,
  keyMaterial: string
): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(
    CIPHER_ALGORITHM,
    encryptionKey(keyMaterial),
    iv
  );
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext]
    .map(value => value.toString('base64url'))
    .join('.');
}

export function decryptRefreshSecret(
  encoded: string,
  keyMaterial: string
): string {
  const [encodedIv, encodedTag, encodedCiphertext] = encoded.split('.');
  if (!encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error('Invalid encrypted refresh secret');
  }

  const decipher = createDecipheriv(
    CIPHER_ALGORITHM,
    encryptionKey(keyMaterial),
    Buffer.from(encodedIv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
