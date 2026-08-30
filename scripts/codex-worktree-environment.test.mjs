import assert from 'node:assert/strict';
import {
  existsSync,
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

import { pullRequestCompletionProblems } from './cleanup-worktree-after-pr.mjs';

const root = path.resolve(import.meta.dirname, '..');
const environmentConfig = readFileSync(
  path.join(root, '.codex/environments/pomi-worktree.toml'),
  'utf8'
);
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
const afterPrCleanupScript = readFileSync(
  path.join(root, 'scripts/cleanup-worktree-after-pr.sh'),
  'utf8'
);
const worktreeLibrary = readFileSync(
  path.join(root, 'scripts/worktree-lib.sh'),
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
  assert.match(cleanupScript, /pomi_remove_worktree_node_dependencies/);
  assert.match(
    environmentConfig,
    /name = "cleanup after completed PR"[\s\S]*command = "\.\/scripts\/cleanup-worktree-after-pr\.sh"/
  );
  assert.equal(
    statSync(path.join(root, 'scripts/cleanup-worktree-after-pr.sh')).mode &
      0o111,
    0o111,
    'PR completion cleanup must remain executable'
  );
  assert.match(afterPrCleanupScript, /--check-only/);
});

test('worktree setup can reuse the primary pnpm content-addressable store', () => {
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), 'pomi-worktree-environment-test-')
  );
  const modulesDirectory = path.join(temporaryRoot, 'node_modules');
  const storeDirectory = path.join(temporaryRoot, 'pnpm-store');
  mkdirSync(modulesDirectory);
  mkdirSync(storeDirectory);
  try {
    for (const metadata of [
      JSON.stringify({ storeDir: storeDirectory }),
      `storeDir: ${JSON.stringify(storeDirectory)}\n`,
    ]) {
      writeFileSync(path.join(modulesDirectory, '.modules.yaml'), metadata);

      const resolvedStore = execFileSync('bash', ['-s', temporaryRoot], {
        encoding: 'utf8',
        input: `${worktreeLibrary}\npomi_node_modules_store_dir "$1"\n`,
      });
      assert.equal(resolvedStore, storeDirectory);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('PR completion cleanup removes only worktree Node dependencies', () => {
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), 'pomi-worktree-cleanup-test-')
  );
  mkdirSync(path.join(temporaryRoot, 'node_modules'));
  mkdirSync(path.join(temporaryRoot, '.pnpm-store'));
  mkdirSync(path.join(temporaryRoot, 'packages/backend/node_modules'), {
    recursive: true,
  });
  mkdirSync(path.join(temporaryRoot, 'packages/frontend/node_modules'), {
    recursive: true,
  });
  mkdirSync(path.join(temporaryRoot, '.pomi'));
  mkdirSync(path.join(temporaryRoot, 'packages/backend/src'), {
    recursive: true,
  });

  try {
    execFileSync('bash', ['-s', temporaryRoot], {
      encoding: 'utf8',
      input: `${worktreeLibrary}\npomi_remove_worktree_node_dependencies "$1"\n`,
    });
    assert.equal(existsSync(path.join(temporaryRoot, 'node_modules')), false);
    assert.equal(existsSync(path.join(temporaryRoot, '.pnpm-store')), false);
    assert.equal(
      existsSync(path.join(temporaryRoot, 'packages/backend/node_modules')),
      false
    );
    assert.equal(
      existsSync(path.join(temporaryRoot, 'packages/frontend/node_modules')),
      false
    );
    assert.equal(existsSync(path.join(temporaryRoot, '.pomi')), true);
    assert.equal(
      existsSync(path.join(temporaryRoot, 'packages/backend/src')),
      true
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('PR completion gate requires green checks and processed automatic reviews', () => {
  const localHead = 'a'.repeat(40);
  const summary = [
    '<!-- codex-pull-request-review-summary -->',
    '| 📝 **Code Review** | ✅ **Completed** |',
    '| 🔒 **Security Review** | ✅ **Completed** |',
  ].join('\n');
  const pullRequest = {
    state: 'OPEN',
    isDraft: false,
    headRefName: 'dev/example',
    headRefOid: localHead,
    statusCheckRollup: [
      { name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'CodeQL', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
  };

  assert.deepEqual(
    pullRequestCompletionProblems({
      pullRequest,
      localBranch: 'dev/example',
      localHead,
      comments: [{ body: summary }],
      reviewThreads: [
        {
          isResolved: true,
          comments: {
            nodes: [{ author: { login: 'github-advanced-security[bot]' } }],
          },
        },
        {
          isResolved: false,
          comments: {
            nodes: [
              { author: { login: 'chatgpt-codex-connector' } },
              { author: { login: 'NeoHuncho' } },
            ],
          },
        },
      ],
    }),
    []
  );

  const blocked = pullRequestCompletionProblems({
    pullRequest: {
      ...pullRequest,
      statusCheckRollup: [
        { name: 'tests', status: 'IN_PROGRESS', conclusion: null },
      ],
    },
    localBranch: 'dev/example',
    localHead,
    comments: [{ body: summary.replace('Security Review', 'Pending Review') }],
    reviewThreads: [
      {
        isResolved: false,
        comments: {
          nodes: [{ author: { login: 'chatgpt-codex-connector' } }],
        },
      },
    ],
  });
  assert.ok(
    blocked.some(problem => problem.includes('tests is not completed'))
  );
  assert.ok(blocked.some(problem => problem.includes('Security Review')));
  assert.ok(
    blocked.some(problem => problem.includes('automatic review thread'))
  );
});
