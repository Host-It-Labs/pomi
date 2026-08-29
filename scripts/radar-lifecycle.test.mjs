import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  acknowledgeAgentPass,
  alreadyImplementedVerification,
  classifyMatch,
  consolidationMerged,
  dailyFeatureSlotPlan,
  deduplicationPlan,
  enrichIssue,
  evidenceDelta,
  issueEnrichmentGaps,
  marker,
  markAlreadyImplemented,
  nextLifecycleLabels,
  planClarification,
  preflightHasWork,
  proposalSlotPlan,
  radarIssueMetadata,
  readableTitleProblems,
  readMarker,
  reconcileDuplicate,
  reconcileConsolidation,
  releaseReadyIssues,
  resolveSentryGroup,
  selectActionableIssues,
  selectEnrichmentIssues,
  selectUntriagedFeedbackIssues,
  selectCanonical,
  validateAutomationAuthentication,
  validateConsolidationManifest,
} from './radar-lifecycle.mjs';

function consolidationEvent(overrides = {}) {
  return {
    pull_request: {
      number: 99,
      user: { login: 'pomi-radar[bot]' },
      base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
      head: {
        ref: 'radar/consolidation-test',
        repo: { full_name: 'Host-It-Labs/pomi' },
      },
      body: '<!-- pomi-radar-consolidation:v1 {"issues":[33],"sourcePrs":[44]} -->',
      merge_commit_sha: 'a'.repeat(40),
      merged: true,
      ...overrides,
    },
  };
}

function inReviewRadarIssue(overrides = {}) {
  return {
    number: 33,
    title: 'Test Radar issue',
    state: 'open',
    created_at: '2026-08-22T00:00:00Z',
    labels: [{ name: 'radar:bug' }, { name: 'radar:in-review' }],
    body: '<!-- pomi-radar:v1 {"source":"feedback"} -->',
    ...overrides,
  };
}

test('preflight authentication fails closed without the App wrapper', async () => {
  await assert.rejects(
    validateAutomationAuthentication({ environment: {} }),
    /requires GitHub App authentication/
  );
});

