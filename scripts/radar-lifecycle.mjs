#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_GITHUB_APP_BOT_LOGIN,
  EXPECTED_GITHUB_APP_ID,
} from './github-app-auth.mjs';

const ROOT = new URL('../', import.meta.url);
const CONTRACT = JSON.parse(
  readFileSync(new URL('config/radar-lifecycle.json', ROOT), 'utf8')
);

function readJsonStdin() {
  return JSON.parse(readFileSync(0, 'utf8'));
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'when',
  'with',
  'should',
  'could',
  'would',
  'user',
  'users',
  'pomi',
]);

export function marker(name, payload) {
  return `<!-- ${name} ${JSON.stringify(payload)} -->`;
}

export function readMarker(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text ?? '').match(
    new RegExp(`<!--\\s*${escaped}\\s+(\\{[^]*?\\})\\s*-->`)
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value) {
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter(token => token.length > 1 && !STOP_WORDS.has(token))
  );
}

export function similarity(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

function array(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function radarBotLogin() {
  return (
    process.env.POMI_GITHUB_APP_BOT_LOGIN?.trim() ||
    EXPECTED_GITHUB_APP_BOT_LOGIN
  );
}

function immutableIds(item) {
  return new Set(
    [
      ...array(item.sourceIds),
      ...array(item.sentryGroupIds),
      item.sourceId,
      item.sentryGroupId,
    ]
      .filter(Boolean)
      .map(String)
  );
}

function overlaps(left, right) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function combined(item) {
  return [
    item.title,
    item.summary,
    item.observed,
    item.expected,
    ...array(item.acceptanceCriteria),
    ...array(item.reproductionSteps),
    item.platform,
    item.diagnostics,
  ]
    .filter(Boolean)
    .join(' ');
}

export function classifyMatch(candidate, existing) {
  if (overlaps(immutableIds(candidate), immutableIds(existing))) {
    return {
      level: 'exact-source',
      confidence: 1,
      reasons: ['immutable-source-id'],
    };
  }

  const candidateRoot = normalizeText(candidate.rootBehavior);
  const existingRoot = normalizeText(existing.rootBehavior);
  if (candidateRoot && candidateRoot === existingRoot) {
    return {
      level: 'same-root',
      confidence: 1,
      reasons: ['root-behavior-key'],
    };
  }

  const title = similarity(candidate.title, existing.title);
  const behavior = similarity(
    `${candidate.observed ?? ''} ${candidate.expected ?? ''}`,
    `${existing.observed ?? ''} ${existing.expected ?? ''}`
  );
  const all = similarity(combined(candidate), combined(existing));
  const expected = similarity(candidate.expected, existing.expected);
  const sameArea = Boolean(
    normalizeText(candidate.codeArea) &&
    normalizeText(candidate.codeArea) === normalizeText(existing.codeArea)
  );
  const confidence = Number(
    (title * 0.35 + behavior * 0.4 + all * 0.25).toFixed(3)
  );

  if (
    (title >= 0.72 && behavior >= 0.58) ||
    (sameArea && behavior >= 0.68 && all >= 0.58) ||
    (sameArea && expected >= 0.75 && behavior >= 0.5)
  ) {
    return {
      level: 'same-root',
      confidence,
      reasons: [
        sameArea ? 'same-code-area' : null,
        'matching-observed-expected',
      ].filter(Boolean),
    };
  }
  if (sameArea || all >= 0.34 || title >= 0.5) {
    return {
      level: 'related-distinct',
      confidence,
      reasons: [
        sameArea ? 'same-code-area' : null,
        'overlapping-evidence',
      ].filter(Boolean),
    };
  }
  return { level: 'distinct', confidence, reasons: [] };
}

export function selectCanonical(issues) {
  if (!issues.length) return null;
  return [...issues].sort((left, right) => {
    const date =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return date || Number(left.number) - Number(right.number);
  })[0];
}

export function evidenceDelta(candidate, canonical) {
  const fields = [
    ['Reproduction variation', 'reproductionSteps'],
    ['Platform', 'platform'],
    ['Diagnostics', 'diagnostics'],
    ['Timing', 'timing'],
    ['Requested nuance', 'requestedNuance'],
  ];
  const additions = [];
  for (const [label, key] of fields) {
    const next = Array.isArray(candidate[key])
      ? candidate[key].join('; ')
      : candidate[key];
    const previous = Array.isArray(canonical[key])
      ? canonical[key].join('; ')
      : canonical[key];
    if (
      normalizeText(next) &&
      normalizeText(next) !== normalizeText(previous)
    ) {
      additions.push(`- **${label}:** ${String(next).trim()}`);
    }
  }
  const addedCriteria = array(candidate.acceptanceCriteria).filter(
    criterion =>
      !array(canonical.acceptanceCriteria).some(
        existing => normalizeText(existing) === normalizeText(criterion)
      )
  );
  if (addedCriteria.length) {
    additions.push(
      `- **Broadened acceptance criteria:** ${addedCriteria.join('; ')}`
    );
  }
  return additions;
}

export function deduplicationPlan(issues) {
  const ordered = issues
    .filter(
      issue =>
        !(
          issue.state === 'closed' &&
          (issue.duplicateOf || (issue.labels ?? []).includes('duplicate'))
        )
    )
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  const clusters = [];
  const consumed = new Set();
  for (const candidate of ordered) {
    if (consumed.has(candidate.number)) continue;
    const matches = ordered.filter(
      issue =>
        issue.number !== candidate.number &&
        !consumed.has(issue.number) &&
        ['exact-source', 'same-root'].includes(
          classifyMatch(candidate, issue).level
        )
    );
    if (!matches.length) continue;
    const members = [candidate, ...matches];
    const canonical =
      selectCanonical(
        members.filter(
          issue =>
            !issue.duplicateOf && !(issue.labels ?? []).includes('duplicate')
        )
      ) ?? selectCanonical(members);
    const duplicates = members.filter(
      issue => issue.number !== canonical.number
    );
    const lifecycle = (canonical.labels ?? []).find(label =>
      CONTRACT.lifecycle.includes(label)
    );
    clusters.push({
      canonical,
      duplicates,
      canonicalAction:
        lifecycle === 'radar:released'
          ? 'reopen-regression'
          : lifecycle === 'radar:rejected'
            ? 'verify-rejection-invalidated'
            : 'reuse',
    });
    members.forEach(issue => consumed.add(issue.number));
  }
  return clusters;
}

export function nextLifecycleLabels(labels, next) {
  if (!CONTRACT.lifecycle.includes(next))
    throw new Error(`Unknown lifecycle label: ${next}`);
  return [
    ...new Set([
      ...labels.filter(label => !CONTRACT.lifecycle.includes(label)),
      next,
    ]),
  ];
}

export function readableTitleProblems(value) {
  const title = String(value ?? '').trim();
  const words = title.split(/\s+/).filter(Boolean);
  const [minimum, maximum] = CONTRACT.presentation.titleWordRange;
  const problems = [];
  if (!title) problems.push('missing');
  if (title && (words.length < minimum || words.length > maximum))
    problems.push('word-count');
  if (title.length > CONTRACT.presentation.titleMaxCharacters)
    problems.push('character-count');
  if (/\r|\n|:\s*$/.test(title)) problems.push('format');
  if (
    /https?:\/\/|\bError\s*:|\b(?:ENOTFOUND|ECONN[A-Z_]*|ETIMEDOUT|TypeError|ReferenceError)\b|\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i.test(
      title
    )
  ) {
    problems.push('raw-diagnostic');
  }
  return problems;
}

export function issueEnrichmentGaps(issue) {
  if (issue.duplicateOf || (issue.labels ?? []).includes('duplicate'))
    return [];
  const gaps = [];
  for (const field of CONTRACT.presentation.requiredFields) {
    const value = issue[field];
    if (field === 'acceptanceCriteria') {
      const criteria = array(value)
        .map(criterion => criterion.trim())
        .filter(Boolean);
      if (!criteria.length) gaps.push(field);
      if (
        criteria.some(
          criterion =>
            criterion.split(/\s+/).length >
            CONTRACT.presentation.fieldWordLimits.acceptanceCriteria
        )
      ) {
        gaps.push(`${field}:word-count`);
      }
    } else if (!String(value ?? '').trim()) {
      gaps.push(field);
    } else if (
      CONTRACT.presentation.fieldWordLimits[field] &&
      String(value).trim().split(/\s+/).length >
        CONTRACT.presentation.fieldWordLimits[field]
    ) {
      gaps.push(`${field}:word-count`);
    }
  }
  const titleProblems = readableTitleProblems(issue.displayTitle);
  if (titleProblems.length)
    gaps.push(...titleProblems.map(problem => `displayTitle:${problem}`));
  if (
    issue.displayTitle &&
    normalizeText(issue.title) !== normalizeText(issue.displayTitle)
  ) {
    gaps.push('githubTitle');
  }
  return [...new Set(gaps)];
}

function isCanonicalIssue(issue) {
  return !issue.duplicateOf && !(issue.labels ?? []).includes('duplicate');
}

export function selectActionableIssues(issues) {
  const actionableStates = new Set([
    'radar:needs-agent',
    'radar:accepted',
    'radar:in-progress',
    'radar:in-review',
  ]);
  return issues.filter(
    issue =>
      isCanonicalIssue(issue) &&
      (issue.pendingAgentPass === true ||
        (issue.state === 'open' &&
          issue.labels.some(label => actionableStates.has(label))))
  );
}

export function selectEnrichmentIssues(issues) {
  const presentationStates = new Set(
    CONTRACT.presentation.actionRequiredLifecycle
  );
  return issues
    .filter(isCanonicalIssue)
    .map(issue => ({ issue, gaps: issueEnrichmentGaps(issue) }))
    .filter(
      ({ issue, gaps }) =>
        gaps.length > 0 &&
        (issue.pendingAgentPass === true ||
          (issue.state === 'open' &&
            issue.labels.some(label => presentationStates.has(label))))
    );
}

export function radarIssueMetadata(issue) {
  const radarData = readMarker(issue.body, CONTRACT.marker);
  return {
    ...(radarData ?? {}),
    number: issue.number,
    title: issue.title,
    state: issue.state,
    createdAt: issue.created_at,
    labels: issue.labels.map(label => label.name),
    hasRadarMarker: Boolean(radarData),
  };
}

export function isManagedRadarIssue(issue) {
  return (issue.labels ?? []).some(label => CONTRACT.sources.includes(label));
}

export function selectUntriagedFeedbackIssues(issues) {
  const feedbackLabel = process.env.GITHUB_FEEDBACK_LABEL?.trim() || 'feedback';
  return issues.filter(
    issue =>
      issue.state === 'open' &&
      (issue.labels ?? []).includes(feedbackLabel) &&
      !(issue.labels ?? []).includes('duplicate') &&
      !isManagedRadarIssue(issue)
  );
}

export function planClarification({
  round,
  precedingState,
  questions,
  answers,
}) {
  if (round < 1 || round > CONTRACT.clarification.maximumProactiveRounds) {
    throw new Error(
      'Feature clarification supports exactly two proactive rounds.'
    );
  }
  const applicable = questions.filter(question => {
    if (!question.when) return true;
    return Object.entries(question.when).every(
      ([id, value]) => answers[id] === value
    );
  });
  const unanswered = applicable.filter(
    question => !Object.hasOwn(answers, question.id)
  );
  if (!unanswered.length) {
    return { state: precedingState, questions: [], complete: true };
  }
  if (round === CONTRACT.clarification.maximumProactiveRounds) {
    return {
      state: 'radar:blocked',
      questions: [],
      complete: false,
      unresolved: unanswered.map(question => ({
        id: question.id,
        prompt: question.prompt,
        choices: question.choices ?? [],
        recommended: question.recommended ?? null,
      })),
    };
  }
  return { state: 'radar:needs-user', questions: unanswered, complete: false };
}

function repo() {
  const configured = process.env.POMI_RADAR_GITHUB_REPOSITORY;
  if (configured && configured !== CONTRACT.repository) {
    throw new Error(`Radar writes are restricted to ${CONTRACT.repository}.`);
  }
  return CONTRACT.repository;
}

function githubUrl(path) {
  const [pathname, query = ''] = path.split('?', 2);
  const url = new URL('https://api.github.com');
  url.pathname = `/repos/${repo()}${pathname}`;
  url.search = query;
  return url;
}

function sentrySegment(value, label) {
  const segment = String(value ?? '');
  if (!/^[A-Za-z0-9_.-]+$/.test(segment)) {
    throw new Error(`Invalid Sentry ${label}.`);
  }
  return segment;
}

function sentryUrl(pathname, query) {
  const url = new URL('https://sentry.io');
  url.pathname = pathname;
  if (query) url.search = query;
  return url;
}

function githubToken() {
  return process.env.GITHUB_TOKEN || '';
}

async function github(path, init) {
  const token = githubToken();
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN from the Pomi Radar GitHub App is required. Run through scripts/github-app-auth.mjs.'
    );
  }
  const response = await fetch(githubUrl(path), {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'pomi-radar-lifecycle',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(
      `GitHub ${init.method ?? 'GET'} ${path} failed: ${response.status}`
    );
  if (response.status === 204) return null;
  return response.json();
}

async function paginate(path) {
  const values = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const batch = await github(
      `${path}${separator}per_page=100&page=${page}`,
      {}
    );
    values.push(...batch);
    if (batch.length < 100) return values;
  }
}

async function sentryIssues() {
  const required = [
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'SENTRY_FRONTEND_PROJECT',
    'SENTRY_BACKEND_PROJECT',
  ];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) return { issues: [], missing };
  const org = sentrySegment(process.env.SENTRY_ORG, 'organization');
  async function projectIssues(project) {
    const safeProject = sentrySegment(project, 'project');
    const values = [];
    let cursor = null;
    do {
      const query = new URLSearchParams({
        statsPeriod: '14d',
        environment: process.env.SENTRY_ENVIRONMENT || 'production',
        query: 'is:unresolved',
        per_page: '100',
        ...(cursor ? { cursor } : {}),
      });
      const response = await fetch(
        sentryUrl(`/api/0/projects/${org}/${safeProject}/issues/`, query),
        {
          headers: { authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
        }
      );
      if (!response.ok)
        throw new Error(
          `Sentry list for ${project} failed: ${response.status}`
        );
      values.push(
        ...(await response.json()).map(issue => ({
          id: String(issue.id),
          shortId: issue.shortId,
          project,
          title: issue.title,
          firstSeen: issue.firstSeen,
          lastSeen: issue.lastSeen,
          status: issue.status,
        }))
      );
      cursor =
        String(response.headers.get('link') ?? '')
          .split(',')
          .find(part => /rel="next"/.test(part) && /results="true"/.test(part))
          ?.match(/cursor="([^"]+)"/)?.[1] ?? null;
    } while (cursor);
    return values;
  }
  const issues = (
    await Promise.all([
      projectIssues(process.env.SENTRY_FRONTEND_PROJECT),
      projectIssues(process.env.SENTRY_BACKEND_PROJECT),
    ])
  ).flat();
  return { issues, missing: [] };
}

