import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporaryRoot = mkdtempSync(
  path.join(os.tmpdir(), 'pomi-public-snapshot-test-')
);
const snapshot = path.join(temporaryRoot, 'snapshot');

try {
  execFileSync(
    process.execPath,
    ['scripts/create-public-snapshot.mjs', snapshot],
    {
      cwd: root,
      env: {
        ...process.env,
        POMI_PUBLIC_GIT_EMAIL: 'pomi-public-test@example.invalid',
        POMI_PUBLIC_GIT_NAME: 'Pomi Snapshot Test',
      },
      stdio: 'inherit',
    }
  );

  const commitCount = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
    cwd: snapshot,
    encoding: 'utf8',
  }).trim();
  if (commitCount !== '1') {
    throw new Error(`Expected one snapshot commit, received ${commitCount}`);
  }

  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: snapshot,
    encoding: 'utf8',
  });
  if (status.trim()) throw new Error('Generated snapshot is not clean');

  execFileSync(
    'git',
    ['ls-files', '--error-unmatch', 'packages/frontend/src/vite-env.d.ts'],
    { cwd: snapshot, stdio: 'ignore' }
  );

  const license = readFileSync(path.join(snapshot, 'LICENSE'), 'utf8');
  if (!license.includes('PolyForm Noncommercial License 1.0.0')) {
    throw new Error('Generated snapshot does not contain the public license');
  }

  const executable = 'scripts/setup-development-environment.sh';
  const sourceMode = statSync(path.join(root, executable)).mode & 0o111;
  const snapshotMode = statSync(path.join(snapshot, executable)).mode & 0o111;
  if (sourceMode !== snapshotMode) {
    throw new Error('Generated snapshot did not preserve executable bits');
  }

  process.stdout.write('Public snapshot integration test passed.\n');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