test('preflight verifies bot attribution and Git identity', async () => {
  const result = await validateAutomationAuthentication({
    environment: {
      GITHUB_TOKEN: 'app-token',
      POMI_GITHUB_APP_ID: '4675891',
      POMI_GITHUB_APP_BOT_LOGIN: 'pomi-radar[bot]',
      POMI_GITHUB_APP_PERMISSIONS:
        '{"contents":"write","issues":"write","pull_requests":"write"}',
      GIT_AUTHOR_NAME: 'Pomi Radar Bot',
      GIT_AUTHOR_EMAIL: '123+pomi-radar[bot]@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'Pomi Radar Bot',
      GIT_COMMITTER_EMAIL: '123+pomi-radar[bot]@users.noreply.github.com',
    },
    fetchImpl: async url => {
      assert.equal(url, 'https://api.github.com/repos/Host-It-Labs/pomi');
      return new globalThis.Response(
        JSON.stringify({
          full_name: 'Host-It-Labs/pomi',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    },
  });
  assert.deepEqual(result, {
    botLogin: 'pomi-radar[bot]',
    gitIdentityVerified: true,
  });
});

test('preflight rejects an authenticated App other than Pomi Radar', async () => {
  await assert.rejects(
    validateAutomationAuthentication({
      environment: {
        GITHUB_TOKEN: 'app-token',
        POMI_GITHUB_APP_ID: '1234',
        POMI_GITHUB_APP_BOT_LOGIN: 'another-app[bot]',
        POMI_GITHUB_APP_PERMISSIONS:
          '{"contents":"write","issues":"write","pull_requests":"write"}',
        GIT_AUTHOR_NAME: 'Another App Bot',
        GIT_AUTHOR_EMAIL: '123+another-app[bot]@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'Another App Bot',
        GIT_COMMITTER_EMAIL: '123+another-app[bot]@users.noreply.github.com',
      },
      fetchImpl: async () => {
        throw new Error('must reject before requesting repository access');
      },
    }),
    /must use Pomi Radar/
  );
});

test('consolidation manifests require bot authorship and eligible Radar issues', () => {
  assert.deepEqual(
    validateConsolidationManifest(consolidationEvent(), [inReviewRadarIssue()])
      .issueNumbers,
    [33]
  );
  assert.throws(
    () =>
      validateConsolidationManifest(
        consolidationEvent({ user: { login: 'contributor' } }),
        [inReviewRadarIssue()]
      ),
    /must be authored by the Radar bot/
  );
  assert.throws(
    () =>
      validateConsolidationManifest(consolidationEvent(), [
        inReviewRadarIssue({
          labels: [{ name: 'radar:bug' }, { name: 'radar:rejected' }],
        }),
      ]),
    /not an eligible in-review Radar issue/
  );
});

test('legacy squash consolidations require a reviewed tree and close only contained open sources', async () => {
  const reviewedHeadSha = 'b'.repeat(40);
  const event = consolidationEvent({
    user: { login: 'NeoHuncho' },
    head: {
      ref: 'radar/consolidation-test',
      repo: { full_name: 'Host-It-Labs/pomi' },
      sha: reviewedHeadSha,
    },
    body: marker('pomi-radar-consolidation:v1', {
      version: 1,
      issues: [33],
      sourcePrs: [44, 45],
    }),
  });
  const sourcePulls = [
    {
      number: 44,
      state: 'open',
      user: { login: 'contributor' },
      body: marker('pomi-radar-source:v1', {
        version: 1,
        track: 'feature',
        issues: [33],
      }),
      base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
      head: {
        sha: 'c'.repeat(40),
        repo: { full_name: 'Host-It-Labs/pomi' },
      },
    },
    {
      number: 45,
      state: 'open',
      user: { login: 'contributor' },
      body: 'Explicitly listed maintenance source',
      base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
      head: {
        sha: 'd'.repeat(40),
        repo: { full_name: 'Host-It-Labs/pomi' },
      },
    },
  ];
  await withFakeConsolidationGithub(
    {
      event,
      issue: {
        number: 33,
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:accepted' }],
      },
      sourcePulls,
      comparisonStatus: 'ahead',
      commitTreeSha: 'e'.repeat(40),
    },
    async (state, currentEvent) => {
      const result = await consolidationMerged(currentEvent, {
        allowLegacy: true,
      });
      assert.deepEqual(result.sourcePullRequests, {
        closed: [44, 45],
        alreadyClosed: [],
      });
      assert.equal(state.pulls.get(44).state, 'closed');
      assert.equal(state.pulls.get(45).state, 'closed');
      assert.deepEqual(
        state.issues.get(33).labels.map(label => label.name),
        ['radar:feature', 'radar:ready-for-release']
      );
    }
  );
});

test('legacy reconciliation counts issues from already-closed marked sources', async () => {
  const event = consolidationEvent({
    user: { login: 'NeoHuncho' },
    head: {
      ref: 'radar/consolidation-test',
      repo: { full_name: 'Host-It-Labs/pomi' },
      sha: 'b'.repeat(40),
    },
    body: marker('pomi-radar-consolidation:v1', {
      version: 1,
      issues: [33],
      sourcePrs: [44],
    }),
  });
  const sourcePulls = [
    {
      number: 44,
      state: 'closed',
      user: { login: 'contributor' },
      body: marker('pomi-radar-source:v1', {
        version: 1,
        track: 'feature',
        issues: [33],
      }),
      base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
      head: {
        sha: 'c'.repeat(40),
        repo: { full_name: 'Host-It-Labs/pomi' },
      },
    },
  ];
  await withFakeConsolidationGithub(
    {
      event,
      issue: {
        number: 33,
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:accepted' }],
      },
      sourcePulls,
      comparisonStatus: 'diverged',
      commitTreeSha: 'e'.repeat(40),
    },
    async (state, currentEvent) => {
      const result = await consolidationMerged(currentEvent, {
        allowLegacy: true,
      });
      assert.deepEqual(result.sourcePullRequests, {
        closed: [],
        alreadyClosed: [44],
      });
      assert.equal(state.comments.get(44).length, 0);
      assert.deepEqual(
        state.issues.get(33).labels.map(label => label.name),
        ['radar:feature', 'radar:ready-for-release']
      );
    }
  );
});

test('reconciliation keeps the strict path for normal non-squash merges', async () => {
  const event = consolidationEvent({
    state: 'closed',
    merged_at: '2026-08-25T20:40:08Z',
    head: {
      ref: 'radar/consolidation-test',
      repo: { full_name: 'Host-It-Labs/pomi' },
      sha: 'b'.repeat(40),
    },
  });
  const sourcePulls = [
    {
      number: 44,
      state: 'open',
      user: { login: 'pomi-radar[bot]' },
      body: marker('pomi-radar-source:v1', {
        version: 1,
        track: 'feature',
        issues: [33],
      }),
      base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
      head: {
        sha: 'c'.repeat(40),
        repo: { full_name: 'Host-It-Labs/pomi' },
      },
    },
  ];
  await withFakeConsolidationGithub(
    {
      event,
      issue: {
        number: 33,
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:in-review' }],
      },
      sourcePulls,
      comparisonStatus: 'ahead',
    },
    async (state, currentEvent) => {
      const result = await reconcileConsolidation(99);
      assert.deepEqual(result.sourcePullRequests, {
        closed: [44],
        alreadyClosed: [],
      });
      assert.equal(state.pulls.get(44).state, 'closed');
      assert.equal(state.comments.get(44).length, 1);
      assert.equal(currentEvent.pull_request.number, 99);
    }
  );
});

test('reconciliation limits the relaxed path to historical squash-shaped merges', async () => {
  const event = consolidationEvent({
    user: { login: 'NeoHuncho' },
    state: 'closed',
    merged_at: '2026-08-25T20:40:08Z',
    commits: 2,
    base: {
      ref: 'main',
      sha: 'f'.repeat(40),
      repo: { full_name: 'Host-It-Labs/pomi' },
    },
    head: {
      ref: 'radar/consolidation-test',
      repo: { full_name: 'Host-It-Labs/pomi' },
      sha: 'b'.repeat(40),
    },
  });
  const sourcePulls = [
    {
      number: 44,
      state: 'open',
      user: { login: 'contributor' },
      body: marker('pomi-radar-source:v1', {
        version: 1,
        track: 'feature',
        issues: [33],
      }),
      base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
      head: {
        sha: 'c'.repeat(40),
        repo: { full_name: 'Host-It-Labs/pomi' },
      },
    },
  ];
  await withFakeConsolidationGithub(
    {
      event,
      issue: {
        number: 33,
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:accepted' }],
      },
      sourcePulls,
      comparisonStatus: 'ahead',
      comparisonAheadBy: 1,
      commitTreeSha: 'e'.repeat(40),
      commitParents: ['d'.repeat(40)],
    },
    async state => {
      const result = await reconcileConsolidation(99);
      assert.deepEqual(result.sourcePullRequests, {
        closed: [44],
        alreadyClosed: [],
      });
      assert.equal(state.pulls.get(44).state, 'closed');
      assert.deepEqual(
        state.issues.get(33).labels.map(label => label.name),
        ['radar:feature', 'radar:ready-for-release']
      );
    }
  );
});

test('lifecycle JSON commands read standard input with the Node runtime', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./radar-lifecycle.mjs', import.meta.url)),
      'consolidation-reconcile',
    ],
    {
      input: '{"pullRequestNumber":0}\n',
      encoding: 'utf8',
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /positive consolidation pull request number/);
  assert.doesNotMatch(result.stderr, /path.*number.*0/);
});

test('merged consolidations close contained source PRs and retry idempotently', async () => {
  const event = consolidationEvent({
    body: marker('pomi-radar-consolidation:v1', {
      version: 1,
      issues: [33],
      sourcePrs: [44, 45],
    }),
  });
  const sourcePulls = [44, 45].map((number, index) => ({
    number,
    state: 'open',
    user: { login: 'pomi-radar[bot]' },
    body: marker('pomi-radar-source:v1', {
      version: 1,
      track: 'feature',
      issues: [33],
    }),
    base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
    head: {
      sha: String.fromCharCode(98 + index).repeat(40),
      repo: { full_name: 'Host-It-Labs/pomi' },
    },
  }));
  await withFakeConsolidationGithub(
    {
      event,
      issue: {
        number: 33,
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:in-review' }],
      },
      sourcePulls,
      comparisonStatus: 'ahead',
    },
    async (state, currentEvent) => {
      const first = await consolidationMerged(currentEvent);
      assert.deepEqual(first.updated, [33]);
      assert.deepEqual(first.sourcePullRequests, {
        closed: [44, 45],
        alreadyClosed: [],
      });
      assert.equal(state.pulls.get(44).state, 'closed');
      assert.equal(state.pulls.get(45).state, 'closed');

      const second = await consolidationMerged(currentEvent);
      assert.deepEqual(second.sourcePullRequests, {
        closed: [],
        alreadyClosed: [44, 45],
      });
      assert.equal(state.comments.get(44).length, 1);
      assert.equal(state.comments.get(45).length, 1);
      assert.equal(state.comments.get(33).length, 1);
      assert.deepEqual(
        state.issues.get(33).labels.map(label => label.name),
        ['radar:feature', 'radar:ready-for-release']
      );
    }
  );
});

test('consolidation transitions respect another lifecycle claim for the issue', async () => {
  const event = consolidationEvent();
  const sourcePull = {
    number: 44,
    state: 'open',
    user: { login: 'pomi-radar[bot]' },
    body: marker('pomi-radar-source:v1', {
      version: 1,
      track: 'feature',
      issues: [33],
    }),
    base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
    head: {
      sha: 'b'.repeat(40),
      repo: { full_name: 'Host-It-Labs/pomi' },
    },
  };
  await withFakeConsolidationGithub(
    {
      event,
      issue: {
        number: 33,
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:in-review' }],
      },
      sourcePulls: [sourcePull],
      comparisonStatus: 'ahead',
      comments: {
        33: [
          {
            id: 1,
            user: { login: 'pomi-radar[bot]' },
            body: marker('pomi-radar-event:v1', {
              id: 'already-implemented:33:pending',
              expectedRevision: 0,
              claimScope: 'radar:in-review:',
            }),
          },
        ],
      },
    },
    async (state, currentEvent) => {
      await assert.rejects(
        consolidationMerged(currentEvent),
        /changed while the consolidation lifecycle transition was being recorded/
      );
      assert.equal(state.pulls.get(44).state, 'open');
      assert.equal(state.comments.get(33).length, 1);
    }
  );
});

test('merged consolidations refuse to close a source outside merge ancestry', async () => {
  const event = consolidationEvent();
  const sourcePull = {
    number: 44,
    state: 'open',
    user: { login: 'pomi-radar[bot]' },
    body: marker('pomi-radar-source:v1', {
      version: 1,
      track: 'feature',
      issues: [33],
    }),
    base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
    head: {
      sha: 'b'.repeat(40),
      repo: { full_name: 'Host-It-Labs/pomi' },
    },
  };
  await withFakeConsolidationGithub(
    {
      event,
      issue: {
        number: 33,
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:in-review' }],
      },
      sourcePulls: [sourcePull],
      comparisonStatus: 'diverged',
    },
    async (state, currentEvent) => {
      await assert.rejects(
        consolidationMerged(currentEvent),
        /not contained in consolidation PR/
      );
      assert.equal(state.pulls.get(44).state, 'open');
      assert.equal(state.comments.get(33).length, 0);
      assert.equal(state.comments.get(44).length, 0);
    }
  );
});

test('merged consolidations reject untrusted source PRs', async () => {
  const event = consolidationEvent({
    body: marker('pomi-radar-consolidation:v1', {
      version: 1,
      issues: [33],
      sourcePrs: [44],
    }),
  });
  const sourcePull = {
    number: 44,
    state: 'open',
    user: { login: 'contributor' },
    body: marker('pomi-radar-source:v1', {
      version: 1,
      track: 'feature',
      issues: [33],
    }),
    base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
    head: {
      sha: 'b'.repeat(40),
      repo: { full_name: 'Host-It-Labs/pomi' },
    },
  };
  await withFakeConsolidationGithub(
    {
      event,
      issue: {
        number: 33,
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:in-review' }],
      },
      sourcePulls: [sourcePull],
      comparisonStatus: 'ahead',
    },
    async (state, currentEvent) => {
      await assert.rejects(
        consolidationMerged(currentEvent),
        /must be authored by the Radar bot/
      );
      assert.equal(state.pulls.get(44).state, 'open');
      assert.equal(state.comments.get(44).length, 0);
    }
  );
});

test('merged consolidations require source PR issue sets to match the manifest', async () => {
  const event = consolidationEvent({
    body: marker('pomi-radar-consolidation:v1', {
      version: 1,
      issues: [33],
      sourcePrs: [44],
    }),
  });
  const sourcePull = {
    number: 44,
    state: 'open',
    user: { login: 'pomi-radar[bot]' },
    body: marker('pomi-radar-source:v1', {
      version: 1,
      track: 'feature',
      issues: [34],
    }),
    base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
    head: {
      sha: 'b'.repeat(40),
      repo: { full_name: 'Host-It-Labs/pomi' },
    },
  };
  await withFakeConsolidationGithub(
    {
      event,
      issue: {
        number: 33,
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:in-review' }],
      },
      sourcePulls: [sourcePull],
      comparisonStatus: 'ahead',
    },
    async (state, currentEvent) => {
      await assert.rejects(
        consolidationMerged(currentEvent),
        /does not represent the consolidation issue set/
      );
      assert.equal(state.pulls.get(44).state, 'open');
      assert.equal(state.comments.get(44).length, 0);
    }
  );
});

test('merged consolidations audit already-closed source PRs', async () => {
  const event = consolidationEvent({
    body: marker('pomi-radar-consolidation:v1', {
      version: 1,
      issues: [33],
      sourcePrs: [44],
    }),
  });
  const sourcePull = {
    number: 44,
    state: 'closed',
    user: { login: 'pomi-radar[bot]' },
    body: marker('pomi-radar-source:v1', {
      version: 1,
      track: 'feature',
      issues: [33],
    }),
    base: { ref: 'main', repo: { full_name: 'Host-It-Labs/pomi' } },
    head: {
      sha: 'b'.repeat(40),
      repo: { full_name: 'Host-It-Labs/pomi' },
    },
  };
  await withFakeConsolidationGithub(
    {
      event,
      issue: {
        number: 33,
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:in-review' }],
      },
      sourcePulls: [sourcePull],
      comparisonStatus: 'ahead',
    },
    async (state, currentEvent) => {
      const result = await consolidationMerged(currentEvent);
      assert.deepEqual(result.sourcePullRequests, {
        closed: [],
        alreadyClosed: [44],
      });
      assert.equal(state.comments.get(44).length, 1);
    }
  );
});

test('missing Sentry groups are already absent during release closure', async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.SENTRY_AUTH_TOKEN;
  process.env.SENTRY_AUTH_TOKEN = 'test-token';
  globalThis.fetch = async () => new globalThis.Response(null, { status: 404 });
  try {
    await resolveSentryGroup('138003899');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.SENTRY_AUTH_TOKEN;
    else process.env.SENTRY_AUTH_TOKEN = previousToken;
  }
});

