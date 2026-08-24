#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import {
  getGitHubAppAuthentication,
  githubRequest,
} from './github-app-auth.mjs';
import { loadAutomationEnvironment } from './local-env.mjs';
import {
  assertSafeMigrationText,
  MIGRATION_MARKER as ISSUE_MIGRATION_MARKER,
} from './migrate-private-radar.mjs';

export const PULL_MIGRATION_MARKER = 'pomi-pull-migration:v1';
const PERSONAL_EXCEPTION = 222;

function marker(sourceRepository, sourcePull) {
  return `<!-- ${PULL_MIGRATION_MARKER} ${JSON.stringify({
    sourceRepository,
    sourcePull,
  })} -->`;
}

async function api(pathname, token, options = {}) {
  return githubRequest(pathname, { token, ...options });
}

async function listPages(pathname, token) {
  const separator = pathname.includes('?') ? '&' : '?';
  const values = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(
      `${pathname}${separator}per_page=100&page=${page}`,
      token
    );
    values.push(...batch);
    if (batch.length < 100) return values;
  }
}

function readMarker(body, name) {
  const match = String(body || '').match(
    new RegExp(`<!--\\s*${name.replace(':', '\\:')}\\s+(\\{[^]*?\\})\\s*-->`)
  );
  return match ? JSON.parse(match[1]) : null;
}

export function translatedPullBody(
  pull,
  sourceRepository,
  issueNumberMap = new Map()
) {
  let body = pull.body || '';
  const sourceMarker = readMarker(body, 'pomi-radar-source:v1');
  if (sourceMarker?.issues) {
    const translatedIssues = sourceMarker.issues.map(number => {
      const destination = issueNumberMap.get(Number(number));
      if (!destination) {
        throw new Error(
          `Private PR #${pull.number} references issue #${number}, which has not been migrated.`
        );
      }
      return destination;
    });
    const translatedMarker = `<!-- pomi-radar-source:v1 ${JSON.stringify({
      ...sourceMarker,
      issues: translatedIssues,
    })} -->`;
    body = body.replace(
      /<!--\s*pomi-radar-source:v1\s+\{[^]*?\}\s*-->/,
      translatedMarker
    );
  }
  body = body.replace(
    /https:\/\/github\.com\/NeoHuncho\/pomi-private\/issues\/(\d+)/g,
    (url, number) => {
      const destination = issueNumberMap.get(Number(number));
      return destination
        ? `https://github.com/Host-It-Labs/pomi/issues/${destination}`
        : url;
    }
  );
  return [
    body,
    '',
    '---',
    `Migrated from private PR [${sourceRepository}#${pull.number}](${pull.html_url}).`,
    marker(sourceRepository, pull.number),
  ].join('\n');
}

export function archivedDiscussionBody(
  item,
  { sourceRepository, sourcePull, kind }
) {
  const location = item.path
    ? `\n- Path: \`${item.path}\`${item.line ? `, line ${item.line}` : ''}${
        item.original_line ? `, original line ${item.original_line}` : ''
      }`
    : '';
  return [
    `Archived ${kind} by @${item.user?.login || 'unknown'} from ${sourceRepository}#${sourcePull}.`,
    `- Created: ${item.created_at || item.submitted_at || 'unknown'}${location}`,
    '',
    item.body || '(No written body.)',
    '',
    `<!-- ${PULL_MIGRATION_MARKER}:discussion ${JSON.stringify({
      sourceRepository,
      sourcePull,
      kind,
      sourceId: item.id,
    })} -->`,
  ].join('\n');
}

async function issueNumberMap(repository, sourceRepository, token) {
  const issues = await listPages(
    `/repos/${repository}/issues?state=all`,
    token
  );
  return new Map(
    issues.flatMap(issue => {
      if (issue.pull_request) return [];
      const migration = readMarker(issue.body, ISSUE_MIGRATION_MARKER);
      return migration?.sourceRepository === sourceRepository
        ? [[Number(migration.sourceIssue), issue.number]]
        : [];
    })
  );
}

