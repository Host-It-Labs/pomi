#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { marker, normalizeText, readMarker } from './radar-lifecycle.mjs';

const APPLY = process.argv.includes('--apply');
const inputFlag = process.argv.indexOf('--input');
const REPOSITORY = process.env.POMI_RADAR_GITHUB_REPOSITORY || 'NeoHuncho/pomi';
const RADAR_MARKER = 'pomi-radar:v1';
const EVENT_MARKER = 'pomi-radar-event:v1';
const LABELS = {
  'radar:feature': ['84b6eb', 'Feature source'],
  'radar:bug': ['d73a4a', 'Bug source'],
  'radar:sentry': ['b60205', 'Sentry source'],
  'radar:security': ['fbca04', 'Security research source'],
  'radar:performance': ['0e8a16', 'Performance research source'],
  'radar:proposed': ['d4c5f9', 'Waiting for an owner decision'],
  'radar:needs-agent': ['5319e7', 'Waiting for the agent'],
  'radar:needs-user': ['f9d0c4', 'Waiting for user clarification'],
  'radar:accepted': ['9ce6a6', 'Accepted for implementation'],
  'radar:in-progress': ['1d76db', 'Implementation in progress'],
  'radar:in-review': ['0052cc', 'Implementation is in review'],
  'radar:ready-for-release': [
    '0e8a16',
    'Merged and waiting for production release',
  ],
  'radar:blocked': ['b60205', 'Blocked on a manual decision'],
  'radar:released': ['6f42c1', 'Included in a production release'],
  'radar:rejected': ['cfd3d7', 'Rejected as not planned'],
  duplicate: ['cfd3d7', 'Duplicate report retained as evidence'],
};
const LIFECYCLE = Object.keys(LABELS).filter(
  label =>
    label.startsWith('radar:') &&
    ![
      'radar:feature',
      'radar:bug',
      'radar:sentry',
      'radar:security',
      'radar:performance',
    ].includes(label)
);

const githubToken = process.env.GITHUB_TOKEN;
if (
  !githubToken ||
  process.env.POMI_GITHUB_APP_BOT_LOGIN !== 'pomi-radar[bot]'
) {
  throw new Error(
    'Pomi Radar GitHub App authentication is required. Run through scripts/github-app-auth.mjs.'
  );
}
const inputText =
  inputFlag >= 0 && process.argv[inputFlag + 1]
    ? readFileSync(process.argv[inputFlag + 1], 'utf8')
    : readFileSync(0, 'utf8');
const legacy = inputText.trim()
  ? JSON.parse(inputText)
  : { requests: { active: [], history: [] }, tracks: {} };
const actions = [];

