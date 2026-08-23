import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';
import {
  createAppJwt,
  readGitHubAppConfiguration,
} from './github-app-auth.mjs';

test('creates a short-lived RS256 GitHub App JWT', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const now = Date.UTC(2026, 7, 22, 12, 0, 0);
  const jwt = createAppJwt({ appId: '1234', privateKey, now });
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), {
    alg: 'RS256',
    typ: 'JWT',
  });
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.iss, '1234');
  assert.equal(claims.exp - claims.iat, 600);
  assert.equal(
    verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url')
    ),
    true
  );
});

test('fails closed with a redacted missing-configuration diagnostic', () => {
  assert.throws(
    () => readGitHubAppConfiguration({}),
    /GitHub App configuration is incomplete/
  );
});

test('rejects a different GitHub App before authentication', () => {
  assert.throws(
    () =>
      readGitHubAppConfiguration({
        POMI_RADAR_GITHUB_APP_ID: '1234',
        POMI_RADAR_GITHUB_APP_INSTALLATION_ID: '5678',
        POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH:
          'config/secrets/pomi-radar.private-key.pem',
      }),
    /does not identify Pomi Radar/
  );
});