function trackMatches(issue, track) {
  const labels = issue.labels ?? [];
  if (track === 'security' || track === 'performance')
    return labels.includes(`radar:${track}`);
  return labels.some(label =>
    ['radar:feature', 'radar:bug', 'radar:sentry'].includes(label)
  );
}

export function proposalSlotPlan(issues) {
  const target = CONTRACT.proposalAvailability.targetVisibleCount;
  const visibleLifecycle = new Set(
    CONTRACT.proposalAvailability.visibleLifecycle
  );
  const visible = issues
    .filter(isCanonicalIssue)
    .filter(issue =>
      (issue.labels ?? []).some(label =>
        ['radar:security', 'radar:performance'].includes(label)
      )
    )
    .filter(
      issue =>
        issue.pendingAgentPass === true ||
        (issue.state === 'open' &&
          (issue.labels ?? []).some(label => visibleLifecycle.has(label)))
    )
    .sort((left, right) => {
      const generated = String(
        right.generatedAt ?? right.createdAt ?? ''
      ).localeCompare(String(left.generatedAt ?? left.createdAt ?? ''));
      return (
        generated ||
        Number(left.rank ?? 0) - Number(right.rank ?? 0) ||
        left.number - right.number
      );
    })
    .slice(0, target);
  return {
    visibleProposalCount: visible.length,
    visibleProposalIssueNumbers: visible.map(issue => issue.number),
    proposalSlotsNeeded: Math.max(0, target - visible.length),
  };
}

