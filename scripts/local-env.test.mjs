import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  environmentFiles,
  loadAutomationEnvironment,
  loadLocalEnvironment,
  loadReleaseEnvironment,
  mergeEnvironment,
  parseEnvironmentFile,
  primaryCheckoutRoot,
  repositoryRoot,
  resolveEnvironmentFile,
  resolveRepositoryPath,
} from './local-env.mjs';

test('parses comments, exports, optional quotes, embedded equals signs, and PEM blocks', () => {
  assert.deepEqual(
    parseEnvironmentFile(`
# comment
PLAIN=value
export QUOTED="hello world"
TOKEN=part=two
UNQUOTED_PEM=-----BEGIN PRIVATE KEY-----
base64-line
-----END PRIVATE KEY-----
AFTER_PEM=value
INVALID LINE
`),
    {
      PLAIN: 'value',
      QUOTED: 'hello world',
      TOKEN: 'part=two',
      UNQUOTED_PEM:
        '-----BEGIN PRIVATE KEY-----\nbase64-line\n-----END PRIVATE KEY-----',
      AFTER_PEM: 'value',
    }
  );
});

test('parses quoted and wrapper-free private-key blocks without consuming the next variable', () => {
  assert.deepEqual(
    parseEnvironmentFile(`
POMI_RADAR_GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MII=
-----END PRIVATE KEY-----"
GITHUB_FEEDBACK_APP_PRIVATE_KEY=base64-line
second-base64-line
AFTER_PEM=value
`),
    {
      POMI_RADAR_GITHUB_APP_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\nMII=\n-----END PRIVATE KEY-----',
      GITHUB_FEEDBACK_APP_PRIVATE_KEY: 'base64-line\nsecond-base64-line',
      AFTER_PEM: 'value',
    }
  );
});

test('gives an empty environment assignment precedence over wrapper-free key data', () => {
  assert.deepEqual(
    parseEnvironmentFile(`
POMI_RADAR_GITHUB_APP_PRIVATE_KEY=QUJD
CI=
NEXT=value
`),
    {
      POMI_RADAR_GITHUB_APP_PRIVATE_KEY: 'QUJD',
      CI: '',
      NEXT: 'value',
    }
  );
});

test('existing process values take precedence over local values', () => {
  const environment = { NODE_ENV: 'test' };
  const loaded = mergeEnvironment(environment, {
    NODE_ENV: 'production',
    LOCAL_ONLY: 'loaded',
  });
  assert.equal(loaded.NODE_ENV, 'test');
  assert.equal(loaded.LOCAL_ONLY, 'loaded');
});

test('resolves credential paths from the repository root', () => {
  assert.equal(
    resolveRepositoryPath('config/secrets/example.json'),
    path.join(repositoryRoot, 'config/secrets/example.json')
  );
});

test('keeps development, automation, and release profiles separate', () => {
  const local = loadLocalEnvironment({
    environment: {},
    filePath: '.env.example',
  });
  const automation = loadAutomationEnvironment({
    environment: {},
    filePath: 'config/pomi-automation.example.env',
  });
  const release = loadReleaseEnvironment({
    environment: {},
    filePath: 'config/pomi-release.example.env',
  });

  assert.equal(local.POMI_RADAR_GITHUB_APP_ID, undefined);
  assert.equal(automation.POMI_RADAR_GITHUB_APP_ID, '4675891');
  assert.equal(automation.VITE_BACKEND_URL, undefined);
  assert.equal(release.VITE_USE_HTTPS, 'true');
  assert.equal(release.POMI_RADAR_GITHUB_APP_ID, undefined);
  assert.equal(
    resolveEnvironmentFile({ profile: 'automation' }),
    environmentFiles.automation
  );
});

test('requires generic callers to select an environment profile', () => {
  assert.throws(
    () => resolveEnvironmentFile(),
    /Pomi environment profile is required/
  );
});

test('keeps secret-bearing environment files out of Codex worktrees', () => {
  const includeFile = readFileSync(
    path.join(repositoryRoot, '.worktreeinclude'),
    'utf8'
  );
  assert.doesNotMatch(includeFile, /^\.env\.local$/m);
  assert.doesNotMatch(includeFile, /^config\/pomi-automation\.env$/m);
  assert.doesNotMatch(includeFile, /^config\/pomi-release\.env$/m);
  assert.doesNotMatch(includeFile, /^config\/secrets\/$/m);
  assert.ok(environmentFiles.automation.startsWith(primaryCheckoutRoot));
  assert.equal(
    resolveRepositoryPath('config/secrets/google-services.json'),
    path.join(primaryCheckoutRoot, 'config/secrets/google-services.json')
  );
});

test('refuses to print automation credentials as shell exports', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, 'scripts/local-env.mjs'),
      '--shell-exports',
      '--profile',
      'automation',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /cannot be exported to a shell/);
});
