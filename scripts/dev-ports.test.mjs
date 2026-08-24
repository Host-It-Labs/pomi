import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('uses an explicit HTTP backend URL for local Vite clients', async () => {
  const { getViteBackendUrl } = await import('./dev-ports.mjs');

  assert.equal(getViteBackendUrl(4321), 'http://localhost:4321');
});

test('writes dev ports atomically with private permissions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pomi-ports-test-'));
  const stateFile = path.join(directory, 'dev-ports.env');
  process.env.POMI_DEV_PORTS_FILE = stateFile;
  try {
    const { readDevPorts, writeDevPorts } = await import(
      `./dev-ports.mjs?atomic=${process.pid}`
    );
    writeDevPorts({ POMI_BACKEND_PORT: '4321' });

    assert.deepEqual(readDevPorts(), { POMI_BACKEND_PORT: '4321' });
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  } finally {
    delete process.env.POMI_DEV_PORTS_FILE;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test(
  'refuses a dev ports file replaced by a symlink',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pomi-ports-link-test-')
    );
    const stateFile = path.join(directory, 'dev-ports.env');
    const target = path.join(directory, 'target.env');
    fs.writeFileSync(stateFile, 'POMI_BACKEND_PORT=4321\n');
    fs.writeFileSync(target, 'POMI_BACKEND_PORT=9999\n');
    process.env.POMI_DEV_PORTS_FILE = stateFile;
    try {
      const { readDevPorts } = await import(
        `./dev-ports.mjs?symlink=${process.pid}`
      );
      fs.rmSync(stateFile);
      fs.symlinkSync(target, stateFile);

      assert.throws(() => readDevPorts(), /must remain a regular file/);
    } finally {
      delete process.env.POMI_DEV_PORTS_FILE;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
);
