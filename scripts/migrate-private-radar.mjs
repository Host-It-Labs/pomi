#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import {
  getGitHubAppAuthentication,
  githubRequest,
} from './github-app-auth.mjs';
import { loadAutomationEnvironment } from './local-env.mjs';

export const MIGRATION_MARKER = 'pomi-radar-migration:v1';
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
];
const LIFECYCLE_LABELS = new Set([
  'radar:proposed',
  'radar:needs-agent',
  'radar:needs-user',
  'radar:accepted',
  'radar:in-progress',
  'radar:in-review',
  'radar:already-implemented',
  'radar:ready-for-release',
  'radar:blocked',
  'radar:released',
  'radar:rejected',
]);

export function migrationMarker(sourceRepository, sourceIssue) {
  return `<!-- ${MIGRATION_MARKER} ${JSON.stringify({
    sourceRepository,
    sourceIssue,
  })} -->`;
}

export function migratedIssueBody(issue, sourceRepository) {
  const sourceUrl = `https://github.com/${sourceRepository}/issues/${issue.number}`;
  return [
    issue.body || '',
    '',
    '---',
    `Originally opened by @${issue.user?.login || 'unknown'}.`,
    `Migrated by Pomi Radar from private issue [${sourceRepository}#${issue.number}](${sourceUrl}).`,
    migrationMarker(sourceRepository, issue.number),
  ].join('\n');
}

export function assertSafeMigrationText(value, context) {
  const text = String(value || '');
  if (SECRET_PATTERNS.some(pattern => pattern.test(text))) {
    throw new Error(
      `${context} contains credential-like material; migration stopped.`
    );
  }
}

export function migratedCommentBody(comment, sourceRepository, sourceIssue) {
  return [
    `Migrated comment by @${comment.user?.login || 'unknown'} from ${sourceRepository}#${sourceIssue} (${comment.created_at}).`,
    '',
    comment.body || '',
    '',
    `<!-- ${MIGRATION_MARKER}:comment ${JSON.stringify({
      sourceRepository,
      sourceIssue,
      sourceComment: comment.id,
    })} -->`,
  ].join('\n');
}

export function translatedLabels(labels, comments = []) {
  const names = labels.map(label => label.name || label);
  const hasPrivatePullRequest = comments.some(comment =>
    /github\.com\/NeoHuncho\/pomi-private\/pull\/\d+/i.test(comment.body || '')
  );
  if (!hasPrivatePullRequest) return names;
  if (
    !names.some(name =>
      [
        'radar:in-progress',
        'radar:in-review',
        'radar:ready-for-release',
      ].includes(name)
    )
  ) {
    return names;
  }
  return [
    ...names.filter(name => !LIFECYCLE_LABELS.has(name)),
    'radar:needs-agent',
  ];
}

function sourceSnapshot(issue, comments) {
  return JSON.stringify({
    title: issue.title,
    body: issue.body,
    state: issue.state,
    stateReason: issue.state_reason,
    labels: issue.labels.map(label => label.name || label),
    comments: comments.map(comment => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.created_at,
      author: comment.user?.login,
    })),
  });
}

function validateIssueSafety(issue, comments) {
  assertSafeMigrationText(issue.title, `Source issue #${issue.number} title`);
  assertSafeMigrationText(issue.body, `Source issue #${issue.number} body`);
  for (const comment of comments) {
    assertSafeMigrationText(
      comment.body,
      `Source issue #${issue.number} comment ${comment.id}`
    );
  }
}

async function api(pathname, token, options = {}) {
  return githubRequest(pathname, { token, ...options });
}

async function listAllIssues(repository, token, state = 'all') {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(
      `/repos/${repository}/issues?state=${state}&per_page=100&page=${page}`,
      token
    );
    issues.push(...batch.filter(issue => !issue.pull_request));
    if (batch.length < 100) return issues;
  }
}

