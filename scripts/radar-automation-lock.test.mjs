import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireLock,
  readLockOwner,
  recoverLock,
  releaseLock,
} from './radar-automation-lock.mjs';

function withTemporaryDirectory(run) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pomi-radar-lock-test-')
  );
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('serializes owners for one worktree and releases the matching owner', () => {
  withTemporaryDirectory(cwd => {
    const acquired = acquireLock({
      cwd,
      track: 'feature-bug',
      stage: 'parent',
    });
    assert.equal(acquired.acquired, true);
    assert.deepEqual(readLockOwner(cwd), acquired.owner);

    const blocked = acquireLock({ cwd, track: 'feature-bug', stage: 'child' });
    assert.equal(blocked.acquired, false);
    assert.deepEqual(blocked.owner, acquired.owner);

    assert.throws(
      () => releaseLock({ cwd, track: 'feature-bug', stage: 'child' }),
      /belongs to feature-bug\/parent/
    );
    releaseLock({ cwd, track: 'feature-bug', stage: 'parent' });
    assert.equal(readLockOwner(cwd), null);
  });
});

test('does not allow recovery without explicit confirmation', () => {
  withTemporaryDirectory(cwd => {
    acquireLock({ cwd, track: 'security', stage: 'child' });
    assert.throws(
      () =>
        recoverLock({ cwd, track: 'security', stage: 'child', confirm: false }),
      /requires --confirm/
    );
    recoverLock({ cwd, track: 'security', stage: 'child', confirm: true });
    assert.equal(readLockOwner(cwd), null);
  });
});

test('rejects invalid owner metadata instead of taking over the lock', () => {
  withTemporaryDirectory(cwd => {
    const lockDirectory = path.join(cwd, '.pomi', 'radar-automation-lock');
    fs.mkdirSync(lockDirectory, { recursive: true });
    fs.writeFileSync(path.join(lockDirectory, 'owner.json'), '{not-json');
    assert.throws(
      () => acquireLock({ cwd, track: 'performance', stage: 'parent' }),
      /owner metadata is invalid/
    );
  });
});