test('unexpected Sentry resolution failures remain fatal', async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.SENTRY_AUTH_TOKEN;
  process.env.SENTRY_AUTH_TOKEN = 'test-token';
  globalThis.fetch = async () => new globalThis.Response(null, { status: 500 });
  try {
    await assert.rejects(resolveSentryGroup('138003899'), /update failed: 500/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.SENTRY_AUTH_TOKEN;
    else process.env.SENTRY_AUTH_TOKEN = previousToken;
  }
});

test('release closure verifies the published release before reading Radar issues', async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.GITHUB_TOKEN;
  const requests = [];
  process.env.GITHUB_TOKEN = 'test-token';
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname.endsWith('/releases/tags/0.1.1'))
      return globalThis.Response.json({
        tag_name: '0.1.1',
        draft: false,
        prerelease: false,
      });
    if (url.pathname.endsWith('/issues')) return globalThis.Response.json([]);
    return globalThis.Response.json(
      { message: 'unexpected request' },
      { status: 500 }
    );
  };
  try {
    assert.deepEqual(
      await releaseReadyIssues({
        releaseTag: '0.1.1',
        releaseUrl: 'https://github.com/Host-It-Labs/pomi/releases/tag/0.1.1',
        releaseSha: 'a'.repeat(40),
      }),
      { released: [] }
    );
    assert.deepEqual(requests, [
      '/repos/Host-It-Labs/pomi/releases/tags/0.1.1',
      '/repos/Host-It-Labs/pomi/issues',
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  }
});

test('release closure refuses prereleases before mutating Radar issues', async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.GITHUB_TOKEN;
  let issueRequestCount = 0;
  process.env.GITHUB_TOKEN = 'test-token';
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/releases/tags/0.1.2'))
      return globalThis.Response.json({
        tag_name: '0.1.2',
        draft: false,
        prerelease: true,
      });
    if (url.pathname.endsWith('/issues')) issueRequestCount += 1;
    return globalThis.Response.json(
      { message: 'unexpected request' },
      { status: 500 }
    );
  };
  try {
    await assert.rejects(
      releaseReadyIssues({
        releaseTag: '0.1.2',
        releaseUrl: 'https://github.com/Host-It-Labs/pomi/releases/tag/0.1.2',
        releaseSha: 'a'.repeat(40),
      }),
      /published, non-prerelease GitHub Release/
    );
    assert.equal(issueRequestCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  }
});

const report = {
  number: 20,
  createdAt: '2026-08-07T08:00:00Z',
  title: 'Search misses tasks on later pages',
  codeArea: 'tasks/search',
  observed: 'Search only checks the currently loaded task page',
  expected: 'Search all matching tasks',
  acceptanceCriteria: ['Find a matching task outside the first page'],
};

const completePresentation = {
  displayTitle: 'Keep timer controls visible during long sessions',
  summary: 'The controls remain reachable while a long session is active.',
  whyNow: 'Long sessions currently require extra scrolling.',
  currentState: 'Controls can leave the visible area.',
  details: 'Keep the controls in a stable visible position.',
  evidence: 'The timer layout places controls below growing content.',
  tradeoffs: 'The sticky area must not cover timer content.',
  validation: 'Verify long sessions at supported viewport sizes.',
  acceptanceCriteria: ['Controls remain visible without covering content.'],
};

async function withFakeGithub(initialIssue, run) {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.GITHUB_TOKEN;
  const state = {
    issue: globalThis.structuredClone(initialIssue),
    comments: [],
    patches: [],
  };
  process.env.GITHUB_TOKEN = 'test-token';
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const isComments = url.pathname.endsWith('/issues/20/comments');
    if (isComments && method === 'GET')
      return globalThis.Response.json(state.comments);
    if (isComments && method === 'POST') {
      const comment = {
        id: state.comments.length + 1,
        ...JSON.parse(init.body),
      };
      state.comments.push(comment);
      return globalThis.Response.json(comment);
    }
    if (url.pathname.endsWith('/issues/20') && method === 'GET')
      return globalThis.Response.json(state.issue);
    if (url.pathname.endsWith('/issues/20') && method === 'PATCH') {
      const changes = JSON.parse(init.body);
      state.issue = { ...state.issue, ...changes };
      state.patches.push(changes);
      return globalThis.Response.json(state.issue);
    }
    return globalThis.Response.json(
      { message: `Unexpected ${method} ${url.pathname}` },
      { status: 500 }
    );
  };
  try {
    await run(state);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  }
}

async function withFakeGithubIssues(initialIssues, run, options = {}) {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.GITHUB_TOKEN;
  const sourcePulls = options.pulls ?? [];
  const comments = new Map(
    [...initialIssues, ...sourcePulls].map(item => [item.number, []])
  );
  for (const [number, values] of Object.entries(options.comments ?? {})) {
    comments.set(Number(number), globalThis.structuredClone(values));
  }
  const state = {
    issues: new Map(
      initialIssues.map(issue => [
        issue.number,
        globalThis.structuredClone(issue),
      ])
    ),
    pulls: new Map(
      sourcePulls.map(pull => [pull.number, globalThis.structuredClone(pull)])
    ),
    labels: new Set(options.labels ?? []),
    comments,
    patches: [],
    failFinalDuplicatePatch: options.failFinalDuplicatePatch === true,
    failFinalAlreadyImplementedPatch:
      options.failFinalAlreadyImplementedPatch === true,
    failConsolidationPatch: options.failConsolidationPatch === true,
  };
  process.env.GITHUB_TOKEN = 'test-token';
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    if (url.pathname.endsWith('/labels') && method === 'GET')
      return globalThis.Response.json(
        [...state.labels].map(name => ({ name }))
      );
    if (url.pathname.endsWith('/labels') && method === 'POST') {
      const label = JSON.parse(init.body);
      state.labels.add(label.name);
      return globalThis.Response.json(label);
    }
    if (url.pathname.endsWith('/pulls') && method === 'GET')
      return globalThis.Response.json([...state.pulls.values()]);
    const match = url.pathname.match(/\/(issues|pulls)\/(\d+)(\/comments)?$/);
    if (!match)
      return globalThis.Response.json(
        { message: `Unexpected ${method} ${url.pathname}` },
        { status: 500 }
      );
    const resource = match[1];
    const issueNumber = Number(match[2]);
    const collection = resource === 'issues' ? state.issues : state.pulls;
    if (match[3] && method === 'GET')
      return globalThis.Response.json(state.comments.get(issueNumber) ?? []);
    if (match[3] && method === 'POST') {
      const comments = state.comments.get(issueNumber) ?? [];
      const comment = {
        id: comments.length + 1,
        user: { login: 'pomi-radar[bot]' },
        ...JSON.parse(init.body),
      };
      comments.push(comment);
      state.comments.set(issueNumber, comments);
      const value = collection.get(issueNumber);
      if (value?.updated_at) {
        value.updated_at = new Date(
          new Date(value.updated_at).getTime() + 1000
        ).toISOString();
      }
      return globalThis.Response.json(comment);
    }
    if (method === 'GET')
      return globalThis.Response.json(collection.get(issueNumber));
    if (method === 'PATCH') {
      const changes = JSON.parse(init.body);
      if (
        state.failFinalDuplicatePatch &&
        changes.state === 'closed' &&
        changes.state_reason === 'duplicate'
      ) {
        state.failFinalDuplicatePatch = false;
        return globalThis.Response.json(
          { message: 'Injected final patch failure' },
          { status: 500 }
        );
      }
      if (
        state.failFinalAlreadyImplementedPatch &&
        resource === 'issues' &&
        changes.labels?.includes('radar:already-implemented')
      ) {
        state.failFinalAlreadyImplementedPatch = false;
        return globalThis.Response.json(
          { message: 'Injected final already-implemented patch failure' },
          { status: 500 }
        );
      }
      if (
        state.failConsolidationPatch &&
        resource === 'pulls' &&
        changes.state === 'closed' &&
        changes.body?.includes('pomi-radar-consolidation:v1')
      ) {
        state.failConsolidationPatch = false;
        return globalThis.Response.json(
          { message: 'Injected consolidation patch failure' },
          { status: 500 }
        );
      }
      const normalized = {
        ...changes,
        ...(changes.labels
          ? { labels: changes.labels.map(name => ({ name })) }
          : {}),
      };
      const value = { ...collection.get(issueNumber), ...normalized };
      collection.set(issueNumber, value);
      state.patches.push({ resource, issueNumber, changes });
      return globalThis.Response.json(value);
    }
    return globalThis.Response.json(
      { message: `Unexpected ${method} ${url.pathname}` },
      { status: 500 }
    );
  };
  try {
    await run(state);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  }
}

