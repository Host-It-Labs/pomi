import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCiChecks,
  classifyCodexReview,
  createGitAncestorCheck,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  evaluatePullRequestReadiness,
  flattenReactionPages,
  githubCommandError,
  inspectWithGitHubApp,
  RetryableGitHubError,
  unprocessedReviewThreads,
  waitForPullRequestReadiness,
} from './pr-readiness.mjs';

const head = 'b'.repeat(40);
const reviewedAncestor = 'a'.repeat(40);

function pullRequest(overrides = {}) {
  return {
    number: 253,
    state: 'OPEN',
    isDraft: false,
    headRefName: 'dev/example',
    headRefOid: head,
    statusCheckRollup: [
      { name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'CodeQL', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      { name: 'optional', status: 'COMPLETED', conclusion: 'SKIPPED' },
    ],
    reviews: [
      {
        author: { login: 'chatgpt-codex-connector' },
        state: 'COMMENTED',
        commit: { oid: reviewedAncestor },
      },
    ],
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluatePullRequestReadiness({
    pullRequest: pullRequest(),
    reviewThreads: [],
    reactions: [],
    commits: [],
    localBranch: 'dev/example',
    localHead: head,
    dirtyPaths: [],
    isAncestor: async ancestor => ancestor === reviewedAncestor,
    ...overrides,
  });
}

test('accepts a Codex review of the current head or an ancestor', async () => {
  assert.equal((await evaluate()).status, 'ready');
  assert.equal(
    (
      await evaluate({
        pullRequest: pullRequest({
          reviews: [
            {
              author: { login: 'chatgpt-codex-connector' },
              state: 'COMMENTED',
              commit: { oid: head },
            },
          ],
        }),
        isAncestor: async ancestor => ancestor === head,
      })
    ).status,
    'ready'
  );
});

test('accepts the Codex no-findings thumbs-up outcome', async () => {
  const review = await classifyCodexReview({
    reviews: [],
    reactions: [
      {
        user: { login: 'chatgpt-codex-connector[bot]' },
        content: '+1',
        created_at: '2026-09-04T10:00:00Z',
      },
    ],
    commits: [
      {
        sha: reviewedAncestor,
        commit: { committer: { date: '2026-09-04T09:59:00Z' } },
      },
    ],
    head,
    isAncestor: async ancestor => ancestor === reviewedAncestor,
  });
  assert.equal(review.status, 'ready');
});

test('rejects a no-findings reaction that cannot apply to a head ancestor', async () => {
  const review = await classifyCodexReview({
    reviews: [],
    reactions: [
      {
        user: { login: 'chatgpt-codex-connector[bot]' },
        content: '+1',
        created_at: '2026-09-04T10:00:00Z',
      },
    ],
    commits: [
      {
        sha: reviewedAncestor,
        commit: { committer: { date: '2026-09-04T10:01:00Z' } },
      },
    ],
    head,
    isAncestor: async () => false,
  });
  assert.equal(review.status, 'action-required');
});

test('combines every paginated reaction page', () => {
  assert.deepEqual(
    flattenReactionPages([
      [{ id: 1, content: '+1' }],
      [{ id: 2, content: 'eyes' }],
    ]),
    [
      { id: 1, content: '+1' },
      { id: 2, content: 'eyes' },
    ]
  );
});

test('rejects a Codex review unrelated to the current head', async () => {
  const result = await evaluate({ isAncestor: async () => false });
  assert.equal(result.status, 'action-required');
  assert.match(result.problems[0], /not associated with an ancestor/);
});

test('preserves a nonzero git ancestry result', async () => {
  assert.equal(
    await createGitAncestorCheck(process.cwd())('0'.repeat(40), head),
    false
  );
});

test('distinguishes pending and failed current-head CI', () => {
  assert.deepEqual(classifyCiChecks([]).status, 'pending');
  assert.deepEqual(
    classifyCiChecks([
      { name: 'tests', status: 'IN_PROGRESS', conclusion: null },
    ]).status,
    'pending'
  );
  assert.deepEqual(
    classifyCiChecks([
      { name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' },
    ]).status,
    'action-required'
  );
  assert.equal(
    classifyCiChecks([{ context: 'legacy', state: 'SUCCESS' }]).status,
    'ready'
  );
  assert.equal(
    classifyCiChecks([{ context: 'legacy', state: 'PENDING' }]).status,
    'pending'
  );
  assert.equal(
    classifyCiChecks([{ context: 'legacy', state: 'FAILURE' }]).status,
    'action-required'
  );
});

test('requires every review thread to be resolved or dispositioned', () => {
  assert.equal(
    unprocessedReviewThreads([
      { isResolved: true, comments: { nodes: [] } },
      {
        isResolved: false,
        comments: {
          nodes: [
            {
              author: { login: 'pomi-radar[bot]' },
              body: '<!-- pomi-review-disposition:v1 {"version":1,"outcome":"contradicts-request","requiresUserCheck":true} -->',
            },
          ],
        },
      },
    ]).length,
    0
  );
  assert.equal(
    unprocessedReviewThreads([
      {
        isResolved: false,
        comments: { nodes: [{ body: 'I will investigate.' }] },
      },
    ]).length,
    1
  );
});

test('rejects a mismatched head, branch, draft, or dirty worktree', async () => {
  const result = await evaluate({
    pullRequest: pullRequest({ isDraft: true }),
    localBranch: 'another-branch',
    localHead: 'c'.repeat(40),
    dirtyPaths: ['changed.txt'],
  });
  assert.equal(result.status, 'action-required');
  assert.equal(result.problems.length, 4);
});

test('waits every 60 seconds and times out exactly after 30 minutes', async () => {
  assert.equal(DEFAULT_POLL_INTERVAL_MS, 60_000);
  assert.equal(DEFAULT_TIMEOUT_MS, 1_800_000);
  let currentTime = 0;
  const sleeps = [];
  const result = await waitForPullRequestReadiness({
    inspect: async () => ({ status: 'pending', problems: ['waiting'] }),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    now: () => currentTime,
    sleep: async milliseconds => {
      sleeps.push(milliseconds);
      currentTime += milliseconds;
    },
    onPending: () => {},
  });
  assert.equal(result.status, 'timed-out');
  assert.equal(sleeps.length, 30);
  assert.ok(sleeps.every(milliseconds => milliseconds === 60_000));
  assert.equal(currentTime, 1_800_000);
});

test('returns immediately for action-required and after readiness arrives', async () => {
  let inspections = 0;
  const ready = await waitForPullRequestReadiness({
    inspect: async () => {
      inspections += 1;
      return inspections === 1
        ? { status: 'pending', problems: ['waiting'] }
        : { status: 'ready', problems: [] };
    },
    timeoutMs: 180_000,
    pollIntervalMs: 60_000,
    now: () => (inspections - 1) * 60_000,
    sleep: async () => {},
    onPending: () => {},
  });
  assert.equal(ready.status, 'ready');
  assert.equal(inspections, 2);

  inspections = 0;
  const action = await waitForPullRequestReadiness({
    inspect: async () => {
      inspections += 1;
      return { status: 'action-required', problems: ['failed'] };
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    now: () => 0,
    sleep: async () => {},
    onPending: () => {},
  });
  assert.equal(action.status, 'action-required');
  assert.equal(inspections, 1);
});

test('wait survives transient inspection failures and reports only changes', async () => {
  let currentTime = 0;
  const unavailable = githubCommandError({
    stderr: 'getaddrinfo ENOTFOUND api.github.com',
  });
  const snapshots = [
    unavailable,
    unavailable,
    { status: 'pending', problems: ['tests running'] },
    { status: 'pending', problems: ['tests running'] },
    { status: 'ready', problems: [] },
  ];
  const reports = [];
  const sleeps = [];
  const result = await waitForPullRequestReadiness({
    inspect: async () => {
      const snapshot = snapshots.shift();
      if (snapshot instanceof Error) throw snapshot;
      return snapshot;
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    now: () => currentTime,
    sleep: async milliseconds => {
      sleeps.push(milliseconds);
      currentTime += milliseconds;
    },
    onPending: result => reports.push(result),
  });
  assert.equal(result.status, 'ready');
  assert.equal(currentTime, 240_000);
  assert.deepEqual(sleeps, [60_000, 60_000, 60_000, 60_000]);
  assert.equal(reports.length, 2);
});

test('persistent network failures exhaust the original wait budget instead of exiting early', async () => {
  let currentTime = 0;
  let attempts = 0;
  const reports = [];
  const result = await waitForPullRequestReadiness({
    inspect: async () => {
      attempts += 1;
      currentTime += 10_000;
      throw githubCommandError({ stderr: 'UND_ERR_CONNECT_TIMEOUT' });
    },
    timeoutMs: 150_000,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    now: () => currentTime,
    sleep: async milliseconds => {
      currentTime += milliseconds;
    },
    onPending: result => reports.push(result),
  });
  assert.equal(result.status, 'timed-out');
  assert.equal(attempts, 3);
  assert.equal(currentTime, 150_000);
  assert.equal(reports.length, 1);
});

test('retries transport and temporary API errors without echoing diagnostics', () => {
  for (const stderr of [
    'ENOTFOUND',
    'error connecting to api.github.com',
    'HTTP 502',
    'HTTP 503',
    'HTTP 429',
    'API rate limit exceeded',
    'unexpected EOF',
    'GitHub is temporarily unavailable',
  ]) {
    const error = githubCommandError({
      stderr: `${stderr}: sensitive-diagnostic`,
    });
    assert.ok(error instanceof RetryableGitHubError);
    assert.doesNotMatch(error.message, /sensitive-diagnostic/);
  }
  assert.ok(
    githubCommandError({ error: { code: 'ETIMEDOUT' } }) instanceof
      RetryableGitHubError
  );
});

test('does not retry authentication, permissions, missing tools, or malformed configuration', async () => {
  for (const stderr of [
    'HTTP 401: Bad credentials',
    'HTTP 403: Resource not accessible by integration',
    'HTTP 404: Not Found',
    'GitHub App private key is missing',
  ]) {
    const error = githubCommandError({ stderr });
    assert.ok(!(error instanceof RetryableGitHubError));
    let sleeps = 0;
    await assert.rejects(
      waitForPullRequestReadiness({
        inspect: async () => {
          throw error;
        },
        timeoutMs: DEFAULT_TIMEOUT_MS,
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
        now: () => 0,
        sleep: async () => {
          sleeps += 1;
        },
        onPending: () => {},
      }),
      error
    );
    assert.equal(sleeps, 0);
  }
  assert.ok(
    !(
      githubCommandError({ error: { code: 'ENOENT' } }) instanceof
      RetryableGitHubError
    )
  );
});

test('App inspection authenticates inside each poll and preserves readiness outcomes', () => {
  for (const [status, outcome] of [
    [0, 'ready'],
    [2, 'action-required'],
    [3, 'pending'],
  ]) {
    const result = inspectWithGitHubApp(
      { root: process.cwd(), pullRequestNumber: 256 },
      (command, args, cwd, options) => {
        assert.equal(command, process.execPath);
        assert.ok(args[0].endsWith('github-app-auth.mjs'));
        assert.deepEqual(args.slice(1, 4), ['exec', '--', 'node']);
        assert.deepEqual(args.slice(5), ['check', '--json', '--pr', '256']);
        assert.equal(cwd, process.cwd());
        assert.equal(options.githubApp, true);
        return {
          status,
          output: JSON.stringify({ status: outcome, problems: [] }),
        };
      }
    );
    assert.equal(result.status, outcome);
  }
  assert.throws(
    () =>
      inspectWithGitHubApp({}, () => ({
        status: 1,
        stderr: 'ENOTFOUND api.github.com',
      })),
    RetryableGitHubError
  );
  assert.throws(
    () => inspectWithGitHubApp({}, () => ({ status: 0, output: 'not-json' })),
    /valid JSON/
  );
});
