import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCiChecks,
  classifyCodexReview,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  evaluatePullRequestReadiness,
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
      },
    ],
    head,
    isAncestor: async () => false,
  });
  assert.equal(review.status, 'ready');
});

test('rejects a Codex review unrelated to the current head', async () => {
  const result = await evaluate({ isAncestor: async () => false });
  assert.equal(result.status, 'action-required');
  assert.match(result.problems[0], /not an ancestor/);
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
  });
  assert.equal(ready.status, 'ready');
  assert.equal(inspections, 2);

  inspections = 0;
  const action = await waitForPullRequestReadiness({
    inspect: async () => {
      inspections += 1;
      return { status: 'action-required', problems: ['failed'] };
    },
  });
  assert.equal(action.status, 'action-required');
  assert.equal(inspections, 1);
});