export function dailyFeatureSlotPlan(issues) {
  const target = CONTRACT.dailyFeatureAvailability.targetVisibleCount;
  const visibleLifecycle = new Set(
    CONTRACT.dailyFeatureAvailability.visibleLifecycle
  );
  const visible = issues
    .filter(isCanonicalIssue)
    .filter(issue => issue.source === 'daily_feature')
    .filter(
      issue =>
        issue.pendingAgentPass === true ||
        (issue.state === 'open' &&
          (issue.labels ?? []).some(label => visibleLifecycle.has(label)))
    )
    .sort((left, right) => {
      const generated = String(
        right.generatedAt ?? right.createdAt ?? ''
      ).localeCompare(String(left.generatedAt ?? left.createdAt ?? ''));
      return generated || left.number - right.number;
    })
    .slice(0, target);
  return {
    visibleProposalCount: visible.length,
    visibleProposalIssueNumbers: visible.map(issue => issue.number),
    proposalSlotsNeeded: Math.max(0, target - visible.length),
  };
}

export function preflightHasWork(index) {
  return Boolean(
    index.duplicateClusters.length ||
    index.feedbackIssueNumbers?.length ||
    index.actionableIssueNumbers.length ||
    index.enrichmentIssueNumbers.length ||
    index.sourcePulls.length ||
    index.unmappedSentry.length ||
    index.sentryConfigurationMissing?.length ||
    index.shouldGenerate
  );
}

export async function preflight(track) {
  const [issues, pulls] = await Promise.all([
    paginate('/issues?state=all&sort=updated&direction=desc'),
    paginate('/pulls?state=open&base=main'),
  ]);
  const metadata = issues
    .filter(issue => !issue.pull_request)
    .map(radarIssueMetadata);
  const managed = metadata.filter(isManagedRadarIssue);
  const relevant = managed.filter(
    issue => track === 'all' || trackMatches(issue, track)
  );
  const feedbackIssues =
    track === 'feature-bug' || track === 'all'
      ? selectUntriagedFeedbackIssues(metadata)
      : [];
  const duplicateClusters = deduplicationPlan(relevant);
  const sourcePulls = pulls.filter(
    pull =>
      readMarker(pull.body, 'pomi-radar-source:v1') ||
      readMarker(pull.body, CONTRACT.consolidationMarker)
  );
  const relevantPulls = sourcePulls.filter(pull => {
    if (track === 'all') return true;
    const source = readMarker(pull.body, 'pomi-radar-source:v1');
    return (
      !source?.track ||
      source.track === track ||
      (track === 'feature-bug' &&
        ['feature', 'bug', 'feature-bug'].includes(source.track))
    );
  });
  const actionable = selectActionableIssues(relevant);
  const needsEnrichment = selectEnrichmentIssues(relevant);
  const activeRuns = new Map();
  for (const issue of relevant.filter(
    value => value.state === 'open' && value.runId
  )) {
    const values = activeRuns.get(issue.runId) ?? [];
    values.push(issue.number);
    activeRuns.set(issue.runId, values);
  }
  const latestRun =
    [...activeRuns.entries()].sort((left, right) =>
      String(right[0]).localeCompare(String(left[0]))
    )[0] ?? null;
  const proposalAvailability =
    track === 'feature-bug'
      ? dailyFeatureSlotPlan(relevant)
      : track === 'security' || track === 'performance'
        ? proposalSlotPlan(relevant)
        : {
            visibleProposalCount: 0,
            visibleProposalIssueNumbers: [],
            proposalSlotsNeeded: 0,
          };
  const shouldGenerate = ['feature-bug', 'security', 'performance'].includes(
    track
  )
    ? proposalAvailability.proposalSlotsNeeded > 0
    : false;
  const sentry =
    track === 'feature-bug' || track === 'all'
      ? await sentryIssues()
      : { issues: [], missing: [] };
  const mappedSentryIds = new Set(
    relevant.flatMap(issue => array(issue.sentryGroupIds))
  );
  const unmappedSentry = sentry.issues.filter(
    issue => !mappedSentryIds.has(issue.id)
  );
  const result = {
    contractVersion: CONTRACT.version,
    track,
    duplicateClusters,
    feedbackIssueNumbers: feedbackIssues.map(issue => issue.number),
    feedbackIssues: feedbackIssues.map(issue => ({
      number: issue.number,
      title: issue.title,
      createdAt: issue.createdAt,
    })),
    actionableIssueNumbers: actionable.map(issue => issue.number),
    actionableIssues: actionable.map(issue => ({
      number: issue.number,
      lifecycle:
        issue.labels.find(label => CONTRACT.lifecycle.includes(label)) ?? null,
      pendingAgentPass: issue.pendingAgentPass === true,
      lastMutationId: issue.lastMutationId ?? null,
    })),
    enrichmentIssueNumbers: needsEnrichment.map(({ issue }) => issue.number),
    enrichmentIssues: needsEnrichment.map(({ issue, gaps }) => ({
      number: issue.number,
      gaps,
    })),
    sourcePulls: relevantPulls.map(pull => ({
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
    })),
    currentBatch: latestRun
      ? { runId: latestRun[0], issueNumbers: latestRun[1] }
      : null,
    ...proposalAvailability,
    shouldGenerate,
    sentryConfigurationMissing: sentry.missing,
    unresolvedSentryCount: sentry.issues.length,
    unmappedSentry,
    noWork: false,
  };
  result.noWork = !preflightHasWork(result);
  return result;
}

