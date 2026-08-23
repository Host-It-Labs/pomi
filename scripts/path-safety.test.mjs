import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  resolveContainedPath,
  resolveManagedDirectory,
  resolveSafeNewDirectory,
  resolveSafeStateFile,
} from './path-safety.mjs';

function withTemporaryDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pomi-path-test-'));
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('keeps relative destinations inside their canonical root', () => {
  withTemporaryDirectory(directory => {
    assert.equal(
      resolveContainedPath({
        root: directory,
        relativePath: 'nested/file.txt',
        label: 'Test destination',
      }),
      path.join(fs.realpathSync.native(directory), 'nested/file.txt')
    );
    assert.throws(
      () =>
        resolveContainedPath({
          root: directory,
          relativePath: '../escape.txt',
          label: 'Test destination',
        }),
      /escapes/
    );
  });
});

test('rejects unsafe state files and snapshot destinations', () => {
  withTemporaryDirectory(directory => {
    const stateRoot = path.join(directory, 'state');
    fs.mkdirSync(stateRoot);
    assert.equal(
      resolveSafeStateFile({
        candidate: path.join(stateRoot, 'dev-ports.env'),
        allowedRoots: [stateRoot],
        label: 'Dev ports file',
      }),
      path.join(fs.realpathSync.native(stateRoot), 'dev-ports.env')
    );
    assert.throws(
      () =>
        resolveSafeStateFile({
          candidate: path.join(directory, 'outside.env'),
          allowedRoots: [stateRoot],
          label: 'Dev ports file',
        }),
      /Pomi state directory/
    );
    assert.throws(
      () =>
        resolveSafeNewDirectory({
          candidate: path.join(stateRoot, 'snapshot'),
          forbiddenTrees: [directory],
          label: 'Snapshot output',
        }),
      /must be outside/
    );
  });
});

test('requires a persistent sentinel for a custom managed directory', () => {
  withTemporaryDirectory(directory => {
    const canonicalDirectory = fs.realpathSync.native(directory);
    const trusted = path.join(canonicalDirectory, 'pgdata');
    const custom = path.join(canonicalDirectory, 'custom-pgdata');
    assert.equal(
      resolveManagedDirectory({
        allowedRoot: directory,
        candidate: trusted,
        label: 'Dev database data',
        sentinelName: 'pomi-managed-dev-db',
        trustedDirectory: trusted,
      }),
      trusted
    );
    assert.throws(
      () =>
        resolveManagedDirectory({
          allowedRoot: directory,
          candidate: custom,
          label: 'Dev database data',
          sentinelName: 'pomi-managed-dev-db',
          trustedDirectory: trusted,
        }),
      /requires the sentinel/
    );
    fs.writeFileSync(
      path.join(canonicalDirectory, '.custom-pgdata.pomi-managed-dev-db'),
      ''
    );
    assert.equal(
      resolveManagedDirectory({
        allowedRoot: directory,
        candidate: custom,
        label: 'Dev database data',
        sentinelName: 'pomi-managed-dev-db',
        trustedDirectory: trusted,
      }),
      custom
    );
  });
});

test(
  'rejects symlink escapes from a contained root',
  { skip: process.platform === 'win32' },
  () => {
    withTemporaryDirectory(directory => {
      const root = path.join(directory, 'root');
      const outside = path.join(directory, 'outside');
      fs.mkdirSync(root);
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(root, 'link'));

      assert.throws(
        () =>
          resolveContainedPath({
            root,
            relativePath: 'link/file.txt',
            label: 'Test destination',
          }),
        /escapes/
      );
    });
  }
);

test(
  'treats a dangling symlink as an existing unsafe destination',
  { skip: process.platform === 'win32' },
  () => {
    withTemporaryDirectory(directory => {
      const destination = path.join(directory, 'snapshot');
      fs.symlinkSync(path.join(directory, 'missing-target'), destination);

      assert.throws(
        () =>
          resolveSafeNewDirectory({
            candidate: destination,
            forbiddenTrees: [],
            label: 'Snapshot destination',
          }),
        /already exists/
      );
    });
  }
);

test(
  'rejects a trusted managed directory replaced by a symlink',
  { skip: process.platform === 'win32' },
  () => {
    withTemporaryDirectory(directory => {
      const backend = path.join(directory, 'backend');
      const outside = path.join(directory, 'outside');
      const trusted = path.join(backend, 'pgdata');
      fs.mkdirSync(backend);
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, trusted);

      assert.throws(
        () =>
          resolveManagedDirectory({
            allowedRoot: backend,
            candidate: trusted,
            label: 'Dev database data',
            sentinelName: 'pomi-managed-dev-db',
            trustedDirectory: trusted,
          }),
        /must be a real directory, not a link or file/
      );
    });
  }
);