async function withFakeConsolidationGithub(
  {
    event,
    issue,
    sourcePulls,
    comparisonStatus,
    comparisonAheadBy,
    commitTreeSha,
    commitParents,
    comments: initialComments,
  },
  run
) {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.GITHUB_TOKEN;
  const issues = new Map([[issue.number, globalThis.structuredClone(issue)]]);
  const pulls = new Map([
    [event.pull_request.number, globalThis.structuredClone(event.pull_request)],
    ...sourcePulls.map(sourcePull => [
      sourcePull.number,
      globalThis.structuredClone(sourcePull),
    ]),
  ]);
  const comments = new Map(
    [issue.number, ...sourcePulls.map(sourcePull => sourcePull.number)].map(
      number => [number, []]
    )
  );
  for (const [number, values] of Object.entries(initialComments ?? {}))
    comments.set(Number(number), globalThis.structuredClone(values));
  const state = { issues, pulls, comments, patches: [] };
  process.env.GITHUB_TOKEN = 'test-token';
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const match = url.pathname.match(/\/(issues|pulls)\/(\d+)(\/comments)?$/);
    if (match) {
      const resource = match[1];
      const number = Number(match[2]);
      const collection = resource === 'issues' ? issues : pulls;
      if (match[3] && method === 'GET')
        return globalThis.Response.json(comments.get(number) ?? []);
      if (match[3] && method === 'POST') {
        const values = comments.get(number) ?? [];
        const comment = {
          id: values.length + 1,
          user: { login: 'pomi-radar[bot]' },
          ...JSON.parse(init.body),
        };
        values.push(comment);
        comments.set(number, values);
        return globalThis.Response.json(comment);
      }
      if (method === 'GET')
        return globalThis.Response.json(collection.get(number));
      if (method === 'PATCH') {
        const changes = JSON.parse(init.body);
        const normalized = {
          ...changes,
          ...(changes.labels
            ? { labels: changes.labels.map(name => ({ name })) }
            : {}),
        };
        const value = { ...collection.get(number), ...normalized };
        collection.set(number, value);
        state.patches.push({ resource, number, changes });
        return globalThis.Response.json(value);
      }
    }
    if (url.pathname.match(/\/commits\/[0-9a-f]+$/))
      return globalThis.Response.json({
        commit: { tree: { sha: commitTreeSha } },
        parents: (commitParents ?? []).map(sha => ({ sha })),
      });
    if (url.pathname.includes('/compare/'))
      return globalThis.Response.json({
        status: comparisonStatus,
        ahead_by: comparisonAheadBy,
      });
    return globalThis.Response.json(
      { message: `Unexpected ${method} ${url.pathname}` },
      { status: 500 }
    );
  };
  try {
    await run(state, event);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  }
}

test('immutable source IDs are exact matches', () => {
  assert.equal(
    classifyMatch({ sourceId: 'feedback-42' }, { sourceIds: ['feedback-42'] })
      .level,
    'exact-source'
  );
});

test('same-day feedback with the same root behavior is consolidated', () => {
  const repeated = {
    ...report,
    number: 21,
    createdAt: '2026-08-07T16:00:00Z',
    title: 'Task search cannot find an older result',
    observed: 'The task picker searches only items in its loaded page',
    expected: 'Search all matching tasks',
    platform: 'macOS',
  };
  assert.equal(classifyMatch(repeated, report).level, 'same-root');
  const [cluster] = deduplicationPlan([repeated, report]);
  assert.equal(cluster.canonical.number, 20);
  assert.deepEqual(
    cluster.duplicates.map(issue => issue.number),
    [21]
  );
});

test('issues in the same feature area remain related but distinct', () => {
  const scrolling = {
    title: 'Scroll pages with the mouse wheel',
    codeArea: 'tasks/search',
    observed: 'Pagination requires clicking arrows',
    expected: 'Mouse wheel changes task pages',
  };
  assert.equal(classifyMatch(scrolling, report).level, 'related-distinct');
});

test('canonical selection is oldest with number as a stable tie breaker', () => {
  assert.equal(
    selectCanonical([
      { number: 9, createdAt: '2026-08-07T09:00:00Z' },
      { number: 7, createdAt: '2026-08-07T09:00:00Z' },
    ]).number,
    7
  );
});

test('additional evidence contains only changed fields and broadened criteria', () => {
  assert.deepEqual(
    evidenceDelta(
      {
        ...report,
        platform: 'Android',
        diagnostics: 'Fails after reconnect',
        acceptanceCriteria: [
          ...report.acceptanceCriteria,
          'Works after reconnect',
        ],
      },
      report
    ),
    [
      '- **Platform:** Android',
      '- **Diagnostics:** Fails after reconnect',
      '- **Broadened acceptance criteria:** Works after reconnect',
    ]
  );
});

test('one active lifecycle label replaces any prior lifecycle labels', () => {
  assert.deepEqual(
    nextLifecycleLabels(
      ['radar:feature', 'radar:proposed', 'radar:blocked'],
      'radar:accepted'
    ),
    ['radar:feature', 'radar:accepted']
  );
});

test('already-implemented verification requires an explicit remaining-gap statement', () => {
  const verification = {
    summary: 'Existing auth checks already cover the reported path.',
    evidence:
      'The shared guard rejects expired sessions before private data loads.',
    validation: 'Focused expiration and refresh-failure tests pass.',
    gap: 'No material gap found.',
  };
  assert.deepEqual(
    alreadyImplementedVerification({
      ...verification,
      verifiedAt: '2026-08-29T10:00:00Z',
    }),
    {
      outcome: 'already-implemented',
      ...verification,
      verifiedAt: '2026-08-29T10:00:00Z',
    }
  );
  assert.throws(
    () => alreadyImplementedVerification({ summary: 'Covered' }),
    /evidence, validation, gap, verifiedAt/
  );
  for (const verifiedAt of [
    '08/29/2026',
    '2026-02-30T10:00:00Z',
    '2026-08-29T10:00:00+00:00',
  ]) {
    assert.throws(
      () => alreadyImplementedVerification({ ...verification, verifiedAt }),
      /valid ISO 8601 UTC verifiedAt timestamp/
    );
  }
});

test('already-implemented issues wait for the user without entering the implementation queue', async () => {
  const issue = {
    number: 54,
    state: 'open',
    updated_at: '2026-08-29T09:00:00Z',
    labels: [{ name: 'radar:security' }, { name: 'radar:in-review' }],
    body: marker('pomi-radar:v1', { version: 1 }),
  };
  await withFakeGithubIssues([issue], async state => {
    const verification = {
      summary: 'The current protection already covers the reported behavior.',
      evidence: 'The shared request boundary rejects the unsafe input.',
      validation: 'Focused invalid-input tests pass.',
      gap: 'No material gap found.',
      verifiedAt: '2026-08-29T10:00:00Z',
    };
    const first = await markAlreadyImplemented({
      issueNumber: 54,
      ...verification,
    });
    assert.equal(first.updated, true);
    assert.equal(first.duplicate, false);
    assert.deepEqual(
      state.issues.get(54).labels.map(label => label.name),
      ['radar:security', 'radar:already-implemented']
    );
    assert.equal(state.issues.get(54).state, 'open');
    assert.deepEqual(
      readMarker(state.issues.get(54).body, 'pomi-radar:v1')
        .implementationVerification,
      { outcome: 'already-implemented', ...verification }
    );
    assert.equal(state.comments.get(54).length, 1);

    const second = await markAlreadyImplemented({
      issueNumber: 54,
      ...verification,
    });
    assert.equal(second.duplicate, true);
    assert.equal(state.comments.get(54).length, 1);
  });
});