async function addCommentOnce(issueNumber, body, eventId) {
  const eventMarker = marker('pomi-radar-event:v1', { id: eventId });
  const comments = await paginate(`/issues/${issueNumber}/comments`);
  if (comments.some(comment => String(comment.body).includes(eventMarker)))
    return false;
  await github(`/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: `${body}\n\n${eventMarker}` }),
  });
  return true;
}

async function setIssueLifecycle(issueNumber, lifecycle, state, stateReason) {
  const issue = await github(`/issues/${issueNumber}`, {});
  const labels = nextLifecycleLabels(
    issue.labels.map(label => label.name),
    lifecycle
  );
  await github(`/issues/${issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({
      labels,
      state,
      ...(stateReason ? { state_reason: stateReason } : {}),
    }),
  });
}

function issueBodyWithData(issue, changes) {
  const current = readMarker(issue.body, CONTRACT.marker) ?? {};
  const next = marker(CONTRACT.marker, {
    ...current,
    ...changes,
    version: CONTRACT.version,
  });
  return readMarker(issue.body, CONTRACT.marker)
    ? String(issue.body).replace(/<!--\s*pomi-radar:v1\s+\{[^]*?\}\s*-->/, next)
    : `${String(issue.body ?? '').trim()}\n\n${next}`.trim();
}

async function updateIssueData(
  issueNumber,
  changes,
  title,
  expectedLastMutationId
) {
  const issue = await github(`/issues/${issueNumber}`, {});
  const current = readMarker(issue.body, CONTRACT.marker) ?? {};
  if (
    expectedLastMutationId &&
    current.lastMutationId !== expectedLastMutationId
  ) {
    throw new Error(
      `Issue #${issueNumber} changed after this agent pass started. Rerun preflight and process the latest decision.`
    );
  }
  await github(`/issues/${issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({
      body: issueBodyWithData(issue, changes),
      ...(title ? { title } : {}),
    }),
  });
}

function presentationPayload(input) {
  return Object.fromEntries(
    CONTRACT.presentation.requiredFields.map(field => [field, input[field]])
  );
}

function enrichmentMetadataPayload(input, current) {
  const mutableFields = [
    'questions',
    'clarificationRound',
    'clarificationPrecedingState',
    'codeArea',
    'affectedBehavior',
    'observed',
    'expected',
    'platform',
  ];
  const payload = Object.fromEntries(
    mutableFields
      .filter(field => Object.hasOwn(input, field))
      .map(field => [field, input[field]])
  );
  for (const field of ['kind', 'source', 'sourceId', 'rootBehavior']) {
    if (!Object.hasOwn(input, field)) continue;
    if (
      current[field] !== undefined &&
      normalizeText(current[field]) !== normalizeText(input[field])
    ) {
      throw new Error(`Enrichment cannot replace immutable ${field} metadata.`);
    }
    payload[field] = current[field] ?? input[field];
  }
  if (Object.hasOwn(input, 'sourceIds')) {
    payload.sourceIds = [
      ...new Set(
        [
          ...array(current.sourceIds),
          current.sourceId,
          ...array(input.sourceIds),
        ]
          .filter(Boolean)
          .map(String)
      ),
    ];
  }
  return payload;
}

export async function enrichIssue(input) {
  const issueNumber = Number(input.issueNumber);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0)
    throw new Error('A canonical issueNumber is required.');
  const presentation = presentationPayload(input);
  const gaps = issueEnrichmentGaps({
    ...presentation,
    title: presentation.displayTitle,
    labels: [],
  });
  if (gaps.length)
    throw new Error(`Incomplete Radar presentation: ${gaps.join(', ')}`);
  const issue = await github(`/issues/${issueNumber}`, {});
  const labels = issue.labels.map(label => label.name);
  const current = readMarker(issue.body, CONTRACT.marker) ?? {};
  if (
    !labels.some(label => CONTRACT.sources.includes(label)) ||
    current.duplicateOf ||
    labels.includes('duplicate')
  ) {
    throw new Error(
      `Issue #${issueNumber} is not an eligible canonical Radar issue.`
    );
  }
  const digest = createHash('sha256')
    .update(JSON.stringify(presentation))
    .digest('hex')
    .slice(0, 12);
  await updateIssueData(
    issueNumber,
    { ...enrichmentMetadataPayload(input, current), ...presentation },
    presentation.displayTitle
  );
  await addCommentOnce(
    issueNumber,
    `Radar presentation refreshed for clarity.\n\n- **Title:** ${presentation.displayTitle}\n- **Card sections:** Summary, why now, current state, proposed change, evidence, tradeoffs, validation, and acceptance criteria`,
    `enrichment:${issueNumber}:${digest}`
  );
  return {
    issueNumber,
    updated: true,
    eventId: `enrichment:${issueNumber}:${digest}`,
  };
}

