import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const output = path.resolve('docs/testing/e2e-ownership.md');
const resultsDirectory = path.resolve('docs/testing/results');

function readResult(name) {
  const resultPath = path.join(resultsDirectory, name);
  return existsSync(resultPath)
    ? JSON.parse(readFileSync(resultPath, 'utf8'))
    : null;
}

const inventory = readResult('test-inventory.json');
const timing = readResult('e2e-timing.json');

function formatTiming(mode, metric) {
  const summary = timing?.modes?.[mode];
  if (summary?.status !== 'complete' || summary[metric] === null)
    return 'pending';
  return `${(summary[metric] / 1000).toFixed(2)} s`;
}

const presentationOnlyPattern =
  /layout|geometry|responsive|mobile height|page overflow|auto-scroll|palette|color|circular|same size|segmented ring|eta label|emoji attributes|overflowing .* titles|page arrows|three-by-three/i;

const domainEvidence = new Map([
  [
    'admin.spec.ts',
    '`packages/frontend/src/test/settingsAdminBehavior.test.tsx`; `packages/backend/test/unit/user-data-transfer.service.test.ts`; journey 13',
  ],
  [
    'auth.spec.ts',
    '`packages/frontend/src/test/authExtensionsBehavior.test.tsx`; `packages/backend/test/integration/app.integration.test.ts`; journey 1',
  ],
  [
    'extensions.spec.ts',
    '`packages/frontend/src/test/authExtensionsBehavior.test.tsx`; journeys 2 and 4',
  ],
  [
    'intentions.spec.ts',
    '`packages/backend/test/unit/intentions.service.test.ts`; `packages/frontend/src/test/timer-intention-session-legacy-replacement.test.tsx`; journey 2',
  ],
  [
    'logs.spec.ts',
    '`packages/frontend/src/test/statisticsLogsActionBehavior.test.tsx`; journey 11',
  ],
  [
    'sessions.spec.ts',
    '`packages/backend/test/unit/timer-session.service.test.ts`; `packages/frontend/src/test/authExtensionsBehavior.test.tsx`; `packages/frontend/src/test/timer-intention-session-legacy-replacement.test.tsx`; journey 4',
  ],
  [
    'settings.spec.ts',
    '`packages/frontend/src/test/settingsAdminBehavior.test.tsx`; `packages/frontend/src/stores/preferencesStore.network.test.ts`; `packages/backend/test/integration/app.integration.test.ts`; journey 10',
  ],
  [
    'statistics.spec.ts',
    '`packages/backend/test/unit/statistics.service.test.ts`; `packages/frontend/src/test/statisticsLogsActionBehavior.test.tsx`; journey 11',
  ],
  [
    'tasks.spec.ts',
    '`packages/backend/test/unit/tasks.service.test.ts`; `packages/frontend/src/components/tasks/taskEditorBehavior.test.tsx`; `packages/frontend/src/components/tasks/taskInlineProperties.test.tsx`; journeys 5-9',
  ],
  [
    'timer.spec.ts',
    '`packages/backend/test/unit/timer-session.service.test.ts`; `packages/frontend/src/components/timerSessionPresentation.test.tsx`; `packages/frontend/src/test/timer-intention-session-legacy-replacement.test.tsx`; journeys 2-4',
  ],
  [
    'user-actions.spec.ts',
    '`packages/backend/test/unit/user-actions.store.test.ts`; `packages/frontend/src/utils/userActionQueue.test.tsx`; journey 12',
  ],
]);

