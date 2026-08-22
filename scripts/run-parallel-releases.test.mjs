import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const runner = path.resolve('scripts/run-parallel-releases.sh');

function runWithFailure(failingCommand) {
  const binDirectory = mkdtempSync(
    path.join(os.tmpdir(), 'pomi-release-test-')
  );
  const pnpm = path.join(binDirectory, 'pnpm');
  writeFileSync(
    pnpm,
    '#!/usr/bin/env bash\n[[ "$2" == "$POMI_FAIL_RELEASE" ]] && exit 7\nexit 0\n'
  );
  chmodSync(pnpm, 0o755);
  return spawnSync(runner, ['apps'], {
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      POMI_FAIL_RELEASE: failingCommand,
    },
    encoding: 'utf8',
  });
}

function runAll({ failingCommand = '', logFile }) {
  const binDirectory = mkdtempSync(
    path.join(os.tmpdir(), 'pomi-release-test-')
  );
  const pnpm = path.join(binDirectory, 'pnpm');
  writeFileSync(
    pnpm,
    '#!/usr/bin/env bash\nprintf "%s\\n" "$2" >> "$POMI_RELEASE_LOG"\n[[ "$2" == "$POMI_FAIL_RELEASE" ]] && exit 7\nexit 0\n'
  );
  chmodSync(pnpm, 0o755);
  return spawnSync(runner, ['all'], {
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      POMI_FAIL_RELEASE: failingCommand,
      POMI_RELEASE_LOG: logFile,
    },
    encoding: 'utf8',
  });
}

test('parallel release runner propagates either child failure', () => {
  for (const command of ['release:android', 'release:macos']) {
    const result = runWithFailure(command);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${command} failed`));
  }
});

test('all mode publishes Docker only after both app builds succeed', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pomi-release-log-'));
  const logFile = path.join(directory, 'commands.log');
  const result = runAll({ logFile });
  assert.equal(result.status, 0);
  const commands = readFileSync(logFile, 'utf8').trim().split('\n');
  assert.deepEqual(
    new Set(commands.slice(0, 2)),
    new Set(['release:android', 'release:macos'])
  );
  assert.equal(commands[2], 'release:docker');
});

test('all mode does not publish Docker when an app build fails', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pomi-release-log-'));
  const logFile = path.join(directory, 'commands.log');
  const result = runAll({
    failingCommand: 'release:android',
    logFile,
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(readFileSync(logFile, 'utf8'), /release:docker/);
});