async function ensureLabels(repository, labels, token) {
  const existing = new Set(
    (await listPages(`/repos/${repository}/labels`, token)).map(
      label => label.name
    )
  );
  for (const label of labels) {
    if (existing.has(label.name)) continue;
    await api(`/repos/${repository}/labels`, token, {
      method: 'POST',
      body: {
        name: label.name,
        color: label.color || '6f42c1',
        description: label.description || 'Migrated private PR label',
      },
    });
    existing.add(label.name);
  }
}

async function sourcePullData(repository, number, token) {
  const [pull, comments, reviews, reviewComments] = await Promise.all([
    api(`/repos/${repository}/pulls/${number}`, token),
    listPages(`/repos/${repository}/issues/${number}/comments`, token),
    listPages(`/repos/${repository}/pulls/${number}/reviews`, token),
    listPages(`/repos/${repository}/pulls/${number}/comments`, token),
  ]);
  return { pull, comments, reviews, reviewComments };
}

function validateSource(data) {
  assertSafeMigrationText(
    data.pull.title,
    `Source PR #${data.pull.number} title`
  );
  assertSafeMigrationText(
    data.pull.body,
    `Source PR #${data.pull.number} body`
  );
  for (const [kind, values] of [
    ['comment', data.comments],
    ['review', data.reviews],
    ['review comment', data.reviewComments],
  ]) {
    for (const value of values) {
      assertSafeMigrationText(
        value.body,
        `Source PR #${data.pull.number} ${kind} ${value.id}`
      );
    }
  }
}

function snapshot(data) {
  return JSON.stringify({
    pull: {
      title: data.pull.title,
      body: data.pull.body,
      state: data.pull.state,
      head: data.pull.head.sha,
      labels: data.pull.labels.map(label => label.name),
    },
    comments: data.comments.map(value => [value.id, value.body]),
    reviews: data.reviews.map(value => [value.id, value.body, value.state]),
    reviewComments: data.reviewComments.map(value => [value.id, value.body]),
  });
}