async function github(path, init) {
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}${path}`,
    {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${githubToken}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        ...init.headers,
      },
    }
  );
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

function issueLabels(issue) {
  return issue.labels.map(label => label.name);
}

function withLifecycle(labels, lifecycle) {
  return [
    ...new Set([
      ...labels.filter(label => !LIFECYCLE.includes(label)),
      lifecycle,
    ]),
  ];
}

function setMarker(body, data) {
  const next = marker(RADAR_MARKER, { ...data, version: 1 });
  if (!readMarker(body, RADAR_MARKER))
    return `${String(body ?? '').trim()}\n\n${next}`.trim();
  return String(body).replace(/<!--\s*pomi-radar:v1\s+\{[^]*?\}\s*-->/, next);
}

function sourceLabel(record) {
  if (record.source === 'sentry') return 'radar:sentry';
  return record.kind === 'bug' ? 'radar:bug' : 'radar:feature';
}

function requestData(record) {
  return {
    version: 1,
    kind: record.kind,
    source: record.source,
    sourceId: record.sourceId,
    sourceIds: [record.sourceId].filter(Boolean),
    rootBehavior: normalizeText(record.title),
    summary: record.summary,
    whyNow: record.whyNow,
    currentState: record.currentState,
    details: record.details,
    evidence: record.evidence,
    tradeoffs: record.tradeoffs,
    validation: record.validation,
    acceptanceCriteria: record.acceptanceCriteria ?? [],
    questions: record.questions ?? [],
    clarificationRound: record.questions?.length ? 1 : 0,
    clarificationPrecedingState: 'radar:proposed',
    sentryGroupIds: [record.sentryIssueId].filter(Boolean),
    sentryShortIds: [record.sentryShortId].filter(Boolean),
    sentryStatus: record.sentryStatus,
    sentryFirstSeen: record.sentryFirstSeen,
    sentryLastSeen: record.sentryLastSeen,
  };
}

function requestLifecycle(record) {
  const states = {
    awaiting_clarification: 'radar:needs-user',
    answers_submitted: 'radar:needs-agent',
    awaiting_confirmation: 'radar:proposed',
    validated: 'radar:accepted',
    rejected: 'radar:rejected',
    in_progress: 'radar:in-progress',
    implemented: 'radar:released',
    blocked: 'radar:blocked',
  };
  return states[record.status] ?? 'radar:proposed';
}

const FEEDBACK_ENRICHMENT = {
  154: {
    codeArea: 'mobile notification channels and backend notification delivery',
    affectedBehavior: 'Notification vibration patterns by notification type',
    observed:
      'Android notification channels enable the same default vibration behavior, while APNs carries sound and notification type without a Pomi vibration contract.',
    expected:
      'Supported devices use a small, documented pattern matrix so work, break, long-break, and Task notifications are distinguishable without changing notification opt-in settings.',
    platform: ['android', 'ios-when-supported'],
    details:
      'Android already routes timer completions through distinct channels, so vibration belongs in the native channel contract. iOS support must be capability-sensitive and fall back cleanly when custom vibration is unavailable.',
    acceptanceCriteria: [
      'Work and break completion notifications have clearly distinguishable vibration behavior on supported Android versions, with the break pattern remaining the least intrusive.',
      'Task reminders and long-break milestones are distinguishable from the ordinary break signal where the operating system supports it.',
      'Existing notification permission, sound, and enablement settings remain authoritative.',
      'Unsupported iOS behavior falls back to the normal notification without claiming a custom vibration pattern.',
      'Native tests cover the notification-type-to-channel or pattern mapping.',
    ],
  },
  155: {
    codeArea:
      'MinimizedTaskView, expanded intentions picker, and PaginationControls',
    affectedBehavior: 'Desktop wheel and trackpad pagination',
    observed:
      'Desktop users must use pagination buttons or shortcuts to move through additional Task and Intention pages.',
    expected:
      'A wheel or trackpad gesture over either paginated surface snaps to the adjacent page.',
    platform: ['macos', 'desktop'],
    details:
      'The design contract already requires page snapping rather than free-scrolling. The implementation should share gesture thresholds and locking behavior where practical while keeping each surface bounded to its own page count.',
    acceptanceCriteria: [
      'Vertical wheel or trackpad gestures over the desktop Minimized task view move exactly one page in the gesture direction.',
      'The expanded desktop intentions picker supports the same previous/next page gesture.',
      'Gestures clamp at the first and last pages and do not scroll the surrounding page when a page transition is handled.',
      'Pagination buttons and existing keyboard shortcuts continue to work.',
      'Browser-component tests cover direction, gesture locking, and boundary behavior for both surfaces.',
    ],
  },
  156: {
    codeArea: 'TaskInlineProperties due-date popover',
    affectedBehavior: 'Saving an inline Task due-date selection',
    observed:
      'The popover keeps a local draft, discards it when the popover closes, and requires an Apply button.',
    expected:
      'Choosing a valid date persists it when the user clicks outside; Cancel remains the explicit way to discard the draft.',
    platform: ['desktop', 'mobile'],
    details:
      'Outside dismissal must wait for the update result and must not race the Cancel or Remove due date actions. Existing recurrence rules that require a due date remain enforced.',
    acceptanceCriteria: [
      'Selecting a different valid due date and clicking outside persists that date exactly once.',
      'The Apply button is removed and Cancel closes the popover without persisting the draft.',
      'Remove due date keeps its current behavior and recurring Tasks still cannot clear their required date.',
      'A failed update leaves the saved Task unchanged and surfaces the existing mutation failure feedback.',
      'Integration tests cover outside save, Cancel, removal, and update failure.',
    ],
  },
  157: {
    codeArea: 'MinimizedTaskView search and taskView filtering',
    affectedBehavior: 'Search scope in the Minimized task view',
    observed:
      'Search currently restricts candidates to the active timer type before matching the query.',
    expected:
      'While a query is present, search considers every active Task regardless of Work, Break, or Long-break type.',
    platform: ['macos', 'android', 'desktop', 'mobile'],
    details:
      'Search is a temporary cross-type discovery mode. Clearing it must restore the prior general or intention view and its normal timer-type filtering; completed and archived Tasks remain excluded.',
    acceptanceCriteria: [
      'A matching active Task appears even when its timer type differs from the current timer.',
      'Search results are not excluded by the current general or intention mode.',
      'Current-timer and pinned matches retain deterministic ranking without hiding other matches.',
      'Clearing search restores the previous mode, timer-type filtering, and normal pagination.',
      'React behavior tests cover cross-type results and restoration after clearing the query.',
    ],
  },
  158: {
    codeArea: 'Task settings, preferences, Tasks, and MinimizedTaskView',
    affectedBehavior: 'Visibility of Tasks covered by an active vacation',
    observed:
      'Vacation-covered Tasks continue to appear in Task lists with no visibility preference.',
    expected:
      'Vacation mode exposes a clearly worded, enabled-by-default setting that can hide covered Tasks from active Task surfaces.',
    platform: ['desktop', 'mobile'],
    details:
      'The preference changes presentation only: it must not modify Vacation Coverage, due dates, recurrence, or completion state. It should be stored with the user preferences so all Task surfaces agree.',
    acceptanceCriteria: [
      'When Vacation mode is enabled, Task settings offer an enabled-by-default control for showing Tasks covered by the active vacation.',
      'Turning the control off hides covered Tasks from the main Tasks list and Minimized task view without deleting or mutating them.',
      'Tasks outside the active vacation coverage remain visible.',
      'Ending Vacation mode makes the filter inactive, and re-enabling it preserves the user preference.',
      'The copy explains the effect without requiring the user to understand internal Vacation Coverage fields.',
      'Preference, list-filtering, and fixture tests demonstrate both states.',
    ],
  },
  159: {
    codeArea: 'uiStore taskMode and TaskModeToggle in MinimizedTaskView',
    affectedBehavior: 'Selected state of the default All tasks mode',
    observed:
      'The Minimized task view can display the default general Task list while neither mode button appears selected until interaction.',
    expected:
      'The All tasks control is visibly and accessibly selected on the first render whenever general mode is active.',
    platform: ['android', 'mobile', 'desktop'],
    details:
      'The store already defaults taskMode to general and TaskModeToggle derives aria-pressed from that state. The fix should preserve this invariant through mounting, responsive transitions, and any timer-driven mode synchronization.',
    acceptanceCriteria: [
      'Opening the Minimized task view in default general mode renders All tasks with its selected styling immediately.',
      'The All tasks button exposes aria-pressed=true while Current intentions exposes aria-pressed=false.',
      'No click, focus, or hydration delay is required for the selected state to appear.',
      'Switching modes updates both visual and accessible state exactly once.',
      'A rendered React test covers the initial Android-sized view and subsequent mode switching.',
    ],
  },
};

function proposalData(proposal, run, track) {
  return {
    version: 1,
    kind: 'proposal',
    track,
    source: `${track}_research`,
    sourceId: proposal.id,
    sourceIds: [proposal.id],
    rootBehavior: normalizeText(proposal.title),
    runId: proposal.runId ?? run?.id,
    rank: proposal.rank,
    summary: proposal.summary,
    whyNow: proposal.whyNow,
    currentState: proposal.currentState,
    details: proposal.details,
    evidence: proposal.evidence,
    tradeoffs: proposal.tradeoffs,
    validation: proposal.validation,
    effort: proposal.effort,
    confidence: proposal.confidence,
    generatedAt: proposal.generatedAt ?? run?.generatedAt,
  };
}

async function record(action) {
  actions.push(action);
  if (!APPLY || !action.apply) return action.result ?? null;
  return action.apply();
}

async function ensureLabels() {
  const existing = await paginate('/labels');
  const names = new Set(existing.map(label => label.name));
  for (const [name, [color, description]] of Object.entries(LABELS)) {
    if (names.has(name)) continue;
    await record({
      type: 'create-label',
      name,
      apply: () =>
        github('/labels', {
          method: 'POST',
          body: JSON.stringify({ name, color, description }),
        }),
    });
  }
}

async function updateExistingIssue(issue, incoming, source, lifecycle) {
  const current = readMarker(issue.body, RADAR_MARKER) ?? {};
  const data = { ...current, ...incoming, version: 1 };
  const currentLifecycle = issueLabels(issue).find(label =>
    LIFECYCLE.includes(label)
  );
  const effectiveLifecycle =
    lifecycle === 'radar:proposed' && currentLifecycle
      ? currentLifecycle
      : lifecycle;
  const labels = withLifecycle(
    [...issueLabels(issue), source],
    effectiveLifecycle
  );
  const body = setMarker(issue.body, data);
  const terminal =
    effectiveLifecycle === 'radar:released' ||
    effectiveLifecycle === 'radar:rejected';
  const state = terminal ? 'closed' : 'open';
  if (
    body === issue.body &&
    JSON.stringify(labels.sort()) ===
      JSON.stringify(issueLabels(issue).sort()) &&
    issue.state === state
  )
    return issue;
  return record({
    type: 'update-issue',
    number: issue.number,
    source,
    lifecycle: effectiveLifecycle,
    apply: () =>
      github(`/issues/${issue.number}`, {
        method: 'PATCH',
        body: JSON.stringify({
          body,
          labels,
          state,
          state_reason: terminal
            ? effectiveLifecycle === 'radar:rejected'
              ? 'not_planned'
              : 'completed'
            : issue.state === 'closed'
              ? 'reopened'
              : undefined,
        }),
      }),
    result: issue,
  });
}

async function createIssue(title, body, source, data) {
  return record({
    type: 'create-issue',
    title,
    source,
    apply: () =>
      github('/issues', {
        method: 'POST',
        body: JSON.stringify({
          title,
          body: `${body.trim()}\n\n${marker(RADAR_MARKER, data)}`,
          labels: [source, 'radar:proposed'],
        }),
      }),
  });
}

async function commentOnce(number, readable, id) {
  const event = marker(EVENT_MARKER, { id });
  const comments = await paginate(`/issues/${number}/comments`);
  if (comments.some(comment => String(comment.body).includes(event))) return;
  await record({
    type: 'comment',
    number,
    event: id,
    apply: () =>
      github(`/issues/${number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: `${readable}\n\n${event}` }),
      }),
  });
}