export async function acknowledgeAgentPass(input) {
  const decisions = Array.isArray(input.decisions) ? input.decisions : [];
  if (!decisions.length) {
    throw new Error(
      'At least one decision with issueNumber and lastMutationId is required.'
    );
  }
  const runId = String(input.runId ?? '').trim();
  const track = String(input.track ?? '').trim();
  const acknowledgedAt = String(input.acknowledgedAt ?? '').trim();
  if (
    !runId ||
    !track ||
    !acknowledgedAt ||
    Number.isNaN(Date.parse(acknowledgedAt))
  ) {
    throw new Error(
      'A stable runId, track, and explicit acknowledgedAt timestamp are required.'
    );
  }
  const acknowledged = [];
  for (const decision of decisions) {
    const issueNumber = Number(decision.issueNumber);
    const expectedLastMutationId = String(decision.lastMutationId ?? '').trim();
    if (
      !Number.isInteger(issueNumber) ||
      issueNumber <= 0 ||
      !expectedLastMutationId
    ) {
      throw new Error(
        'Every decision requires a canonical issueNumber and lastMutationId.'
      );
    }
    const issue = await github(`/issues/${issueNumber}`, {});
    const current = readMarker(issue.body, CONTRACT.marker) ?? {};
    if (current.pendingAgentPass !== true) continue;
    if (current.lastMutationId !== expectedLastMutationId) {
      throw new Error(
        `Issue #${issueNumber} has a newer Radar decision. Rerun preflight and process it before acknowledgement.`
      );
    }
    await addCommentOnce(
      issueNumber,
      `The ${track} automation picked up this Radar decision in run \`${runId}\`.`,
      `agent-pass:${runId}:issue:${issueNumber}:decision:${expectedLastMutationId}`
    );
    await updateIssueData(
      issueNumber,
      {
        pendingAgentPass: false,
        lastAgentPassAt: acknowledgedAt,
        lastAgentPassRunId: runId,
      },
      undefined,
      expectedLastMutationId
    );
    acknowledged.push(issueNumber);
  }
  return { acknowledged, runId, track };
}

export async function reconcileDuplicate(input) {
  const canonicalIssueNumber = Number(input.canonicalIssueNumber);
  const duplicateIssueNumber = Number(input.duplicateIssueNumber);
  if (
    !Number.isInteger(canonicalIssueNumber) ||
    !Number.isInteger(duplicateIssueNumber) ||
    canonicalIssueNumber <= 0 ||
    duplicateIssueNumber <= 0 ||
    canonicalIssueNumber === duplicateIssueNumber
  ) {
    throw new Error(
      'Distinct canonicalIssueNumber and duplicateIssueNumber values are required.'
    );
  }

  const [canonical, duplicate] = await Promise.all([
    github(`/issues/${canonicalIssueNumber}`, {}),
    github(`/issues/${duplicateIssueNumber}`, {}),
  ]);
  const canonicalCreatedAt = new Date(canonical.created_at).getTime();
  const duplicateCreatedAt = new Date(duplicate.created_at).getTime();
  if (
    canonicalCreatedAt > duplicateCreatedAt ||
    (canonicalCreatedAt === duplicateCreatedAt &&
      canonicalIssueNumber > duplicateIssueNumber)
  ) {
    throw new Error('The oldest applicable issue must remain canonical.');
  }

  const canonicalLabels = canonical.labels.map(label => label.name);
  const sourceLabels = canonicalLabels.filter(label =>
    CONTRACT.sources.includes(label)
  );
  const lifecycleLabels = canonicalLabels.filter(label =>
    CONTRACT.lifecycle.includes(label)
  );
  if (sourceLabels.length !== 1 || lifecycleLabels.length !== 1) {
    throw new Error(
      'The canonical issue must have one source and one lifecycle label.'
    );
  }
  const lifecycle = lifecycleLabels[0];
  if (lifecycle === 'radar:rejected') {
    throw new Error(
      'A rejected canonical must be reconsidered before duplicate reconciliation.'
    );
  }
  const duplicateSourceLabels = duplicate.labels
    .map(label => label.name)
    .filter(label => CONTRACT.sources.includes(label));
  if (duplicateSourceLabels.length > 1) {
    throw new Error('The duplicate issue must have at most one source label.');
  }

  const canonicalData = readMarker(canonical.body, CONTRACT.marker) ?? {};
  const duplicateData = readMarker(duplicate.body, CONTRACT.marker) ?? {};
  const sourceId = String(
    input.sourceId ??
      duplicateData.sourceId ??
      `github-feedback:${duplicateIssueNumber}`
  ).trim();
  const sourceIds = [
    ...new Set(
      [
        ...array(canonicalData.sourceIds),
        canonicalData.sourceId,
        ...array(duplicateData.sourceIds),
        duplicateData.sourceId,
        sourceId,
      ]
        .filter(Boolean)
        .map(String)
    ),
  ];
  const sentryGroupIds = [
    ...new Set(
      [
        ...array(canonicalData.sentryGroupIds),
        canonicalData.sentryGroupId,
        ...array(duplicateData.sentryGroupIds),
        duplicateData.sentryGroupId,
      ]
        .filter(Boolean)
        .map(String)
    ),
  ];
  await updateIssueData(canonicalIssueNumber, {
    sourceIds,
    ...(sentryGroupIds.length ? { sentryGroupIds } : {}),
    duplicateIssues: [
      ...new Set([
        ...array(canonicalData.duplicateIssues),
        String(duplicateIssueNumber),
      ]),
    ].map(Number),
  });

  const eventBase = `dedup:${canonicalIssueNumber}:${duplicateIssueNumber}`;
  const evidence = String(input.evidence ?? '').trim();
  await addCommentOnce(
    canonicalIssueNumber,
    evidence ||
      `Matching feedback #${duplicateIssueNumber} was consolidated into this canonical issue.`,
    `${eventBase}:canonical`
  );
  if (lifecycle === 'radar:released') {
    await addCommentOnce(
      canonicalIssueNumber,
      `Regression report #${duplicateIssueNumber} reopened this canonical issue.`,
      `${eventBase}:reopen`
    );
    await setIssueLifecycle(
      canonicalIssueNumber,
      'radar:proposed',
      'open',
      'reopened'
    );
  }
  await addCommentOnce(
    duplicateIssueNumber,
    `Duplicate of #${canonicalIssueNumber}`,
    eventBase
  );
  const duplicateSourceLabel = duplicateSourceLabels[0] ?? sourceLabels[0];
  const duplicateLabels = nextLifecycleLabels(
    [
      ...duplicate.labels
        .map(label => label.name)
        .filter(label => !CONTRACT.sources.includes(label)),
      duplicateSourceLabel,
      'duplicate',
    ],
    lifecycle === 'radar:released' ? 'radar:proposed' : lifecycle
  );
  const duplicateChanges = {
    kind: duplicateData.kind ?? canonicalData.kind,
    source: duplicateData.source ?? 'user_feedback',
    sourceId,
    sourceIds: [
      ...new Set(
        [...array(duplicateData.sourceIds), duplicateData.sourceId, sourceId]
          .filter(Boolean)
          .map(String)
      ),
    ],
    ...(array(duplicateData.sentryGroupIds).length
      ? { sentryGroupIds: array(duplicateData.sentryGroupIds) }
      : {}),
    rootBehavior: duplicateData.rootBehavior ?? canonicalData.rootBehavior,
    duplicateOf: canonicalIssueNumber,
  };
  await github(`/issues/${duplicateIssueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({
      body: issueBodyWithData(duplicate, duplicateChanges),
      labels: duplicateLabels,
      state: 'closed',
      state_reason: 'duplicate',
    }),
  });
  return { canonicalIssueNumber, duplicateIssueNumber, eventId: eventBase };
}

export function validateConsolidationManifest(event, issues, options) {
  const pull = event.pull_request;
  const allowLegacy = options?.allowLegacy === true;
  if (!allowLegacy && pull?.user?.login !== radarBotLogin()) {
    throw new Error(
      'Radar consolidation PR must be authored by the Radar bot.'
    );
  }
  if (
    pull.base?.ref !== 'main' ||
    pull.base?.repo?.full_name !== repo() ||
    pull.head?.repo?.full_name !== repo()
  ) {
    throw new Error(
      'Radar consolidation PR must stay within the canonical repository.'
    );
  }
  const manifest = readMarker(pull.body, CONTRACT.consolidationMarker);
  const issueNumbers = [...new Set(array(manifest?.issues).map(Number))];
  const sourcePrNumbers = [...new Set(array(manifest?.sourcePrs).map(Number))];
  if (
    !manifest ||
    !issueNumbers.length ||
    !sourcePrNumbers.length ||
    issueNumbers.length > 100 ||
    sourcePrNumbers.length > 100 ||
    issueNumbers.some(number => !Number.isSafeInteger(number) || number <= 0) ||
    sourcePrNumbers.some(number => !Number.isSafeInteger(number) || number <= 0)
  ) {
    throw new Error(
      'Radar consolidation manifest contains invalid issue or source PR numbers.'
    );
  }
  if (sourcePrNumbers.includes(Number(pull.number))) {
    throw new Error(
      'Radar consolidation manifest cannot include the consolidation PR itself.'
    );
  }
  for (const issue of issues) {
    const metadata = radarIssueMetadata(issue);
    const lifecycle = metadata.labels.filter(label =>
      CONTRACT.lifecycle.includes(label)
    );
    const retryingReadyIssue =
      lifecycle.length === 1 &&
      lifecycle[0] === 'radar:ready-for-release' &&
      Number(metadata.consolidationPullRequest) === Number(pull.number) &&
      metadata.consolidationMergeSha === pull.merge_commit_sha;
    const eligibleLifecycle = allowLegacy
      ? ['radar:in-review', 'radar:accepted', 'radar:in-progress']
      : ['radar:in-review'];
    if (
      issue.pull_request ||
      metadata.state !== 'open' ||
      !metadata.hasRadarMarker ||
      !isManagedRadarIssue(metadata) ||
      metadata.labels.includes('duplicate') ||
      lifecycle.length !== 1 ||
      (!eligibleLifecycle.includes(lifecycle[0]) && !retryingReadyIssue)
    ) {
      throw new Error(
        `Issue #${metadata.number} is not an eligible in-review Radar issue.`
      );
    }
  }
  return { issueNumbers, sourcePrNumbers };
}

