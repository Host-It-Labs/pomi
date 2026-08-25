import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';
import {
  appAuthenticatedEnvironment,
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
    /GitHub App configuration is incomplete in config\/pomi-automation\.env/
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

test('isolates Git commands from stored personal GitHub credentials', () => {
  const environment = appAuthenticatedEnvironment(
    {
      token: 'installation-token',
      app: { id: 4675891, name: 'Pomi Radar' },
      botLogin: 'pomi-radar[bot]',
      botUserId: 123456,
      permissions: { contents: 'write' },
    },
    { GH_TOKEN: 'personal-token', GITHUB_TOKEN: 'personal-token' }
  );

  assert.equal(environment.GH_TOKEN, 'installation-token');
  assert.equal(environment.GITHUB_TOKEN, 'installation-token');
  assert.equal(environment.GIT_CONFIG_KEY_0, 'credential.helper');
  assert.equal(environment.GIT_CONFIG_VALUE_0, '');
  assert.equal(
    environment.GIT_CONFIG_KEY_1,
    'http.https://github.com/.extraheader'
  );
  assert.equal(environment.GIT_CONFIG_VALUE_1, '');
  assert.equal(environment.GIT_SSH_COMMAND, 'false');
  assert.equal(environment.GIT_AUTHOR_NAME, 'Pomi Radar Bot');
  assert.match(environment.GIT_AUTHOR_EMAIL, /pomi-radar\[bot\]/);
});