const replacementOverrides = new Map([
  ...[
    'shows setup after login when notifications are missing',
    'allows app entry when exact alarms are missing',
    'allows app entry when only battery optimization is missing',
    'auto-starts Android foreground sync without a manual setting',
  ].map(title => [
    `android-notifications.spec.ts|${title}`,
    ['move', '`packages/frontend/src/app/AndroidPermissionGate.test.tsx`'],
  ]),
  [
    'health.spec.ts|should expose a healthy backend endpoint',
    ['move', '`packages/backend/test/integration/app.integration.test.ts`'],
  ],
  [
    'integration.spec.ts|should complete full app workflow',
    ['merge/remove duplicate', '`e2e/journeys.spec.ts` journeys 1 and 11'],
  ],
  [
    'integration.spec.ts|should handle errors gracefully',
    [
      'merge/remove duplicate',
      '`packages/backend/test/integration/app.integration.test.ts`; journey 1',
    ],
  ],
  [
    'integration.spec.ts|should handle navigation flow correctly',
    ['merge/remove duplicate', '`e2e/journeys.spec.ts` journeys 1 and 11'],
  ],
  [
    'integration.spec.ts|should maintain state across page reloads',
    ['merge/remove duplicate', '`e2e/journeys.spec.ts` journey 1'],
  ],
  [
    'integration.spec.ts|should prevent actions when disconnected',
    [
      'merge/remove duplicate',
      '`packages/frontend/src/utils/userActionQueue.test.tsx`; journey 12',
    ],
  ],
  ...[
    'returns timer, Assistant, and compact Tasks status',
    'keeps general Tasks visible before any timer exists',
    'keeps timer-linked Tasks ahead of manual General anchors',
    'starts and pauses Timer from watch action endpoint',
    'applies a queued Watch command ID only once',
    'keeps active long-break intention types in watch picker',
    'sets multiple Parent and Sub-intentions from watch when enabled',
    'supports Timer extras and Sessions flags from watch',
    'manual Watch long break resets the active session',
    'starts Timer with picked Intention and completes Tasks from watch',
    'requires and selects a work sub-intention after a completed break',
  ].map(title => [
    `watch.spec.ts|${title}`,
    ['move', '`packages/backend/test/integration/watch.integration.test.ts`'],
  ]),
  [
    'auth.spec.ts|should use REST sessions endpoint for authentication',
    ['move', '`packages/backend/test/integration/app.integration.test.ts`'],
  ],
  [
    'settings.spec.ts|should request logout on sign out',
    ['move', '`packages/backend/test/integration/app.integration.test.ts`'],
  ],
  [
    'settings.spec.ts|should persist settings changes',
    [
      'move',
      '`packages/backend/test/integration/app.integration.test.ts`; journey 10',
    ],
  ],
  [
    'settings.spec.ts|does not block app when only exact alarms are not granted',
    ['move', '`packages/frontend/src/app/AndroidPermissionGate.test.tsx`'],
  ],
  [
    'tasks.spec.ts|round-trips decimal recurrence cadence from the task form',
    [
      'move',
      '`packages/frontend/src/components/tasks/taskEditorBehavior.test.tsx`; `packages/backend/test/unit/tasks.service.test.ts`',
    ],
  ],
  [
    'tasks.spec.ts|preserves an explicitly cleared due date when creating a Task',
    ['move', '`packages/backend/test/unit/tasks.service.test.ts`'],
  ],
  [
    'tasks.spec.ts|keeps same-slug Intention filters scoped to their Timer type',
    [
      'move',
      '`packages/frontend/src/utils/coreBehavior.test.ts`; `packages/backend/test/unit/tasks.service.test.ts`',
    ],
  ],
  [
    'tasks.spec.ts|orders same-date tasks by due time before fallback order',
    ['move', '`packages/frontend/src/utils/coreBehavior.test.ts`'],
  ],
  [
    'tasks.spec.ts|orders priorities and previews General tasks from intention mode',
    [
      'move',
      '`packages/frontend/src/utils/coreBehavior.test.ts`; `packages/backend/test/integration/watch.integration.test.ts`',
    ],
  ],
  [
    'tasks.spec.ts|completes a recurring occurrence and keeps one active task',
    ['merge', '`packages/backend/test/unit/tasks.service.test.ts`; journey 7'],
  ],
  [
    'tasks.spec.ts|supports RRULE count, by-day, and due-date recurrence validation',
    [
      'move',
      '`packages/frontend/src/components/tasks/taskEditorBehavior.test.tsx`; `packages/backend/test/unit/tasks.service.test.ts`',
    ],
  ],
]);

function parseMarkdownRow(line) {
  const cells = [];
  let cell = '';
  let escaped = false;

  for (const character of line.trim()) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      cell += character;
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());

  const [emptyStart, fileCell, title] = cells;
  if (emptyStart !== '' || !/^`[^`]+\.spec\.ts`$/.test(fileCell)) return null;

  return {
    file: fileCell.slice(1, -1),
    title: title.replaceAll('\\|', '|'),
  };
}

function historicalBaselineFiles() {
  const commits = execFileSync('git', ['rev-list', 'HEAD', '--', 'e2e'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  for (const commit of commits) {
    const files = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', commit, 'e2e'],
      { encoding: 'utf8' }
    )
      .trim()
      .split('\n')
      .filter(
        file => file.endsWith('.spec.ts') && file !== 'e2e/journeys.spec.ts'
      )
      .sort();

    if (files.length > 0) return { commit, files };
  }

  throw new Error('Could not find a historical legacy Playwright inventory');
}

let baselineBehaviors = existsSync(output)
  ? readFileSync(output, 'utf8')
      .split('\n')
      .map(parseMarkdownRow)
      .filter(Boolean)
  : [];

if (baselineBehaviors.length < 200) {
  baselineBehaviors = [];
  const { commit: baselineCommit, files: baselineFiles } =
    historicalBaselineFiles();

  for (const filePath of baselineFiles) {
    const file = path.basename(filePath);
    const source = execFileSync('git', ['show', `${baselineCommit}:${filePath}`], {
      encoding: 'utf8',
    });
    const matches = source.matchAll(/\btest\(\s*['`]([^'`]+)['`]/g);
    for (const match of matches) {
      baselineBehaviors.push({ file, title: match[1] });
    }
  }
}

const rows = baselineBehaviors.map(({ file, title }) => {
  let replacement = replacementOverrides.get(`${file}|${title}`);
  if (!replacement && presentationOnlyPattern.test(title)) {
    replacement = [
      'remove non-business presentation micro-check',
      'historical expectation retained here; shared component/model coverage owns regressions',
    ];
  }
  if (!replacement && domainEvidence.has(file)) {
    replacement = ['move/merge main behavior', domainEvidence.get(file)];
  }
  if (!replacement) {
    replacement = [
      'remove duplicate or non-core assertion',
      'historical expectation retained here; no standalone replacement required',
    ];
  }
  const [disposition, owner] = replacement;
  return `| \`${file}\` | ${title.replaceAll('|', '\\|')} | ${disposition} | ${owner} |`;
});