async function validateConsolidationSourcePulls(
  sourcePulls,
  sourcePrNumbers,
  consolidationIssueNumbers,
  consolidationNumber,
  mergeSha,
  options
) {
  const allowLegacy = options?.allowLegacy === true;
  const containmentSha = options?.containmentSha ?? mergeSha;
  const sourceByNumber = new Map(
    sourcePulls.map(sourcePull => [Number(sourcePull.number), sourcePull])
  );
  const representedIssueNumbers = new Set();
  for (const sourcePrNumber of sourcePrNumbers) {
    const sourcePull = sourceByNumber.get(sourcePrNumber);
    if (!sourcePull) {
      throw new Error(
        `Source PR #${sourcePrNumber} from the consolidation manifest was not found.`
      );
    }
    if (!allowLegacy && sourcePull.user?.login !== radarBotLogin()) {
      throw new Error(
        `Source PR #${sourcePrNumber} must be authored by the Radar bot.`
      );
    }
    if (
      sourcePull.base?.ref !== 'main' ||
      sourcePull.base?.repo?.full_name !== repo() ||
      sourcePull.head?.repo?.full_name !== repo()
    ) {
      throw new Error(
        `Source PR #${sourcePrNumber} must stay within ${repo()} and target its main branch.`
      );
    }
    const sourceMarker = readMarker(sourcePull.body, 'pomi-radar-source:v1');
    const hasSourceMarker = String(sourcePull.body ?? '').includes(
      'pomi-radar-source:v1'
    );
    const rawIssueNumbers = Array.isArray(sourceMarker?.issues)
      ? sourceMarker.issues
      : [];
    const sourceIssueNumbers = [...new Set(rawIssueNumbers.map(Number))];
    const hasValidSourceMarker =
      sourceMarker?.version === 1 &&
      sourceIssueNumbers.length > 0 &&
      sourceIssueNumbers.length === rawIssueNumbers.length &&
      sourceIssueNumbers.every(
        number => Number.isSafeInteger(number) && number > 0
      );
    if ((!allowLegacy || hasSourceMarker) && !hasValidSourceMarker) {
      throw new Error(
        `Source PR #${sourcePrNumber} must contain a valid Radar source marker.`
      );
    }
    if (
      hasValidSourceMarker &&
      sourceIssueNumbers.some(
        issueNumber => !consolidationIssueNumbers.includes(issueNumber)
      )
    ) {
      throw new Error(
        `Source PR #${sourcePrNumber} does not represent the consolidation issue set.`
      );
    }
    for (const issueNumber of sourceIssueNumbers)
      representedIssueNumbers.add(issueNumber);
    if (allowLegacy && sourcePull.state !== 'open') continue;
    if (!/^[0-9a-f]{40}$/.test(String(sourcePull.head?.sha))) {
      throw new Error(
        `Source PR #${sourcePrNumber} does not expose a valid head commit.`
      );
    }
    const comparison = await github(
      `/compare/${sourcePull.head.sha}...${containmentSha}`,
      {}
    );
    if (!['ahead', 'identical'].includes(comparison?.status)) {
      throw new Error(
        `Source PR #${sourcePrNumber} is not contained in consolidation PR #${consolidationNumber}.`
      );
    }
  }
  const missingIssueNumbers = consolidationIssueNumbers.filter(
    issueNumber => !representedIssueNumbers.has(issueNumber)
  );
  if (missingIssueNumbers.length) {
    throw new Error(
      `Source PRs do not represent consolidation issues: ${missingIssueNumbers.join(', ')}.`
    );
  }
  return sourceByNumber;
}