test('already-implemented rejects ambiguous source or lifecycle labels', async () => {
  const issue = {
    number: 54,
    state: 'open',
    updated_at: '2026-08-29T09:00:00Z',
    labels: [
      { name: 'radar:security' },
      { name: 'radar:performance' },
      { name: 'radar:in-review' },
    ],
    body: marker('pomi-radar:v1', { version: 1 }),
  };
  const verification = {
    summary: 'The existing protection covers the reported behavior.',
    evidence: 'The shared request boundary rejects unsafe input.',
    validation: 'Focused invalid-input tests pass.',
    gap: 'No material gap found.',
    verifiedAt: '2026-08-29T10:00:00Z',
  };
  await withFakeGithubIssues([issue], async state => {
    await assert.rejects(
      markAlreadyImplemented({ issueNumber: 54, ...verification }),
      /exactly one Radar source label and one lifecycle label/
    );
    state.issues.get(54).labels = [
      { name: 'radar:security' },
      { name: 'radar:in-review' },
      { name: 'radar:ready-for-release' },
    ];
    await assert.rejects(
      markAlreadyImplemented({ issueNumber: 54, ...verification }),
      /exactly one Radar source label and one lifecycle label/
    );
    assert.equal(state.comments.get(54).length, 0);
  });
});

test('already-implemented retries reuse their original claim after a final patch failure', async () => {
  const issue = {
    number: 54,
    state: 'open',
    updated_at: '2026-08-29T09:00:00Z',
    labels: [{ name: 'radar:security' }, { name: 'radar:in-review' }],
    body: marker('pomi-radar:v1', { version: 1 }),
  };
  await withFakeGithubIssues(
    [issue],
    async state => {
      const verification = {
        summary: 'The current protection already covers the reported behavior.',
        evidence: 'The shared request boundary rejects the unsafe input.',
        validation: 'Focused invalid-input tests pass.',
        gap: 'No material gap found.',
        verifiedAt: '2026-08-29T10:00:00Z',
      };
      await assert.rejects(
        markAlreadyImplemented({ issueNumber: 54, ...verification }),
        /GitHub PATCH \/issues\/54 failed: 500/
      );
      assert.equal(state.comments.get(54).length, 1);
      await markAlreadyImplemented({ issueNumber: 54, ...verification });
      assert.equal(state.comments.get(54).length, 1);
      assert.equal(
        readMarker(state.issues.get(54).body, 'pomi-radar:v1')
          .implementationVerification.outcome,
        'already-implemented'
      );
    },
    { failFinalAlreadyImplementedPatch: true }
  );
});

test('already-implemented rejects a competing verification claim for the same issue', async () => {
  const issue = {
    number: 54,
    state: 'open',
    updated_at: '2026-08-29T09:00:00Z',
    labels: [{ name: 'radar:security' }, { name: 'radar:in-review' }],
    body: marker('pomi-radar:v1', { version: 1 }),
  };
  await withFakeGithubIssues(
    [issue],
    async state => {
      await assert.rejects(
        markAlreadyImplemented({
          issueNumber: 54,
          summary: 'A competing verification is already in progress.',
          evidence: 'An existing claim comment owns this issue transition.',
          validation: 'The claim ownership guard was exercised.',
          gap: 'No material gap found.',
          verifiedAt: '2026-08-29T10:00:00Z',
        }),
        /changed while implementation verification was being recorded/
      );
      assert.equal(state.comments.get(54).length, 1);
      assert.deepEqual(
        state.issues.get(54).labels.map(label => label.name),
        ['radar:security', 'radar:in-review']
      );
    },
    {
      comments: {
        54: [
          {
            id: 1,
            user: { login: 'pomi-radar[bot]' },
            body: marker('pomi-radar-event:v1', {
              id: 'already-implemented:54:other-verification',
              expectedRevision: 123,
              claimScope: 'radar:in-review:',
            }),
          },
        ],
      },
    }
  );
});

test('already-implemented ignores verification claims from other authors', async () => {
  const issue = {
    number: 54,
    state: 'open',
    updated_at: '2026-08-29T09:00:00Z',
    labels: [{ name: 'radar:security' }, { name: 'radar:in-review' }],
    body: marker('pomi-radar:v1', { version: 1 }),
  };
  await withFakeGithubIssues(
    [issue],
    async state => {
      await markAlreadyImplemented({
        issueNumber: 54,
        summary: 'The existing protection covers the reported behavior.',
        evidence: 'The shared request boundary rejects unsafe input.',
        validation: 'Focused invalid-input tests pass.',
        gap: 'No material gap found.',
        verifiedAt: '2026-08-29T10:00:00Z',
      });
      assert.equal(state.comments.get(54).length, 2);
      assert.equal(state.comments.get(54)[0].user.login, 'contributor');
      assert.equal(state.comments.get(54)[1].user.login, 'pomi-radar[bot]');
      assert.deepEqual(
        state.issues.get(54).labels.map(label => label.name),
        ['radar:security', 'radar:already-implemented']
      );
    },
    {
      comments: {
        54: [
          {
            id: 1,
            user: { login: 'contributor' },
            body: marker('pomi-radar-event:v1', {
              id: 'already-implemented:54:forged',
              expectedRevision: 123,
              claimScope: 'radar:in-review:',
            }),
          },
        ],
      },
    }
  );
});

test('already-implemented can verify an issue again after reconsideration', async () => {
  const issue = {
    number: 54,
    state: 'open',
    updated_at: '2026-08-29T09:00:00Z',
    labels: [{ name: 'radar:security' }, { name: 'radar:in-review' }],
    body: marker('pomi-radar:v1', { version: 1 }),
  };
  await withFakeGithubIssues([issue], async state => {
    await markAlreadyImplemented({
      issueNumber: 54,
      summary: 'The existing protection covers the reported behavior.',
      evidence: 'The shared request boundary rejects unsafe input.',
      validation: 'Focused invalid-input tests pass.',
      gap: 'No material gap found.',
      verifiedAt: '2026-08-29T10:00:00Z',
    });
    state.issues.get(54).labels = [
      { name: 'radar:security' },
      { name: 'radar:accepted' },
    ];
    const result = await markAlreadyImplemented({
      issueNumber: 54,
      summary: 'The existing protection still covers the behavior.',
      evidence: 'The shared request boundary still rejects unsafe input.',
      validation: 'The focused regression suite still passes.',
      gap: 'No material gap found.',
      verifiedAt: '2026-08-29T11:00:00Z',
    });
    assert.equal(result.updated, true);
    assert.equal(
      readMarker(state.issues.get(54).body, 'pomi-radar:v1')
        .implementationVerification.summary,
      'The existing protection still covers the behavior.'
    );
    assert.equal(state.comments.get(54).length, 2);
  });
});

test('already-implemented closes grouped source PRs and empty consolidations', async () => {
  const verification = {
    summary: 'The current protection already covers the reported behavior.',
    evidence: 'The shared request boundary rejects the unsafe input.',
    validation: 'Focused invalid-input tests pass.',
    gap: 'No material gap found.',
    verifiedAt: '2026-08-29T10:00:00Z',
  };
  await withFakeGithubIssues(
    [
      {
        number: 54,
        state: 'open',
        updated_at: '2026-08-29T09:00:00Z',
        labels: [{ name: 'radar:security' }, { name: 'radar:in-review' }],
        body: marker('pomi-radar:v1', { version: 1 }),
      },
      {
        number: 78,
        state: 'open',
        updated_at: '2026-08-29T09:00:00Z',
        labels: [{ name: 'radar:performance' }, { name: 'radar:in-review' }],
        body: marker('pomi-radar:v1', { version: 1 }),
      },
    ],
    async state => {
      const grouped = await markAlreadyImplemented({
        issueNumber: 54,
        ...verification,
      });
      assert.deepEqual(grouped.sourcePullRequests, {
        closed: [194],
        detached: [],
      });
      assert.deepEqual(grouped.consolidationPullRequests, {
        closed: [196],
        detached: [],
      });
      assert.deepEqual(
        readMarker(state.pulls.get(194).body, 'pomi-radar-source:v1').issues,
        [54, 55]
      );
      assert.equal(state.pulls.get(194).state, 'closed');
      assert.deepEqual(
        readMarker(state.pulls.get(196).body, 'pomi-radar-consolidation:v1'),
        { version: 1, issues: [55], sourcePrs: [] }
      );
      assert.equal(state.pulls.get(196).state, 'closed');

      const empty = await markAlreadyImplemented({
        issueNumber: 78,
        ...verification,
      });
      assert.deepEqual(empty.sourcePullRequests, {
        closed: [195],
        detached: [],
      });
      assert.deepEqual(empty.consolidationPullRequests, {
        closed: [197],
        detached: [],
      });
      assert.equal(state.pulls.get(195).state, 'closed');
      assert.equal(state.pulls.get(197).state, 'closed');
    },
    {
      pulls: [
        {
          number: 194,
          state: 'open',
          user: { login: 'pomi-radar[bot]' },
          body: marker('pomi-radar-source:v1', {
            version: 1,
            track: 'security',
            issues: [54, 55],
          }),
        },
        {
          number: 195,
          state: 'open',
          user: { login: 'pomi-radar[bot]' },
          body: marker('pomi-radar-source:v1', {
            version: 1,
            track: 'performance',
            issues: [78],
          }),
        },
        {
          number: 196,
          state: 'open',
          user: { login: 'pomi-radar[bot]' },
          body: marker('pomi-radar-consolidation:v1', {
            version: 1,
            issues: [54, 55],
            sourcePrs: [194],
          }),
        },
        {
          number: 197,
          state: 'open',
          user: { login: 'pomi-radar[bot]' },
          body: marker('pomi-radar-consolidation:v1', {
            version: 1,
            issues: [78],
            sourcePrs: [195],
          }),
        },
      ],
    }
  );
});

