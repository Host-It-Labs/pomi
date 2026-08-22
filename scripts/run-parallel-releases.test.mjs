import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const runner = path.resolve('scripts/run-parallel-releases.sh');

function runWithFailure(failingCommand) {
  const binDirectory = mkdtempSync(path.join(os.tmpdir(), 'pomi-release-test-'));
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

test('parallel release runner propagates either child failure', () => {
  for (const command of ['release:android', 'release:macos']) {
    const result = runWithFailure(command);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${command} failed`));
  }
});