async function listAllComments(repository, issueNumber, token) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(
      `/repos/${repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      token
    );
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
}

async function ensureLabels(repository, labels, token) {
  const existing = await api(`/repos/${repository}/labels?per_page=100`, token);
  const existingNames = new Set(existing.map(label => label.name));
  for (const label of labels) {
    const name = label.name || label;
    if (existingNames.has(name)) continue;
    await api(`/repos/${repository}/labels`, token, {
      method: 'POST',
      body: {
        name,
        color: label.color || '6f42c1',
        description: label.description || 'Migrated Pomi Radar label',
      },
    });
    existingNames.add(name);
  }
}

async function migrateIssue({
  number,
  dryRun,
  sourceRepository,
  destinationRepository,
  sourceToken,
  destinationToken,
  botLogin,
}) {
  const issue = await api(
    `/repos/${sourceRepository}/issues/${number}`,
    sourceToken
  );
  const comments = await listAllComments(sourceRepository, number, sourceToken);
  validateIssueSafety(issue, comments);
  const labels = translatedLabels(issue.labels, [
    { body: issue.body },
    ...comments,
  ]);
  const body = migratedIssueBody(issue, sourceRepository);
  const beforeSourceSnapshot = sourceSnapshot(issue, comments);
  const existing = (
    await listAllIssues(destinationRepository, destinationToken)
  ).find(candidate =>
    candidate.body?.includes(migrationMarker(sourceRepository, number))
  );
  const summary = {
    source: `${sourceRepository}#${number}`,
    existing: existing?.html_url || null,
    title: issue.title,
    state: issue.state,
    stateReason: issue.state_reason,
    labels,
    body,
    comments: comments.map(comment =>
      migratedCommentBody(comment, sourceRepository, number)
    ),
  };
  if (dryRun) return summary;

  await ensureLabels(destinationRepository, issue.labels, destinationToken);
  if (!labels.includes('radar:needs-agent')) {
    await ensureLabels(
      destinationRepository,
      labels.map(name => ({ name })),
      destinationToken
    );
  } else {
    await ensureLabels(
      destinationRepository,
      [{ name: 'radar:needs-agent', color: 'd4c5f9' }],
      destinationToken
    );
  }
  const destinationIssue =
    existing ||
    (await api(`/repos/${destinationRepository}/issues`, destinationToken, {
      method: 'POST',
      body: { title: issue.title, body, labels },
    }));
  if (destinationIssue.user?.login !== botLogin) {
    throw new Error(
      `Pilot issue author ${destinationIssue.user?.login || 'unknown'} did not match ${botLogin}`
    );
  }
  const reconciledIssue = await api(
    `/repos/${destinationRepository}/issues/${destinationIssue.number}`,
    destinationToken,
    {
      method: 'PATCH',
      body: {
        title: issue.title,
        body,
        labels,
        ...(issue.state === 'open' ? { state: 'open' } : {}),
      },
    }
  );
  if (reconciledIssue.user?.login !== botLogin) {
    throw new Error(`Migrated issue was not authored by ${botLogin}`);
  }
  const destinationLabels = new Set(
    reconciledIssue.labels.map(label => label.name || label)
  );
  const missingLabels = labels.filter(label => !destinationLabels.has(label));
  if (missingLabels.length > 0) {
    throw new Error(
      `Migrated issue is missing labels: ${missingLabels.join(', ')}`
    );
  }
  if (
    !reconciledIssue.body?.includes(migrationMarker(sourceRepository, number))
  ) {
    throw new Error('Migrated issue is missing its stable source marker.');
  }

  const destinationComments = await listAllComments(
    destinationRepository,
    destinationIssue.number,
    destinationToken
  );
  const existingCommentIds = new Set(
    destinationComments.flatMap(comment => {
      const match = comment.body?.match(
        /pomi-radar-migration:v1:comment\s+(\{[^]*?\})/m
      );
      if (!match) return [];
      return [JSON.parse(match[1]).sourceComment];
    })
  );
  for (const comment of comments) {
    if (existingCommentIds.has(comment.id)) continue;
    const createdComment = await api(
      `/repos/${destinationRepository}/issues/${destinationIssue.number}/comments`,
      destinationToken,
      {
        method: 'POST',
        body: { body: migratedCommentBody(comment, sourceRepository, number) },
      }
    );
    if (createdComment.user?.login !== botLogin) {
      throw new Error(`Migrated comment was not authored by ${botLogin}`);
    }
  }
  const verifiedComments = await listAllComments(
    destinationRepository,
    destinationIssue.number,
    destinationToken
  );
  const migratedComments = verifiedComments.filter(comment =>
    comment.body?.includes(`${MIGRATION_MARKER}:comment`)
  );
  const wrongAuthor = migratedComments.find(
    comment => comment.user?.login !== botLogin
  );
  if (wrongAuthor) {
    throw new Error(`Migrated comment was not authored by ${botLogin}`);
  }
  if (issue.state === 'closed') {
    await api(
      `/repos/${destinationRepository}/issues/${destinationIssue.number}`,
      destinationToken,
      {
        method: 'PATCH',
        body: {
          state: 'closed',
          state_reason:
            issue.state_reason === 'not_planned' ? 'not_planned' : 'completed',
        },
      }
    );
  }
  const verifiedIssue = await api(
    `/repos/${destinationRepository}/issues/${destinationIssue.number}`,
    destinationToken
  );
  if (verifiedIssue.state !== issue.state) {
    throw new Error(
      `Migrated issue state did not match source issue #${number}.`
    );
  }
  const [sourceIssueAfter, sourceCommentsAfter] = await Promise.all([
    api(`/repos/${sourceRepository}/issues/${number}`, sourceToken),
    listAllComments(sourceRepository, number, sourceToken),
  ]);
  if (
    sourceSnapshot(sourceIssueAfter, sourceCommentsAfter) !==
    beforeSourceSnapshot
  ) {
    throw new Error('The private source issue changed during migration.');
  }
  return {
    ...summary,
    ...(existing
      ? { existing: destinationIssue.html_url }
      : { created: destinationIssue.html_url }),
    verifiedCommentCount: migratedComments.length,
    sourceUnchanged: true,
  };
}