test('already-implemented retries remove a source PR closed before consolidation cleanup', async () => {
  const issue = {
    number: 54,
    state: 'open',
    updated_at: '2026-08-29T09:00:00Z',
    labels: [{ name: 'radar:security' }, { name: 'radar:in-review' }],
    body: marker('pomi-radar:v1', { version: 1 }),
  };
  const verification = {
    summary: 'The existing protection covers the reported behavior.',
    evidence: 'The shared request boundary rejects unsafe input.',
    validation: 'Focused invalid-input tests pass.',
    gap: 'No material gap found.',
    verifiedAt: '2026-08-29T10:00:00Z',
  };
  await withFakeGithubIssues(
    [issue],
    async state => {
      await assert.rejects(
        markAlreadyImplemented({ issueNumber: 54, ...verification }),
        /GitHub PATCH \/pulls\/196 failed: 500/
      );
      assert.equal(state.pulls.get(194).state, 'closed');
      assert.equal(state.pulls.get(196).state, 'open');

      const result = await markAlreadyImplemented({
        issueNumber: 54,
        ...verification,
      });
      assert.deepEqual(result.consolidationPullRequests, {
        closed: [196],
        detached: [],
      });
      assert.deepEqual(
        readMarker(state.pulls.get(196).body, 'pomi-radar-consolidation:v1'),
        { version: 1, issues: [55], sourcePrs: [195] }
      );
      assert.equal(state.pulls.get(196).state, 'closed');
    },
    {
      failConsolidationPatch: true,
      pulls: [
        {
          number: 194,
          state: 'open',
          user: { login: 'pomi-radar[bot]' },
          body: marker('pomi-radar-source:v1', {
            version: 1,
            track: 'security',
            issues: [54],
          }),
        },
        {
          number: 195,
          state: 'open',
          user: { login: 'pomi-radar[bot]' },
          body: marker('pomi-radar-source:v1', {
            version: 1,
            track: 'security',
            issues: [55],
          }),
        },
        {
          number: 196,
          state: 'open',
          user: { login: 'pomi-radar[bot]' },
          body: marker('pomi-radar-consolidation:v1', {
            version: 1,
            issues: [54, 55],
            sourcePrs: [194, 195],
          }),
        },
      ],
    }
  );
});

test('already-implemented proposals occupy a visible proposal slot but are not agent work', () => {
  const issue = {
    number: 54,
    state: 'open',
    generatedAt: '2026-08-29T10:00:00Z',
    pendingAgentPass: false,
    labels: ['radar:security', 'radar:already-implemented'],
  };
  assert.deepEqual(selectActionableIssues([issue]), []);
  assert.deepEqual(proposalSlotPlan([issue]), {
    visibleProposalCount: 1,
    visibleProposalIssueNumbers: [54],
    proposalSlotsNeeded: 2,
  });
});

test('clarification round two asks only unlocked questions', () => {
  const questions = [
    { id: 'surface', prompt: 'Which surface?' },
    {
      id: 'mobile-mode',
      prompt: 'Which mobile mode?',
      when: { surface: 'mobile' },
    },
    {
      id: 'desktop-mode',
      prompt: 'Which desktop mode?',
      when: { surface: 'desktop' },
    },
  ];
  const plan = planClarification({
    round: 1,
    precedingState: 'radar:proposed',
    questions,
    answers: { surface: 'mobile' },
  });
  assert.deepEqual(
    plan.questions.map(question => question.id),
    ['mobile-mode']
  );
});

test('unresolved clarification blocks after round two and restores state when complete', () => {
  const question = {
    id: 'mode',
    prompt: 'Choose a mode',
    choices: ['safe', 'fast'],
    recommended: 'safe',
  };
  assert.equal(
    planClarification({
      round: 2,
      precedingState: 'radar:accepted',
      questions: [question],
      answers: {},
    }).state,
    'radar:blocked'
  );
  assert.equal(
    planClarification({
      round: 2,
      precedingState: 'radar:accepted',
      questions: [question],
      answers: { mode: 'safe' },
    }).state,
    'radar:accepted'
  );
});

test('versioned markers round trip and retries can reuse event IDs', () => {
  const body = `Readable text\n\n${marker('pomi-radar-event:v1', { id: 'dedup:20:21' })}`;
  assert.deepEqual(readMarker(body, 'pomi-radar-event:v1'), {
    id: 'dedup:20:21',
  });
});

test('raw diagnostic issues are held for plain-language card enrichment', () => {
  const gaps = issueEnrichmentGaps({
    title: 'TypeError: Cannot read properties of undefined',
    displayTitle: 'TypeError: Cannot read properties of undefined',
    summary: 'Opening the timer can fail.',
    labels: ['radar:sentry', 'radar:proposed'],
  });
  assert.ok(gaps.includes('displayTitle:raw-diagnostic'));
  assert.ok(gaps.includes('whyNow'));
  assert.ok(gaps.includes('acceptanceCriteria'));
});

test('daily-style issue presentation satisfies every Radar card section', () => {
  const complete = {
    title: completePresentation.displayTitle,
    ...completePresentation,
    labels: ['radar:feature', 'radar:proposed'],
  };
  assert.deepEqual(issueEnrichmentGaps(complete), []);
});

test('plain-language title validation rejects machine output and extremes', () => {
  assert.deepEqual(
    readableTitleProblems('Keep timer controls visible during long sessions'),
    []
  );
  assert.ok(
    readableTitleProblems('ENOTFOUND api.example.com').includes(
      'raw-diagnostic'
    )
  );
  assert.ok(
    readableTitleProblems('Error: Database request failed again').includes(
      'raw-diagnostic'
    )
  );
  assert.ok(readableTitleProblems('Timer').includes('word-count'));
});

test('blank criteria and wordy card sections require enrichment', () => {
  const gaps = issueEnrichmentGaps({
    title: completePresentation.displayTitle,
    ...completePresentation,
    summary: Array.from({ length: 21 }, () => 'word').join(' '),
    acceptanceCriteria: ['   '],
    labels: ['radar:feature', 'radar:proposed'],
  });
  assert.ok(gaps.includes('acceptanceCriteria'));
  assert.ok(gaps.includes('summary:word-count'));
});

test('all actionable canonical states are enriched while duplicates are excluded', () => {
  const accepted = {
    number: 20,
    title: 'Timer controls need a clearer layout',
    state: 'open',
    labels: ['radar:feature', 'radar:accepted'],
  };
  const duplicate = {
    ...accepted,
    number: 21,
    state: 'closed',
    labels: ['radar:feature', 'radar:accepted', 'duplicate'],
    pendingAgentPass: true,
    duplicateOf: 20,
  };
  assert.deepEqual(
    selectActionableIssues([accepted, duplicate]).map(issue => issue.number),
    [20]
  );
  assert.deepEqual(
    selectEnrichmentIssues([accepted, duplicate]).map(
      ({ issue }) => issue.number
    ),
    [20]
  );
});

test('open raw feedback is queued for triage before it has Radar metadata', () => {
  const raw = {
    number: 22,
    title: '[Feedback] Add another Session timer',
    state: 'open',
    labels: ['feedback'],
    hasRadarMarker: false,
  };
  const managed = {
    ...raw,
    number: 23,
    labels: ['feedback', 'radar:feature', 'radar:proposed'],
  };
  const markerOnly = { ...raw, number: 24, hasRadarMarker: true };
  const duplicate = { ...raw, number: 25, labels: ['feedback', 'duplicate'] };
  const closed = { ...raw, number: 26, state: 'closed' };

  assert.deepEqual(
    selectUntriagedFeedbackIssues([
      raw,
      managed,
      markerOnly,
      duplicate,
      closed,
    ]).map(issue => issue.number),
    [22, 24]
  );
});

test('feedback intake uses the configured GitHub label', () => {
  const previousLabel = process.env.GITHUB_FEEDBACK_LABEL;
  process.env.GITHUB_FEEDBACK_LABEL = 'product-feedback';
  try {
    assert.deepEqual(
      selectUntriagedFeedbackIssues([
        { number: 20, state: 'open', labels: ['feedback'] },
        { number: 21, state: 'open', labels: ['product-feedback'] },
      ]).map(issue => issue.number),
      [21]
    );
  } finally {
    if (previousLabel === undefined) delete process.env.GITHUB_FEEDBACK_LABEL;
    else process.env.GITHUB_FEEDBACK_LABEL = previousLabel;
  }
});