async function closeConsolidationSourcePulls(
  sourcePulls,
  consolidationPull,
  mergeSha,
  options
) {
  const auditAlreadyClosed = options?.auditAlreadyClosed !== false;
  const closed = [];
  const alreadyClosed = [];
  for (const sourcePull of sourcePulls) {
    const sourcePrNumber = Number(sourcePull.number);
    if (sourcePull.state !== 'open') {
      alreadyClosed.push(sourcePrNumber);
      if (!auditAlreadyClosed) continue;
    }
    await addCommentOnce(
      sourcePrNumber,
      `Closed because it was included in merged consolidation PR #${consolidationPull.number} at merge commit \`${mergeSha}\`.`,
      `consolidation:${consolidationPull.number}:${mergeSha}:source-pr:${sourcePrNumber}`
    );
    if (sourcePull.state !== 'open') continue;
    await github(`/pulls/${sourcePrNumber}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    });
    closed.push(sourcePrNumber);
  }
  return { closed, alreadyClosed };
}

async function commitTreeSha(commitSha) {
  const commit = await github(`/commits/${commitSha}`, {});
  const treeSha = commit?.commit?.tree?.sha;
  if (!/^[0-9a-f]{40}$/.test(String(treeSha))) {
    throw new Error(`Commit ${commitSha} does not expose a valid tree.`);
  }
  return treeSha;
}

async function isHistoricalSquashConsolidation(pull) {
  if (pull.user?.login === radarBotLogin()) return false;
  const commitCount = Number(pull.commits);
  if (!Number.isSafeInteger(commitCount) || commitCount <= 1) return false;
  const mergeSha = pull.merge_commit_sha;
  const reviewedHeadSha = pull.head?.sha;
  const baseSha = pull.base?.sha;
  if (
    !/^[0-9a-f]{40}$/.test(String(mergeSha)) ||
    !/^[0-9a-f]{40}$/.test(String(reviewedHeadSha)) ||
    !/^[0-9a-f]{40}$/.test(String(baseSha)) ||
    mergeSha === reviewedHeadSha
  ) {
    return false;
  }
  const [mergeCommit, comparison] = await Promise.all([
    github(`/commits/${mergeSha}`, {}),
    github(`/compare/${baseSha}...${mergeSha}`, {}),
  ]);
  return (
    Array.isArray(mergeCommit?.parents) &&
    mergeCommit.parents.length === 1 &&
    comparison?.status === 'ahead' &&
    comparison.ahead_by === 1
  );
}

export async function consolidationMerged(event, options) {
  const pull = event.pull_request;
  const allowLegacy = options?.allowLegacy === true;
  if (!pull?.merged) return { skipped: 'pull-request-not-merged' };
  const untrustedManifest = readMarker(pull.body, CONTRACT.consolidationMarker);
  if (!untrustedManifest) return { skipped: 'not-a-radar-consolidation' };
  const requestedNumbers = [
    ...new Set(array(untrustedManifest.issues).map(Number)),
  ];
  const mergeSha = pull.merge_commit_sha;
  if (!/^[0-9a-f]{40}$/.test(String(mergeSha))) {
    throw new Error('Radar consolidation merge commit is invalid.');
  }
  const issues = await Promise.all(
    requestedNumbers.map(issueNumber => github(`/issues/${issueNumber}`, {}))
  );
  const { issueNumbers, sourcePrNumbers } = validateConsolidationManifest(
    event,
    issues,
    options
  );
  const sourcePulls = await Promise.all(
    sourcePrNumbers.map(sourcePrNumber =>
      github(`/pulls/${sourcePrNumber}`, {})
    )
  );
  let containmentSha = mergeSha;
  if (allowLegacy) {
    const reviewedHeadSha = pull.head?.sha;
    if (!/^[0-9a-f]{40}$/.test(String(reviewedHeadSha))) {
      throw new Error(
        'Legacy Radar consolidation does not expose a valid reviewed head.'
      );
    }
    const [mergeTreeSha, reviewedHeadTreeSha] = await Promise.all([
      commitTreeSha(mergeSha),
      commitTreeSha(reviewedHeadSha),
    ]);
    if (mergeTreeSha !== reviewedHeadTreeSha) {
      throw new Error(
        'Legacy Radar consolidation merge does not preserve the reviewed tree.'
      );
    }
    containmentSha = reviewedHeadSha;
  }
  await validateConsolidationSourcePulls(
    sourcePulls,
    sourcePrNumbers,
    issueNumbers,
    pull.number,
    mergeSha,
    { ...options, containmentSha }
  );
  const sourcePullRequests = await closeConsolidationSourcePulls(
    sourcePulls,
    pull,
    mergeSha,
    allowLegacy ? { auditAlreadyClosed: false } : undefined
  );
  for (const issueNumber of issueNumbers) {
    await addCommentOnce(
      issueNumber,
      `Included in consolidation PR #${pull.number} at merge commit \`${mergeSha}\`. Ready for the next production release.`,
      `consolidation:${pull.number}:${mergeSha}:issue:${issueNumber}`
    );
    await updateIssueData(issueNumber, {
      consolidationPullRequest: pull.number,
      consolidationMergeSha: mergeSha,
    });
    await setIssueLifecycle(
      issueNumber,
      'radar:ready-for-release',
      'open',
      undefined
    );
  }
  return { updated: issueNumbers, sourcePullRequests, mergeSha };
}

export async function reconcileConsolidation(pullRequestNumber) {
  const number = Number(pullRequestNumber);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(
      'A positive consolidation pull request number is required.'
    );
  }
  const pull = await github(`/pulls/${number}`, {});
  if (pull.state !== 'closed' || !pull.merged_at) {
    return { skipped: 'pull-request-not-merged', pullRequest: number };
  }
  const event = { pull_request: { ...pull, merged: true } };
  try {
    return await consolidationMerged(event);
  } catch (strictError) {
    if (!(await isHistoricalSquashConsolidation(pull))) throw strictError;
    return consolidationMerged(event, { allowLegacy: true });
  }
}

