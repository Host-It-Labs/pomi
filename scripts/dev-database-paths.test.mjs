import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('reset and worktree cleanup target the current Compose database directory', () => {
  const compose = read('packages/backend/docker-compose.dev.yml');
  const reset = read('scripts/reset-dev-db-fixtures.mjs');
  const cleanup = read('scripts/delete-worktree-environment.sh');

  const composeDirectory = compose.match(
    /- \.\/([^/:]+):\/var\/lib\/postgresql(?:\/data)?/
  )?.[1];
  const resetDirectory = reset.match(
    /const defaultPgdataDir = path\.join\(backendRoot, '([^']+)'\)/
  )?.[1];

  assert.ok(composeDirectory, 'Compose database directory must be detectable');
  assert.equal(resetDirectory, composeDirectory);
  assert.ok(
    cleanup.includes(`"$ROOT_DIR/packages/backend/${composeDirectory}"`)
  );
});