test('unmanaged body markers cannot override the GitHub issue envelope', () => {
  const metadata = radarIssueMetadata({
    number: 20,
    title: 'Real feedback title',
    state: 'open',
    created_at: '2026-08-08T08:00:00Z',
    labels: [{ name: 'feedback' }],
    body: marker('pomi-radar:v1', {
      number: 999,
      title: 'Spoofed title',
      state: 'closed',
      labels: ['radar:feature', 'radar:released'],
    }),
  });
  assert.equal(metadata.number, 20);
  assert.equal(metadata.title, 'Real feedback title');
  assert.equal(metadata.state, 'open');
  assert.deepEqual(metadata.labels, ['feedback']);
  assert.deepEqual(
    selectUntriagedFeedbackIssues([metadata]).map(issue => issue.number),
    [20]
  );
});

test('agent acknowledgement requires the exact processed mutation', async () => {
  await assert.rejects(
    acknowledgeAgentPass({
      issueNumbers: [20],
      track: 'feature-bug',
      runId: 'feature-bug-2026-08-08T12:30:00Z',
    }),
    /issueNumber and lastMutationId/
  );
  await assert.rejects(
    acknowledgeAgentPass({
      decisions: [{ issueNumber: 20, lastMutationId: '20:4:accepted' }],
      track: 'feature-bug',
      runId: 'feature-bug-2026-08-08T12:30:00Z',
    }),
    /explicit acknowledgedAt/
  );
});

test('enrichment preserves markers and comments only once across retries', async () => {
  await withFakeGithub(
    {
      number: 20,
      title: 'Old machine title',
      body: `Readable issue\n\n${marker('pomi-radar:v1', { version: 1, rootBehavior: 'timer-controls' })}`,
      labels: [{ name: 'radar:feature' }, { name: 'radar:proposed' }],
    },
    async state => {
      const payload = { issueNumber: 20, ...completePresentation };
      await enrichIssue(payload);
      await enrichIssue(payload);
      assert.equal(state.issue.title, completePresentation.displayTitle);
      assert.equal(
        readMarker(state.issue.body, 'pomi-radar:v1').rootBehavior,
        'timer-controls'
      );
      assert.equal(state.comments.length, 1);
      assert.match(state.comments[0].body, /Radar presentation refreshed/);
    }
  );
});

test('enrichment can initialize deterministic feedback source metadata', async () => {
  await withFakeGithub(
    {
      number: 20,
      title: '[Feedback] Timer controls disappear',
      body: 'Submitted from Pomi feedback.',
      labels: [
        { name: 'feedback' },
        { name: 'radar:bug' },
        { name: 'radar:proposed' },
      ],
    },
    async state => {
      await enrichIssue({
        issueNumber: 20,
        ...completePresentation,
        kind: 'bug',
        source: 'user_feedback',
        sourceId: 'github-feedback:20',
        sourceIds: ['github-feedback:20'],
        rootBehavior: 'timer controls disappear during long sessions',
      });
      const data = readMarker(state.issue.body, 'pomi-radar:v1');
      assert.equal(data.kind, 'bug');
      assert.equal(data.sourceId, 'github-feedback:20');
      assert.equal(
        data.rootBehavior,
        'timer controls disappear during long sessions'
      );
    }
  );
});

test('enrichment preserves immutable metadata and merges source IDs', async () => {
  await withFakeGithub(
    {
      number: 20,
      title: 'Old machine title',
      body: marker('pomi-radar:v1', {
        version: 1,
        kind: 'bug',
        source: 'user_feedback',
        sourceId: 'github-feedback:20',
        sourceIds: ['github-feedback:20'],
        rootBehavior: 'timer-controls',
      }),
      labels: [{ name: 'radar:bug' }, { name: 'radar:proposed' }],
    },
    async state => {
      await enrichIssue({
        issueNumber: 20,
        ...completePresentation,
        kind: 'bug',
        source: 'user_feedback',
        sourceId: 'github-feedback:20',
        sourceIds: ['github-feedback:21'],
        rootBehavior: 'timer-controls',
      });
      assert.deepEqual(
        readMarker(state.issue.body, 'pomi-radar:v1').sourceIds,
        ['github-feedback:20', 'github-feedback:21']
      );
      await assert.rejects(
        enrichIssue({
          issueNumber: 20,
          ...completePresentation,
          sourceId: 'github-feedback:999',
        }),
        /cannot replace immutable sourceId/
      );
    }
  );
});

test('enrichment rejects duplicate issues', async () => {
  await withFakeGithub(
    {
      number: 20,
      title: 'Duplicate timer report',
      body: marker('pomi-radar:v1', { version: 1, duplicateOf: 19 }),
      labels: [{ name: 'radar:feature' }, { name: 'duplicate' }],
    },
    async () => {
      await assert.rejects(
        enrichIssue({ issueNumber: 20, ...completePresentation }),
        /not an eligible canonical Radar issue/
      );
    }
  );
});

test('agent acknowledgement is idempotent and preserves newer decisions', async () => {
  const decision = '20:4:accepted';
  await withFakeGithub(
    {
      number: 20,
      title: completePresentation.displayTitle,
      body: marker('pomi-radar:v1', {
        version: 1,
        pendingAgentPass: true,
        lastMutationId: decision,
      }),
      labels: [{ name: 'radar:feature' }, { name: 'radar:accepted' }],
    },
    async state => {
      const payload = {
        decisions: [{ issueNumber: 20, lastMutationId: decision }],
        track: 'feature-bug',
        runId: 'feature-bug-2026-08-08T12:30:00Z',
        acknowledgedAt: '2026-08-08T12:30:00.000Z',
      };
      await acknowledgeAgentPass(payload);
      await acknowledgeAgentPass(payload);
      assert.equal(
        readMarker(state.issue.body, 'pomi-radar:v1').pendingAgentPass,
        false
      );
      assert.equal(state.comments.length, 1);
    }
  );

  await withFakeGithub(
    {
      number: 20,
      title: completePresentation.displayTitle,
      body: marker('pomi-radar:v1', {
        version: 1,
        pendingAgentPass: true,
        lastMutationId: '20:5:rejected',
      }),
      labels: [{ name: 'radar:feature' }, { name: 'radar:rejected' }],
    },
    async state => {
      await assert.rejects(
        acknowledgeAgentPass({
          decisions: [{ issueNumber: 20, lastMutationId: decision }],
          track: 'feature-bug',
          runId: 'feature-bug-2026-08-08T12:30:00Z',
          acknowledgedAt: '2026-08-08T12:30:00.000Z',
        }),
        /newer Radar decision/
      );
      assert.equal(
        readMarker(state.issue.body, 'pomi-radar:v1').pendingAgentPass,
        true
      );
    }
  );
});

test('duplicate reconciliation preserves immutable IDs and is idempotent', async () => {
  await withFakeGithubIssues(
    [
      {
        number: 20,
        created_at: '2026-08-07T08:00:00Z',
        state: 'open',
        body: marker('pomi-radar:v1', {
          version: 1,
          kind: 'bug',
          sourceId: 'github-feedback:20',
          sourceIds: ['github-feedback:20'],
          sentryGroupIds: ['100'],
          rootBehavior: 'timer-controls',
        }),
        labels: [{ name: 'radar:bug' }, { name: 'radar:in-review' }],
      },
      {
        number: 21,
        created_at: '2026-08-08T08:00:00Z',
        state: 'open',
        body: marker('pomi-radar:v1', {
          version: 1,
          kind: 'bug',
          sourceId: 'sentry:200',
          sourceIds: ['sentry:200', 'github-feedback:21'],
          sentryGroupIds: ['200'],
          rootBehavior: 'timer-controls',
        }),
        labels: [{ name: 'radar:sentry' }, { name: 'radar:proposed' }],
      },
    ],
    async state => {
      const payload = { canonicalIssueNumber: 20, duplicateIssueNumber: 21 };
      await reconcileDuplicate(payload);
      await reconcileDuplicate(payload);
      const canonicalData = readMarker(
        state.issues.get(20).body,
        'pomi-radar:v1'
      );
      const duplicate = state.issues.get(21);
      assert.deepEqual(canonicalData.sourceIds, [
        'github-feedback:20',
        'sentry:200',
        'github-feedback:21',
      ]);
      assert.deepEqual(canonicalData.sentryGroupIds, ['100', '200']);
      assert.equal(readMarker(duplicate.body, 'pomi-radar:v1').duplicateOf, 20);
      assert.equal(duplicate.state, 'closed');
      assert.deepEqual(
        duplicate.labels
          .map(label => label.name)
          .filter(
            label =>
              label.startsWith('radar:') &&
              ['radar:feature', 'radar:bug', 'radar:sentry'].includes(label)
          ),
        ['radar:sentry']
      );
      assert.equal(state.comments.get(20).length, 1);
      assert.equal(state.comments.get(21).length, 1);
    }
  );
});