async function noteSentry(groupId, issueUrl) {
  if (!process.env.SENTRY_AUTH_TOKEN) {
    actions.push({
      type: 'sentry-note-blocked',
      groupId,
      reason: 'SENTRY_AUTH_TOKEN missing',
    });
    return;
  }
  const base = (process.env.SENTRY_BASE_URL || 'https://sentry.io').replace(
    /\/$/,
    ''
  );
  const org = process.env.SENTRY_ORG;
  const markerText = `[pomi-radar:v1 group=${groupId}]`;
  const endpoint = `${base}/api/0/organizations/${org}/issues/${groupId}/comments/`;
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
  });
  if (!response.ok) {
    actions.push({
      type: 'sentry-note-unavailable',
      groupId,
      status: response.status,
    });
    return;
  }
  const comments = await response.json();
  if (
    comments.some(comment =>
      String(comment.data?.text ?? comment.text ?? '').includes(markerText)
    )
  )
    return;
  actions.push({ type: 'sentry-note', groupId, issueUrl });
  if (!APPLY) return;
  const created = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: `Tracked by canonical GitHub issue: ${issueUrl}\n\n${markerText}`,
    }),
  });
  if (!created.ok)
    actions.push({
      type: 'sentry-note-unavailable',
      groupId,
      status: created.status,
    });
}

