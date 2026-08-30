import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const environmentPath = path.join(
  root,
  '.codex/environments/pomi-worktree.toml'
);
const setupScript = readFileSync(environmentPath, 'utf8').match(
  /\[setup\]\s*script = '''([\s\S]*?)'''/
)?.[1];
const dependencySetupScript = readFileSync(
  path.join(root, 'scripts/setup-development-environment.sh'),
  'utf8'
);
const cleanupScript = readFileSync(
  path.join(root, 'scripts/delete-worktree-environment.sh'),
  'utf8'
);

test('Codex worktree setup installs the minimal development dependencies', () => {
  assert.ok(setupScript, 'worktree setup script is missing');
  assert.match(
    setupScript,
    /cd "\$CODEX_WORKTREE_PATH"\s+\.\/scripts\/setup-development-environment\.sh --require-worktree/
  );
  assert.doesNotMatch(setupScript, /start-worktree-environment\.sh/);
  assert.equal(
    statSync(path.join(root, 'scripts/setup-development-environment.sh')).mode &
      0o111,
    0o111,
    'dependency setup must remain executable'
  );
  assert.match(dependencySetupScript, /--store-dir "\$ROOT_DIR\/\.pnpm-store"/);
  assert.match(cleanupScript, /"\$ROOT_DIR\/\.pnpm-store"/);
});

test('worktree setup can reuse the primary pnpm content-addressable store', () => {
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), 'pomi-worktree-environment-test-')
  );
  const modulesDirectory = path.join(temporaryRoot, 'node_modules');
  const storeDirectory = path.join(temporaryRoot, 'pnpm-store');
  mkdirSync(modulesDirectory);
  mkdirSync(storeDirectory);
  writeFileSync(
    path.join(modulesDirectory, '.modules.yaml'),
    JSON.stringify({ storeDir: storeDirectory })
  );

  try {
    const resolvedStore = execFileSync(
      'bash',
      [
        '-c',
        '. "$1" && pomi_node_modules_store_dir "$2"',
        'bash',
        path.join(root, 'scripts/worktree-lib.sh'),
        temporaryRoot,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(resolvedStore, storeDirectory);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