test('duplicate reconciliation remains discoverable when the final close fails', async () => {
  await withFakeGithubIssues(
    [
      {
        number: 20,
        created_at: '2026-08-07T08:00:00Z',
        state: 'open',
        body: marker('pomi-radar:v1', {
          version: 1,
          sourceId: 'github-feedback:20',
          rootBehavior: 'timer-controls',
        }),
        labels: [{ name: 'radar:feature' }, { name: 'radar:proposed' }],
      },
      {
        number: 21,
        created_at: '2026-08-08T08:00:00Z',
        state: 'open',
        body: 'Raw feedback',
        labels: [{ name: 'feedback' }],
      },
    ],
    async state => {
      const payload = { canonicalIssueNumber: 20, duplicateIssueNumber: 21 };
      await assert.rejects(
        reconcileDuplicate(payload),
        /GitHub PATCH \/issues\/21 failed/
      );
      const interrupted = state.issues.get(21);
      assert.equal(interrupted.state, 'open');
      assert.equal(readMarker(interrupted.body, 'pomi-radar:v1'), null);
      assert.deepEqual(
        selectUntriagedFeedbackIssues([
          {
            number: interrupted.number,
            state: interrupted.state,
            labels: interrupted.labels.map(label => label.name),
          },
        ]).map(issue => issue.number),
        [21]
      );
      await reconcileDuplicate(payload);
      assert.equal(state.issues.get(21).state, 'closed');
      assert.equal(state.comments.get(21).length, 1);
    },
    { failFinalDuplicatePatch: true }
  );
});

test('duplicate regressions reopen released canonicals', async () => {
  await withFakeGithubIssues(
    [
      {
        number: 20,
        created_at: '2026-08-07T08:00:00Z',
        state: 'closed',
        body: marker('pomi-radar:v1', {
          version: 1,
          rootBehavior: 'timer-controls',
        }),
        labels: [{ name: 'radar:bug' }, { name: 'radar:released' }],
      },
      {
        number: 21,
        created_at: '2026-08-08T08:00:00Z',
        state: 'open',
        body: 'Regression report',
        labels: [{ name: 'feedback' }],
      },
    ],
    async state => {
      await reconcileDuplicate({
        canonicalIssueNumber: 20,
        duplicateIssueNumber: 21,
      });
      const canonical = state.issues.get(20);
      assert.equal(canonical.state, 'open');
      assert.ok(
        canonical.labels.some(label => label.name === 'radar:proposed')
      );
      assert.ok(
        !canonical.labels.some(label => label.name === 'radar:released')
      );
      assert.equal(state.comments.get(20).length, 2);
    }
  );
});

test('duplicate reconciliation rejects ambiguous canonical lifecycle state', async () => {
  await withFakeGithubIssues(
    [
      {
        number: 20,
        created_at: '2026-08-07T08:00:00Z',
        state: 'open',
        body: marker('pomi-radar:v1', { version: 1 }),
        labels: [
          { name: 'radar:bug' },
          { name: 'radar:proposed' },
          { name: 'radar:accepted' },
        ],
      },
      {
        number: 21,
        created_at: '2026-08-08T08:00:00Z',
        state: 'open',
        body: 'Duplicate report',
        labels: [{ name: 'feedback' }],
      },
    ],
    async () => {
      await assert.rejects(
        reconcileDuplicate({
          canonicalIssueNumber: 20,
          duplicateIssueNumber: 21,
        }),
        /one source and one lifecycle label/
      );
    }
  );
});

test('a duplicate-only input becomes a true no-op after reconciliation', () => {
  assert.deepEqual(
    deduplicationPlan([
      { ...report, labels: ['radar:feature', 'radar:in-review'] },
      {
        ...report,
        number: 21,
        state: 'closed',
        labels: ['radar:feature', 'radar:in-review', 'duplicate'],
        duplicateOf: 20,
      },
    ]),
    []
  );
  assert.equal(
    preflightHasWork({
      duplicateClusters: [],
      feedbackIssueNumbers: [],
      actionableIssueNumbers: [],
      enrichmentIssueNumbers: [],
      sourcePulls: [],
      unmappedSentry: [],
      shouldGenerate: false,
    }),
    false
  );
});

test('proposal availability replenishes individual slots across runs', () => {
  const proposal = ({
    number,
    lifecycle = 'radar:proposed',
    pendingAgentPass = false,
    state = 'open',
    generatedAt,
    duplicateOf,
  }) => ({
    number,
    state,
    generatedAt,
    rank: number,
    pendingAgentPass,
    duplicateOf,
    labels: ['radar:performance', lifecycle],
  });
  const proposed = [
    proposal({ number: 1, generatedAt: '2026-08-01T00:00:00Z' }),
    proposal({ number: 2, generatedAt: '2026-08-02T00:00:00Z' }),
    proposal({ number: 3, generatedAt: '2026-08-03T00:00:00Z' }),
  ];

  assert.deepEqual(proposalSlotPlan(proposed), {
    visibleProposalCount: 3,
    visibleProposalIssueNumbers: [3, 2, 1],
    proposalSlotsNeeded: 0,
  });

  assert.deepEqual(
    proposalSlotPlan([
      proposed[0],
      proposed[1],
      proposal({
        number: 3,
        lifecycle: 'radar:in-progress',
        generatedAt: '2026-08-03T00:00:00Z',
      }),
    ]),
    {
      visibleProposalCount: 2,
      visibleProposalIssueNumbers: [2, 1],
      proposalSlotsNeeded: 1,
    }
  );

  assert.equal(
    proposalSlotPlan([
      proposed[0],
      proposal({
        number: 2,
        lifecycle: 'radar:in-progress',
        generatedAt: '2026-08-02T00:00:00Z',
      }),
      proposal({
        number: 3,
        lifecycle: 'radar:rejected',
        state: 'closed',
        generatedAt: '2026-08-03T00:00:00Z',
      }),
    ]).proposalSlotsNeeded,
    2
  );

  assert.equal(
    proposalSlotPlan([
      proposed[0],
      proposed[1],
      proposal({
        number: 3,
        lifecycle: 'radar:in-progress',
        pendingAgentPass: true,
        generatedAt: '2026-08-03T00:00:00Z',
      }),
    ]).proposalSlotsNeeded,
    0
  );

  assert.equal(
    proposalSlotPlan([
      ...proposed,
      proposal({
        number: 4,
        generatedAt: '2026-08-04T00:00:00Z',
        duplicateOf: 3,
      }),
    ]).visibleProposalCount,
    3
  );
});

test('daily Feature availability releases its slot when implementation starts', () => {
  const feature = ({
    number,
    lifecycle = 'radar:proposed',
    pendingAgentPass = false,
    state = 'open',
    duplicateOf,
  }) => ({
    number,
    state,
    source: 'daily_feature',
    pendingAgentPass,
    duplicateOf,
    labels: ['radar:feature', lifecycle],
  });

  assert.deepEqual(dailyFeatureSlotPlan([feature({ number: 173 })]), {
    visibleProposalCount: 1,
    visibleProposalIssueNumbers: [173],
    proposalSlotsNeeded: 0,
  });
  assert.equal(
    dailyFeatureSlotPlan([
      feature({
        number: 173,
        lifecycle: 'radar:accepted',
        pendingAgentPass: true,
      }),
    ]).proposalSlotsNeeded,
    0
  );
  assert.deepEqual(
    dailyFeatureSlotPlan([
      feature({ number: 173, lifecycle: 'radar:in-review' }),
    ]),
    {
      visibleProposalCount: 0,
      visibleProposalIssueNumbers: [],
      proposalSlotsNeeded: 1,
    }
  );
  assert.equal(
    dailyFeatureSlotPlan([
      feature({ number: 173, lifecycle: 'radar:in-review' }),
      feature({ number: 174, lifecycle: 'radar:proposed', duplicateOf: 173 }),
    ]).proposalSlotsNeeded,
    1
  );
});

test('untriaged feedback prevents a false no-work result', () => {
  assert.equal(
    preflightHasWork({
      duplicateClusters: [],
      feedbackIssueNumbers: [22],
      actionableIssueNumbers: [],
      enrichmentIssueNumbers: [],
      sourcePulls: [],
      unmappedSentry: [],
      shouldGenerate: false,
    }),
    true
  );
});

test('released canonicals reopen for regressions while rejected canonicals require reconsideration', () => {
  const regression = {
    ...report,
    number: 19,
    state: 'closed',
    labels: ['radar:released'],
  };
  const repeated = {
    ...report,
    number: 21,
    state: 'open',
    labels: ['radar:proposed'],
  };
  assert.equal(
    deduplicationPlan([regression, repeated])[0].canonical.number,
    19
  );
  assert.equal(
    deduplicationPlan([regression, repeated])[0].canonicalAction,
    'reopen-regression'
  );

  const rejected = { ...regression, labels: ['radar:rejected'] };
  assert.equal(
    deduplicationPlan([rejected, repeated])[0].canonicalAction,
    'verify-rejection-invalidated'
  );
});

test('missing Sentry configuration prevents a successful no-op', () => {
  assert.equal(
    preflightHasWork({
      duplicateClusters: [],
      actionableIssueNumbers: [],
      enrichmentIssueNumbers: [],
      sourcePulls: [],
      unmappedSentry: [],
      sentryConfigurationMissing: ['SENTRY_AUTH_TOKEN'],
      shouldGenerate: false,
    }),
    true
  );
});