async function run() {
  loadAutomationEnvironment();
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const issueIndex = process.argv.indexOf('--issue');
  const issueNumber =
    issueIndex >= 0 ? Number(process.argv[issueIndex + 1]) : null;
  const bulk = args.has('--all') && args.has('--confirm-bulk');
  if (!issueNumber && !bulk) {
    throw new Error(
      'Specify --issue <number>, or use --all --confirm-bulk after pilot approval.'
    );
  }
  const sourceRepository =
    process.env.POMI_RADAR_SOURCE_GITHUB_REPOSITORY || 'NeoHuncho/pomi-private';
  const destinationRepository =
    process.env.POMI_RADAR_GITHUB_REPOSITORY || 'Host-It-Labs/pomi';
  const sourceToken = process.env.POMI_RADAR_SOURCE_GITHUB_TOKEN?.trim();
  if (!sourceToken) {
    throw new Error(
      'POMI_RADAR_SOURCE_GITHUB_TOKEN is required for source reads.'
    );
  }
  const authentication = await getGitHubAppAuthentication();
  const numbers = issueNumber
    ? [issueNumber]
    : (await listAllIssues(sourceRepository, sourceToken, 'all')).map(
        issue => issue.number
      );
  if (bulk) {
    for (const number of numbers) {
      const [issue, comments] = await Promise.all([
        api(`/repos/${sourceRepository}/issues/${number}`, sourceToken),
        listAllComments(sourceRepository, number, sourceToken),
      ]);
      validateIssueSafety(issue, comments);
    }
  }
  const results = [];
  for (const number of numbers) {
    results.push(
      await migrateIssue({
        number,
        dryRun,
        sourceRepository,
        destinationRepository,
        sourceToken,
        destinationToken: authentication.token,
        botLogin: authentication.botLogin,
      })
    );
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
