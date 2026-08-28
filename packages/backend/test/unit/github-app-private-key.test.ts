import { createSign, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPrivateKeyForSigning } from '../../src/feedback/github-app-private-key';

function signatureFor(value: string) {
  const signer = createSign('RSA-SHA256');
  signer.update('pomi-private-key-format-test');
  signer.end();
  return signer.sign(createPrivateKeyForSigning(value));
}

describe('GitHub App private-key formatting', () => {
  const formats: Array<[string, (pem: string) => string]> = [
    ['PEM newlines', (pem: string) => pem],
    ['literal newline escapes', (pem: string) => pem.replaceAll('\n', '\\n')],
    ['literal CRLF escapes', (pem: string) => pem.replaceAll('\n', '\\r\\n')],
    ['one-line PEM', (pem: string) => pem.replaceAll('\n', '')],
    ['double-quoted PEM', (pem: string) => `"${pem}"`],
    ['single-quoted PEM', (pem: string) => `'${pem}'`],
    [
      'PEM without the end wrapper',
      (pem: string) => pem.replace(/-----END PRIVATE KEY-----\n?$/, ''),
    ],
    [
      'PEM without the begin wrapper',
      (pem: string) => pem.replace(/^-----BEGIN PRIVATE KEY-----\n?/, ''),
    ],
  ];

  it.each(formats)('accepts %s', (_format, format) => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const signature = signatureFor(format(pem));
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from('pomi-private-key-format-test'),
        publicKey,
        signature
      )
    ).toBe(true);
  });

  it('accepts raw PKCS#8 and PKCS#1 base64 without PEM wrappers', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const formats = [
      privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      privateKey.export({ type: 'pkcs1', format: 'der' }).toString('base64'),
    ];

    for (const format of formats) {
      const signature = signatureFor(format);
      expect(
        verify(
          'RSA-SHA256',
          Buffer.from('pomi-private-key-format-test'),
          publicKey,
          signature
        )
      ).toBe(true);
    }
  });
});
