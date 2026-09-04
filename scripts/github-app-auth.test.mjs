import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';
import {
  ALLOWED_COMMANDS,
  appAuthenticatedEnvironment,
  createAppJwt,
  readGitHubAppConfiguration,
  validateMutationPermissions,
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

test('accepts inline private keys in supported deployment formats', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const formats = [
    ['PEM newlines', pem],
    ['literal newline escapes', pem.replaceAll('\n', '\\n')],
    ['literal CRLF escapes', pem.replaceAll('\n', '\\r\\n')],
    ['one-line PEM', pem.replaceAll('\n', '')],
    ['double-quoted PEM', `"${pem}"`],
    ['single-quoted PEM', `'${pem}'`],
    [
      'PEM without the end wrapper',
      pem.replace(/-----END PRIVATE KEY-----\n?$/, ''),
    ],
    [
      'PEM without the begin wrapper',
      pem.replace(/^-----BEGIN PRIVATE KEY-----\n?/, ''),
    ],
    [
      'PKCS#8 base64 without wrappers',
      privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    ],
    [
      'PKCS#1 base64 without wrappers',
      privateKey.export({ type: 'pkcs1', format: 'der' }).toString('base64'),
    ],
  ];

  for (const [format, value] of formats) {
    const config = readGitHubAppConfiguration({
      POMI_RADAR_GITHUB_APP_ID: '4675891',
      POMI_RADAR_GITHUB_APP_INSTALLATION_ID: '155743206',
      POMI_RADAR_GITHUB_APP_PRIVATE_KEY: value,
    });
    const jwt = createAppJwt({
      appId: config.appId,
      privateKey: config.privateKey,
      now: Date.UTC(2026, 7, 22, 12, 0, 0),
    });
    const [header, payload, signature] = jwt.split('.');
    assert.equal(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, 'base64url')
      ),
      true,
      format
    );
    assert.ok(payload);
    assert.equal(config.privateKeyPath, undefined);
  }
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
    {
      GH_TOKEN: 'personal-token',
      GITHUB_TOKEN: 'personal-token',
      POMI_RADAR_GITHUB_APP_PRIVATE_KEY: 'sentinel-private-key',
      POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH: 'sentinel-private-key-path',
      GITHUB_FEEDBACK_APP_PRIVATE_KEY: 'sentinel-feedback-private-key',
      GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH:
        'sentinel-feedback-private-key-path',
    }
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
  assert.equal(environment.POMI_RADAR_GITHUB_APP_PRIVATE_KEY, undefined);
  assert.equal(environment.POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH, undefined);
  assert.equal(environment.GITHUB_FEEDBACK_APP_PRIVATE_KEY, undefined);
  assert.equal(environment.GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH, undefined);
  assert.doesNotMatch(JSON.stringify(environment), /sentinel-private-key/);
  assert.doesNotMatch(
    JSON.stringify(environment),
    /sentinel-feedback-private-key/
  );
});

test('preserves implementation command capabilities without forwarding private keys', () => {
  assert.deepEqual([...ALLOWED_COMMANDS].sort(), ['gh', 'git', 'node', 'pnpm']);
  const environment = appAuthenticatedEnvironment(
    {
      token: 'installation-token',
      app: { id: 4675891, name: 'Pomi Radar' },
      botLogin: 'pomi-radar[bot]',
      botUserId: 123456,
      permissions: {
        contents: 'write',
        issues: 'write',
        pull_requests: 'write',
      },
    },
    {
      POMI_RADAR_GITHUB_APP_PRIVATE_KEY: 'sentinel-private-key',
      POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH: 'sentinel-private-key-path',
    }
  );
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      "process.stdout.write(JSON.stringify({token: process.env.GH_TOKEN, key: process.env.POMI_RADAR_GITHUB_APP_PRIVATE_KEY})); process.stderr.write('safe diagnostic');",
    ],
    { encoding: 'utf8', env: environment }
  );
  assert.equal(child.status, 0);
  assert.match(child.stdout, /installation-token/);
  assert.doesNotMatch(child.stdout, /sentinel-private-key/);
  assert.doesNotMatch(child.stderr, /sentinel-private-key/);
});

test('requires mutation permissions before spawning App-authenticated commands', () => {
  assert.doesNotThrow(() =>
    validateMutationPermissions({
      contents: 'write',
      issues: 'write',
      pull_requests: 'write',
    })
  );
  assert.throws(
    () =>
      validateMutationPermissions({
        contents: 'write',
        issues: 'read',
        pull_requests: 'write',
      }),
    /lacks required contents, issues, or pull-request write permission/
  );
});