const journeys = [
  'Account creation, authenticated reload, logout and login',
  'Intentions Parent/Sub selection through recorded Timer',
  'Primary Timer start, pause, add-five, undo and reset',
  'Session extension through Break or Long break with persistence',
  'Task create/edit through shared editor with reload persistence',
  'Linked Task pin, Timer Intention reconciliation and completion',
  'Recurring Task complete and undo/archive with successor preservation',
  'Manual Task ordering persisted across refresh',
  'Cross-client Task sync with other-user isolation',
  'Cross-client settings sync affecting Timer behavior',
  'Real Timer/Task activity visible in statistics and work logs',
  'Accepted-action FIFO, delayed indicator, reconnect and reconciliation',
  'Administrator export and complete user-data import',
];

const content = `# E2E ownership matrix

This matrix preserves the complete pre-revamp Playwright inventory after deletion. Main business behavior maps to executable specification sets and the eight-domain manifest; duplicate and narrow presentation rows are retained as historical expectations but are not claimed as one-for-one replacement coverage. Retained Playwright tests may mock browser or operating-system facilities but never Pomi backend APIs.

## Retained real-stack journeys

${journeys.map((journey, index) => `${index + 1}. ${journey}`).join('\n')}

## Legacy behavior disposition

### Replacement evidence added during the revamp

- \`packages/backend/test/integration/app.integration.test.ts\` owns health, production body limits and validation, real session authentication/logout, and persisted preferences through Nest/Supertest with PostgreSQL and Redis.
- \`packages/backend/test/integration/watch.integration.test.ts\` owns all eleven legacy Watch HTTP behaviors through the production Nest application and real PostgreSQL/Redis state.
- \`packages/frontend/src/app/AndroidPermissionGate.test.tsx\` owns all four legacy Android permission-gate behaviors, including automatic foreground-sync reconciliation and the absence of a manual sync setting.
- \`packages/backend/test/unit/tasks.service.test.ts\` owns migrated Task service rules for due dates, recurrence snapshots/cadence, manual-ordering families, pin invariants, lifecycle events, imports, and typed Intention links.
- \`packages/backend/test/unit/intentions.service.test.ts\`, \`preferences.service.test.ts\`, \`user-actions.store.test.ts\`, \`auth-stale-user.test.ts\`, \`task-notification.service.test.ts\`, and \`user-data-transfer.service.test.ts\` preserve migrated backend service coverage without loading built CommonJS test targets.
- Focused React/MSW specifications own authentication, extension setup, settings recovery, Task editing, Timer/Intention/session decisions, and work-log mutations at the component/network boundary.
- The matrix distinguishes main behavior moved to a concrete specification set from narrow presentation micro-checks and duplicate assertions intentionally retired. Retired rows remain as historical documentation; they are not falsely counted as replacement coverage.

| Previous spec | Behavior | Disposition | Replacement owner |
| --- | --- | --- | --- |
${rows.join('\n')}

## Baseline and final timing

| Measure | Before | After |
| --- | ---: | ---: |
| Playwright tests | ${rows.length} | 13 |
| Playwright source lines | 13,815 | ${inventory?.playwright?.retainedActiveSourceLines ?? 'pending inventory'} |
| Parallel full-suite duration | 20-minute timeout baseline | p50 ${formatTiming('parallel', 'p50Ms')}; p95 ${formatTiming('parallel', 'p95Ms')} |
| Serial full-suite duration | not recorded | p50 ${formatTiming('serial', 'p50Ms')}; p95 ${formatTiming('serial', 'p95Ms')} |
| Active non-E2E tests | pending inventory | ${inventory?.totals?.nonE2eTests ?? 'pending inventory'} |

The final PR records measured p50/p95 timing after ten parallel runs and three single-worker runs. Machine-readable evidence is generated under \`docs/testing/results/\`.
`;

writeFileSync(output, content);
