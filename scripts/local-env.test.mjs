import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  loadLocalEnvironment,
  parseEnvironmentFile,
  repositoryRoot,
  resolveRepositoryPath,
} from './local-env.mjs';

test('parses comments, exports, quotes, and embedded equals signs', () => {
  assert.deepEqual(
    parseEnvironmentFile(`
# comment
PLAIN=value
export QUOTED="hello world"
TOKEN=part=two
INVALID LINE
`),
    { PLAIN: 'value', QUOTED: 'hello world', TOKEN: 'part=two' }
  );
});

test('existing process values take precedence over local values', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pomi-local-env-'));
  const file = path.join(directory, '.env.local');
  writeFileSync(file, 'NODE_ENV=production\nLOCAL_ONLY=loaded\n');
  const environment = { NODE_ENV: 'test' };
  const loaded = loadLocalEnvironment({ environment, file });
  assert.equal(loaded.NODE_ENV, 'test');
  assert.equal(loaded.LOCAL_ONLY, 'loaded');
});

test('resolves credential paths from the repository root', () => {
  assert.equal(
    resolveRepositoryPath('config/secrets/example.json'),
    path.join(repositoryRoot, 'config/secrets/example.json')
  );
});

test('documents the ignored files copied into Codex worktrees', () => {
  const includeFile = readFileSync(
    path.join(repositoryRoot, '.worktreeinclude'),
    'utf8'
  );
  assert.match(includeFile, /^\.env\.local$/m);
  assert.match(includeFile, /^config\/secrets\/$/m);
});