async function migratePull({
  number,
  head,
  dryRun,
  sourceRepository,
  destinationRepository,
  sourceToken,
  destinationToken,
  expectedAuthor,
  botToken,
  botLogin,
}) {
  const source = await sourcePullData(sourceRepository, number, sourceToken);
  validateSource(source);
  const before = snapshot(source);
  const map = await issueNumberMap(
    destinationRepository,
    sourceRepository,
    destinationToken
  );
  const body = translatedPullBody(source.pull, sourceRepository, map);
  const discussions = [
    ...source.comments.map(item => ({ item, kind: 'issue comment' })),
    ...source.reviews.map(item => ({ item, kind: 'review' })),
    ...source.reviewComments.map(item => ({
      item,
      kind: 'inline review comment',
    })),
  ];
  const summary = {
    source: `${sourceRepository}#${number}`,
    title: source.pull.title,
    head,
    labels: source.pull.labels.map(label => label.name),
    discussions: discussions.length,
    expectedAuthor,
  };
  if (dryRun) return summary;
  if (!head)
    throw new Error(`Public head branch is required for PR #${number}.`);

  const existing = (
    await listPages(
      `/repos/${destinationRepository}/pulls?state=all`,
      destinationToken
    )
  ).find(pull => pull.body?.includes(marker(sourceRepository, number)));
  const destinationPull =
    existing ||
    (await api(`/repos/${destinationRepository}/pulls`, destinationToken, {
      method: 'POST',
      body: {
        title: source.pull.title,
        body,
        head,
        base: 'main',
        draft: false,
      },
    }));
  if (destinationPull.user?.login !== expectedAuthor) {
    throw new Error(
      `Public PR #${destinationPull.number} author ${destinationPull.user?.login || 'unknown'} did not match ${expectedAuthor}.`
    );
  }
  await api(
    `/repos/${destinationRepository}/pulls/${destinationPull.number}`,
    destinationToken,
    { method: 'PATCH', body: { title: source.pull.title, body } }
  );
  await ensureLabels(
    destinationRepository,
    source.pull.labels,
    destinationToken
  );
  if (source.pull.labels.length > 0) {
    await api(
      `/repos/${destinationRepository}/issues/${destinationPull.number}`,
      destinationToken,
      {
        method: 'PATCH',
        body: { labels: source.pull.labels.map(label => label.name) },
      }
    );
  }

  const existingComments = await listPages(
    `/repos/${destinationRepository}/issues/${destinationPull.number}/comments`,
    botToken
  );
  const existingIds = new Set(
    existingComments.flatMap(comment => {
      const migration = readMarker(
        comment.body,
        `${PULL_MIGRATION_MARKER}:discussion`
      );
      return migration ? [`${migration.kind}:${migration.sourceId}`] : [];
    })
  );
  for (const { item, kind } of discussions) {
    const id = `${kind}:${item.id}`;
    if (existingIds.has(id)) continue;
    const created = await api(
      `/repos/${destinationRepository}/issues/${destinationPull.number}/comments`,
      botToken,
      {
        method: 'POST',
        body: {
          body: archivedDiscussionBody(item, {
            sourceRepository,
            sourcePull: number,
            kind,
          }),
        },
      }
    );
    if (created.user?.login !== botLogin) {
      throw new Error(
        `Archived PR discussion was not authored by ${botLogin}.`
      );
    }
  }
  const after = await sourcePullData(sourceRepository, number, sourceToken);
  if (snapshot(after) !== before) {
    throw new Error(`Private source PR #${number} changed during migration.`);
  }
  return { ...summary, url: destinationPull.html_url, sourceUnchanged: true };
}

async function run() {
  loadAutomationEnvironment();
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const pullIndex = process.argv.indexOf('--pr');
  const headIndex = process.argv.indexOf('--head');
  const number = pullIndex >= 0 ? Number(process.argv[pullIndex + 1]) : null;
  const head = headIndex >= 0 ? process.argv[headIndex + 1] : null;
  if (!number) throw new Error('Specify --pr <number>.');
  const sourceRepository =
    process.env.POMI_RADAR_SOURCE_GITHUB_REPOSITORY || 'NeoHuncho/pomi-private';
  const destinationRepository =
    process.env.POMI_RADAR_GITHUB_REPOSITORY || 'Host-It-Labs/pomi';
  const sourceToken = process.env.POMI_RADAR_SOURCE_GITHUB_TOKEN?.trim();
  if (!sourceToken)
    throw new Error('POMI_RADAR_SOURCE_GITHUB_TOKEN is required.');
  const bot = await getGitHubAppAuthentication();
  const personal = number === PERSONAL_EXCEPTION;
  const personalToken = process.env.POMI_RADAR_PERSONAL_GITHUB_TOKEN?.trim();
  if (personal && !dryRun && !personalToken) {
    throw new Error(
      'POMI_RADAR_PERSONAL_GITHUB_TOKEN is required for PR #222.'
    );
  }
  let destinationToken = bot.token;
  let expectedAuthor = bot.botLogin;
  if (personal && !dryRun) {
    const user = await api('/user', personalToken);
    if (user.login !== 'NeoHuncho') {
      throw new Error('PR #222 personal token must belong to NeoHuncho.');
    }
    destinationToken = personalToken;
    expectedAuthor = 'NeoHuncho';
  }
  const result = await migratePull({
    number,
    head,
    dryRun,
    sourceRepository,
    destinationRepository,
    sourceToken,
    destinationToken,
    expectedAuthor,
    botToken: bot.token,
    botLogin: bot.botLogin,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
