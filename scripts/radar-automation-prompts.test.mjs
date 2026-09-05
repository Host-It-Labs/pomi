import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const promptDefinitions = [
  {
    id: 'feature-bug-parent',
    file: 'docs/agents/automations/feature-bug-parent.md',
    branch: 'daily-feature',
    track: 'feature-bug',
    stage: 'parent',
  },
  {
    id: 'feature-bug-child',
    file: 'docs/agents/automations/feature-bug.md',
    branch: 'daily-feature',
    track: 'feature-bug',
    stage: 'child',
  },
  {
    id: 'performance-parent',
    file: 'docs/agents/automations/performance-parent.md',
    branch: 'pomi-daily-performance',
    track: 'performance',
    stage: 'parent',
  },
  {
    id: 'performance-child',
    file: 'docs/agents/automations/performance.md',
    branch: 'pomi-daily-performance',
    track: 'performance',
    stage: 'child',
  },
  {
    id: 'security-parent',
    file: 'docs/agents/automations/security-parent.md',
    branch: 'pomi-daily-security',
    track: 'security',
    stage: 'parent',
  },
  {
    id: 'security-child',
    file: 'docs/agents/automations/security.md',
    branch: 'pomi-daily-security',
    track: 'security',
    stage: 'child',
  },
];

for (const definition of promptDefinitions) {
  test(`${definition.id} synchronizes before reading lifecycle files`, () => {
    const prompt = fs.readFileSync(
      path.join(repositoryRoot, definition.file),
      'utf8'
    );
    const startupIndex = prompt.indexOf(
      'The first phase of every run is startup synchronization'
    );
    const acquireIndex = prompt.indexOf(
      `node scripts/radar-automation-lock.mjs acquire --track ${definition.track} --stage ${definition.stage}`
    );
    const remoteIndex = prompt.indexOf(
      `fetch the remote \`${definition.branch}\` branch and \`origin/main\``
    );
    const lifecycleIndex = prompt.indexOf('read `AGENTS.md`');

    assert.notEqual(startupIndex, -1);
    assert.notEqual(acquireIndex, -1);
    assert.notEqual(remoteIndex, -1);
    assert.notEqual(lifecycleIndex, -1);
    assert.match(prompt, /ignore only macOS `\.DS_Store` entries/);
    assert.match(prompt, /run `git merge --abort`/);
    assert.match(prompt, /bounded exception to the initial repository-policy read/);
    assert.ok(startupIndex < acquireIndex);
    assert.ok(acquireIndex < remoteIndex);
    assert.ok(remoteIndex < lifecycleIndex);
  });
}