function sentryLinkCursor(link) {
  for (const part of String(link ?? '').split(',')) {
    if (!/rel="next"/.test(part) || !/results="true"/.test(part)) continue;
    return part.match(/cursor="([^"]+)"/)?.[1] ?? null;
  }
  return null;
}

async function listSentryProject(project) {
  if (!process.env.SENTRY_AUTH_TOKEN || !process.env.SENTRY_ORG || !project)
    return [];
  const base = (process.env.SENTRY_BASE_URL || 'https://sentry.io').replace(
    /\/$/,
    ''
  );
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
      `${base}/api/0/projects/${process.env.SENTRY_ORG}/${project}/issues/?${query}`,
      {
        headers: { authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
      }
    );
    if (!response.ok)
      throw new Error(`Sentry list for ${project} failed: ${response.status}`);
    values.push(...(await response.json()));
    cursor = sentryLinkCursor(response.headers.get('link'));
  } while (cursor);
  return values;
}

function sentryRoot(issue) {
  return normalizeText(
    `${issue.metadata?.type ?? ''} ${issue.metadata?.value ?? issue.title ?? ''}`
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
      .replace(/client id:\s*\S+/gi, 'client id')
  );
}

async function main() {
  await ensureLabels();
  let issues = (
    await paginate('/issues?state=all&sort=created&direction=asc')
  ).filter(issue => !issue.pull_request);
  const byNumber = new Map(issues.map(issue => [issue.number, issue]));
  const legacyRequests = [
    ...(legacy.requests?.active ?? []),
    ...(legacy.requests?.history ?? []),
  ];
  const migrationRadarIssueNumbers = new Set([
    ...legacyRequests.map(record => record.issueNumber).filter(Boolean),
    ...issues
      .filter(issue => issueLabels(issue).includes('feedback'))
      .map(issue => issue.number),
  ]);

  for (const record of legacyRequests.filter(item => item.issueNumber)) {
    const issue = byNumber.get(record.issueNumber);
    if (issue)
      await updateExistingIssue(
        issue,
        requestData(record),
        sourceLabel(record),
        requestLifecycle(record)
      );
  }

  issues = APPLY
    ? (await paginate('/issues?state=all&sort=created&direction=asc')).filter(
        issue => !issue.pull_request
      )
    : issues;

  for (const issue of issues.filter(
    value =>
      issueLabels(value).includes('feedback') &&
      (!readMarker(value.body, RADAR_MARKER) ||
        FEEDBACK_ENRICHMENT[value.number])
  )) {
    const kind = issueLabels(issue).includes('bug') ? 'bug' : 'feature';
    await updateExistingIssue(
      issue,
      {
        version: 1,
        kind,
        source: 'user_feedback',
        sourceId: `github-feedback:${issue.number}`,
        sourceIds: [`github-feedback:${issue.number}`],
        rootBehavior: normalizeText(
          issue.title.replace(/^\[Feedback\]\s*/i, '')
        ),
        summary: String(issue.body ?? '')
          .split('\n\n---')[0]
          .trim(),
        acceptanceCriteria: [],
        questions: [],
        clarificationRound: 0,
        ...(FEEDBACK_ENRICHMENT[issue.number] ?? {}),
      },
      kind === 'bug' ? 'radar:bug' : 'radar:feature',
      issue.state === 'closed'
        ? issue.state_reason === 'not_planned'
          ? 'radar:rejected'
          : 'radar:released'
        : 'radar:proposed'
    );
  }

  issues = APPLY
    ? (await paginate('/issues?state=all&sort=created&direction=asc')).filter(
        issue => !issue.pull_request
      )
    : issues;

  const nonIssueRequests = legacyRequests.filter(item => !item.issueNumber);
  const currentSentry = (
    await Promise.all([
      listSentryProject(process.env.SENTRY_FRONTEND_PROJECT),
      listSentryProject(process.env.SENTRY_BACKEND_PROJECT),
    ])
  ).flat();
  for (const issue of currentSentry) {
    const existing = nonIssueRequests.find(
      item => item.sentryIssueId === issue.id
    );
    if (existing) {
      existing.sentryShortId = issue.shortId;
      existing.sentryStatus = issue.status;
      existing.sentryFirstSeen = issue.firstSeen;
      existing.sentryLastSeen = issue.lastSeen;
      continue;
    }
    nonIssueRequests.push({
      id: `sentry-${issue.id}`,
      issueNumber: null,
      title: `[${issue.project.slug === process.env.SENTRY_FRONTEND_PROJECT ? 'frontend' : 'backend'}] ${issue.metadata?.value ?? issue.title}`,
      kind: 'bug',
      source: 'sentry',
      sourceId: `sentry-${issue.project.slug}-${issue.id}`,
      summary: `${issue.title}${issue.culprit ? ` in ${issue.culprit}` : ''}`,
      status: 'awaiting_confirmation',
      acceptanceCriteria: [],
      questions: [],
      sentryIssueId: issue.id,
      sentryShortId: issue.shortId,
      sentryStatus: issue.status,
      sentryFirstSeen: issue.firstSeen,
      sentryLastSeen: issue.lastSeen,
      sentryRoot: sentryRoot(issue),
    });
  }
  const sentryGroups = new Map();
  const canonicalBySentryId = new Map();
  for (const request of nonIssueRequests.filter(
    item => item.source === 'sentry'
  )) {
    const current = currentSentry.find(
      issue => issue.id === request.sentryIssueId
    );
    const key =
      request.sentryRoot ||
      (current ? sentryRoot(current) : normalizeText(request.title));
    const group = sentryGroups.get(key) ?? [];
    group.push(request);
    sentryGroups.set(key, group);
  }
  for (const group of sentryGroups.values()) {
    const first = group[0];
    const groupIds = [
      ...new Set(group.map(item => item.sentryIssueId).filter(Boolean)),
    ];
    const existing = issues.find(issue => {
      const item = readMarker(issue.body, RADAR_MARKER) ?? {};
      return (
        item.sourceIds?.includes(first.sourceId) ||
        item.sentryGroupIds?.some(id => groupIds.includes(id))
      );
    });
    const payload = {
      ...requestData(first),
      sourceIds: group.map(item => item.sourceId),
      sentryGroupIds: groupIds,
    };
    const canonical = existing
      ? await updateExistingIssue(
          existing,
          payload,
          'radar:sentry',
          'radar:proposed'
        )
      : await createIssue(first.title, first.summary, 'radar:sentry', payload);
    if (APPLY && canonical?.html_url) {
      for (const groupId of groupIds) {
        canonicalBySentryId.set(groupId, canonical.number);
        await noteSentry(groupId, canonical.html_url);
      }
    }
  }

  for (const request of nonIssueRequests.filter(
    item => item.source === 'daily_feature'
  )) {
    const existing = issues.find(issue =>
      (readMarker(issue.body, RADAR_MARKER)?.sourceIds ?? []).includes(
        request.sourceId
      )
    );
    if (existing)
      await updateExistingIssue(
        existing,
        requestData(request),
        'radar:feature',
        'radar:proposed'
      );
    else
      await createIssue(
        request.title,
        request.summary,
        'radar:feature',
        requestData(request)
      );
  }

  for (const track of ['security', 'performance']) {
    const run = legacy.tracks?.[track]?.run;
    for (const proposal of legacy.tracks?.[track]?.proposals ?? []) {
      const existing = issues.find(issue =>
        (readMarker(issue.body, RADAR_MARKER)?.sourceIds ?? []).includes(
          proposal.id
        )
      );
      const payload = proposalData(proposal, run, track);
      if (existing)
        await updateExistingIssue(
          existing,
          payload,
          `radar:${track}`,
          'radar:proposed'
        );
      else
        await createIssue(
          proposal.title,
          proposal.summary,
          `radar:${track}`,
          payload
        );
    }
  }

  const latestRelease = await github('/releases/latest', {});
  const mergedPulls = (
    await paginate('/pulls?state=closed&sort=updated&direction=desc')
  ).filter(
    pull =>
      pull.merged_at &&
      new Date(pull.merged_at) > new Date(latestRelease.published_at)
  );
  async function markReady(number, pull) {
    const issue = await github(`/issues/${number}`, {});
    const current = readMarker(issue.body, RADAR_MARKER) ?? {
      version: 1,
      kind: issueLabels(issue).includes('bug') ? 'bug' : 'feature',
      source: 'user_feedback',
      sourceId: `github-feedback:${number}`,
      sourceIds: [`github-feedback:${number}`],
      rootBehavior: normalizeText(issue.title),
      summary: String(issue.body ?? '')
        .split('\n\n---')[0]
        .trim(),
    };
    const next = {
      ...current,
      consolidationPullRequest: pull.number,
      consolidationMergeSha: pull.merge_commit_sha,
      version: 1,
    };
    const nextLabels = withLifecycle(
      issueLabels(issue),
      'radar:ready-for-release'
    );
    const nextBody = setMarker(issue.body, next);
    if (
      nextBody !== issue.body ||
      issue.state !== 'open' ||
      !issueLabels(issue).includes('radar:ready-for-release')
    ) {
      await record({
        type: 'ready-for-release',
        number,
        pull: pull.number,
        mergeSha: pull.merge_commit_sha,
        apply: () =>
          github(`/issues/${number}`, {
            method: 'PATCH',
            body: JSON.stringify({
              body: nextBody,
              labels: nextLabels,
              state: 'open',
              state_reason: issue.state === 'closed' ? 'reopened' : undefined,
            }),
          }),
      });
    }
    await commentOnce(
      number,
      `Merged in PR #${pull.number} at \`${pull.merge_commit_sha}\`. Ready for the next production release.`,
      `migration:ready:${number}:${pull.merge_commit_sha}`
    );
  }
  for (const pull of mergedPulls) {
    const radarPull = Boolean(
      readMarker(pull.body, 'pomi-radar-source:v1') ||
      readMarker(pull.body, 'pomi-radar-consolidation:v1')
    );
    const references = [
      ...String(pull.body ?? '').matchAll(
        /(?:Related|Fixes|Closes|Resolves)\s+#(\d+)/gi
      ),
      ...String(pull.body ?? '').matchAll(
        /Improvement Radar issue[- ]#?(\d+)/gi
      ),
    ].map(match => Number(match[1]));
    for (const number of [...new Set(references)]) {
      const referencedIssue = byNumber.get(number);
      const alreadyRadar =
        referencedIssue &&
        (Boolean(readMarker(referencedIssue.body, RADAR_MARKER)) ||
          issueLabels(referencedIssue).some(label =>
            label.startsWith('radar:')
          ) ||
          migrationRadarIssueNumbers.has(number));
      if (!radarPull && !alreadyRadar) continue;
      await markReady(number, pull);
    }
    const sentryIssueNumbers = currentSentry
      .filter(issue => String(pull.body ?? '').includes(issue.shortId))
      .map(issue => canonicalBySentryId.get(issue.id))
      .filter(Boolean);
    for (const number of [...new Set(sentryIssueNumbers)])
      await markReady(number, pull);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: APPLY ? 'apply' : 'dry-run',
        latestProductionRelease: latestRelease.tag_name,
        actionCount: actions.length,
        actions: actions.map(action =>
          Object.fromEntries(
            Object.entries(action).filter(
              ([key]) => key !== 'apply' && key !== 'result'
            )
          )
        ),
      },
      null,
      2
    )}\n`
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