async function validatePublishedRelease(releaseTag) {
  const tag = String(releaseTag ?? '').trim();
  const hasControlCharacter = [...tag].some(character => {
    const code = character.codePointAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (!tag || tag.length > 255 || hasControlCharacter) {
    throw new Error(
      'RELEASE_TAG must identify an existing published, non-prerelease GitHub Release.'
    );
  }
  const release = await github(`/releases/tags/${encodeURIComponent(tag)}`, {});
  if (
    release?.tag_name !== tag ||
    release.draft === true ||
    release.prerelease === true
  ) {
    throw new Error(
      `Release tag ${tag} must identify an existing published, non-prerelease GitHub Release.`
    );
  }
  return tag;
}

async function commitIncluded(mergeSha, releaseSha) {
  const comparison = await github(`/compare/${mergeSha}...${releaseSha}`, {});
  return comparison.status === 'ahead' || comparison.status === 'identical';
}

export async function resolveSentryGroup(groupId) {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token)
    throw new Error(
      'SENTRY_AUTH_TOKEN is required to resolve mapped Sentry groups.'
    );
  const safeGroupId = sentrySegment(groupId, 'group ID');
  const response = await fetch(sentryUrl(`/api/0/issues/${safeGroupId}/`), {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ status: 'resolved' }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Sentry group ${groupId} update failed: ${response.status}`
    );
  }
}

export async function releaseReadyIssues({
  releaseTag,
  releaseUrl,
  releaseSha,
}) {
  const verifiedReleaseTag = await validatePublishedRelease(releaseTag);
  const issues = await paginate(
    '/issues?state=open&labels=radar%3Aready-for-release'
  );
  const released = [];
  for (const issue of issues.filter(value => !value.pull_request)) {
    const data = readMarker(issue.body, CONTRACT.marker) ?? {};
    const mergeSha = data.consolidationMergeSha;
    if (!mergeSha || !(await commitIncluded(mergeSha, releaseSha))) continue;
    for (const groupId of [...new Set(array(data.sentryGroupIds))])
      await resolveSentryGroup(groupId);
    await addCommentOnce(
      issue.number,
      `Released in [${verifiedReleaseTag}](${releaseUrl}).`,
      `release:${verifiedReleaseTag}:issue:${issue.number}`
    );
    await updateIssueData(issue.number, {
      releaseTag: verifiedReleaseTag,
      releaseUrl,
      releaseSha,
    });
    await setIssueLifecycle(
      issue.number,
      'radar:released',
      'closed',
      'completed'
    );
    released.push(issue.number);
  }
  return { released };
}

export async function validateAutomationAuthentication({
  environment = process.env,
  fetchImpl = fetch,
} = {}) {
  const appId = environment.POMI_GITHUB_APP_ID?.trim();
  const expectedLogin = environment.POMI_GITHUB_APP_BOT_LOGIN?.trim();
  const token = environment.GITHUB_TOKEN?.trim();
  const permissionsJson = environment.POMI_GITHUB_APP_PERMISSIONS?.trim();
  const authorName = environment.GIT_AUTHOR_NAME?.trim();
  const authorEmail = environment.GIT_AUTHOR_EMAIL?.trim();
  const committerName = environment.GIT_COMMITTER_NAME?.trim();
  const committerEmail = environment.GIT_COMMITTER_EMAIL?.trim();
  if (
    !appId ||
    !expectedLogin ||
    !token ||
    !permissionsJson ||
    !authorName ||
    !authorEmail ||
    !committerName ||
    !committerEmail
  ) {
    throw new Error(
      'Radar preflight requires GitHub App authentication and bot Git identity from scripts/github-app-auth.mjs.'
    );
  }
  if (
    appId !== EXPECTED_GITHUB_APP_ID ||
    expectedLogin !== EXPECTED_GITHUB_APP_BOT_LOGIN
  ) {
    throw new Error('Radar preflight authentication must use Pomi Radar.');
  }
  let permissions;
  try {
    permissions = JSON.parse(permissionsJson);
  } catch {
    throw new Error(
      'Radar preflight requires verified GitHub App repository and permission metadata.'
    );
  }
  const requiredPermissions = ['contents', 'issues', 'pull_requests'];
  if (
    requiredPermissions.some(
      permission => permissions?.[permission] !== 'write'
    )
  ) {
    throw new Error(
      'Radar preflight requires the GitHub App installation to have repository, contents, issues, and pull-request write access.'
    );
  }
  const response = await fetchImpl(`https://api.github.com/repos/${repo()}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'pomi-radar-preflight',
      'x-github-api-version': '2022-11-28',
    },
  });
  const repository = await response.json();
  if (!response.ok || repository.full_name !== repo()) {
    throw new Error(
      `Radar preflight expected ${expectedLogin}, but App authentication could not be verified.`
    );
  }
  return { botLogin: expectedLogin, gitIdentityVerified: true };
}

async function main() {
  const [command] = process.argv.slice(2);
  if (!command) return;
  if (command === 'preflight') {
    await validateAutomationAuthentication();
    const trackFlag = process.argv.indexOf('--track');
    const track = trackFlag >= 0 ? process.argv[trackFlag + 1] : 'all';
    if (!['all', 'feature-bug', 'security', 'performance'].includes(track)) {
      throw new Error(
        '--track must be feature-bug, security, performance, or all.'
      );
    }
    process.stdout.write(
      `${JSON.stringify(await preflight(track), null, 2)}\n`
    );
    return;
  }
  if (command === 'labels') {
    process.stdout.write(
      `${JSON.stringify({ sources: CONTRACT.sources, lifecycle: CONTRACT.lifecycle }, null, 2)}\n`
    );
    return;
  }
  if (command === 'enrich') {
    const input = readJsonStdin();
    process.stdout.write(
      `${JSON.stringify(await enrichIssue(input), null, 2)}\n`
    );
    return;
  }
  if (command === 'acknowledge') {
    const input = readJsonStdin();
    process.stdout.write(
      `${JSON.stringify(await acknowledgeAgentPass(input), null, 2)}\n`
    );
    return;
  }
  if (command === 'deduplicate') {
    const input = readJsonStdin();
    process.stdout.write(
      `${JSON.stringify(await reconcileDuplicate(input), null, 2)}\n`
    );
    return;
  }
  if (command === 'consolidation-merged') {
    const event = readJsonStdin();
    process.stdout.write(
      `${JSON.stringify(await consolidationMerged(event), null, 2)}\n`
    );
    return;
  }
  if (command === 'consolidation-reconcile') {
    const input = readJsonStdin();
    process.stdout.write(
      `${JSON.stringify(
        await reconcileConsolidation(input.pullRequestNumber),
        null,
        2
      )}\n`
    );
    return;
  }
  if (command === 'release') {
    process.stdout.write(
      `${JSON.stringify(
        await releaseReadyIssues({
          releaseTag: process.env.RELEASE_TAG,
          releaseUrl: process.env.RELEASE_URL,
          releaseSha: process.env.RELEASE_SHA,
        }),
        null,
        2
      )}\n`
    );
    return;
  }
  throw new Error(`Unknown radar lifecycle command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
