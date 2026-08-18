import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const outputArgument = process.argv.find(argument =>
  argument.startsWith('--output-dir=')
);
const outputDirectory = path.resolve(
  root,
  outputArgument?.slice('--output-dir='.length) ?? 'docs/testing/results'
);

function filesUnder(directory, predicate) {
  if (!directory) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(entryPath, predicate);
    return predicate(entryPath) ? [entryPath] : [];
  });
}

function lineCount(filePath) {
  const source = readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n');
  if (source.length === 0) return 0;
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
}

function matchCount(filePath, pattern) {
  return [...readFileSync(filePath, 'utf8').matchAll(pattern)].length;
}

const vitest = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'list', '--staticParse', '--json'],
  { cwd: root, encoding: 'utf8' }
);

if (vitest.status !== 0) {
  process.stderr.write(vitest.stderr);
  process.exit(vitest.status ?? 1);
}

const vitestCases = JSON.parse(vitest.stdout);
const projectFiles = {
  'shared-unit': filesUnder(path.join(root, 'packages/shared/src'), filePath =>
    filePath.endsWith('.test.ts')
  ),
  'backend-unit': filesUnder(
    path.join(root, 'packages/backend/test/unit'),
    filePath => filePath.endsWith('.test.ts')
  ),
  'frontend-unit': filesUnder(
    path.join(root, 'packages/frontend/src'),
    filePath =>
      (filePath.endsWith('.test.ts') || filePath.endsWith('.test.tsx')) &&
      !filePath.endsWith('.browser.test.tsx')
  ),
  'backend-integration': filesUnder(
    path.join(root, 'packages/backend/test/integration'),
    filePath => filePath.endsWith('.integration.test.ts')
  ),
  'frontend-browser': filesUnder(
    path.join(root, 'packages/frontend/src'),
    filePath => filePath.endsWith('.browser.test.tsx')
  ),
};
const vitestProjects = Object.fromEntries(
  Object.entries(projectFiles).map(([projectName, files]) => {
    const collectedCases = vitestCases.filter(testCase =>
      testCase.projectName.startsWith(projectName)
    );
    const declaredTests = files.reduce(
      (total, filePath) => total + matchCount(filePath, /\b(?:test|it)\s*\(/g),
      0
    );
    return [
      projectName,
      {
        tests: Math.max(collectedCases.length, declaredTests),
        files: files.filter(
          filePath => matchCount(filePath, /\b(?:test|it)\s*\(/g) > 0
        ).length,
        staticCollectedTests: collectedCases.length,
        declaredTests,
      },
    ];
  })
);

const legacyNodeFiles = filesUnder(
  path.join(root, 'packages/backend/test'),
  filePath =>
    filePath.endsWith('.test.cjs') &&
    !filePath.endsWith('assistant-live.test.cjs')
);
const wearTestFiles = filesUnder(
  path.join(root, 'packages/frontend/src-tauri/gen/android/wear/src/test'),
  filePath => filePath.endsWith('.kt')
);
const rustTestFiles = filesUnder(
  path.join(root, 'packages/frontend/src-tauri/src'),
  filePath => filePath.endsWith('.rs')
);
const retainedSpec = path.join(root, 'e2e/journeys.spec.ts');
const retainedHelper = path.join(root, 'e2e/journey-helpers.ts');
const legacyPlaywrightFiles = filesUnder(
  path.join(root, 'e2e'),
  filePath => filePath.endsWith('.spec.ts') && filePath !== retainedSpec
);

const legacyNodeTests = legacyNodeFiles.reduce(
  (total, filePath) => total + matchCount(filePath, /\b(?:test|it)\s*\(/g),
  0
);
const wearTests = wearTestFiles.reduce(
  (total, filePath) => total + matchCount(filePath, /@Test\b/g),
  0
);
const rustTests = rustTestFiles.reduce(
  (total, filePath) => total + matchCount(filePath, /#\s*\[\s*test\s*\]/g),
  0
);
const playwrightDeclaration = /\btest\(\s*['`]([^'`]+)['`]/g;
const retainedJourneys = matchCount(retainedSpec, playwrightDeclaration);
const legacyPlaywrightTests = legacyPlaywrightFiles.reduce(
  (total, filePath) => total + matchCount(filePath, playwrightDeclaration),
  0
);
const vitestTotal = Object.values(vitestProjects).reduce(
  (total, project) => total + project.tests,
  0
);

const inventory = {
  schemaVersion: 1,
  generatedBy: 'pnpm test:inventory',
  countingMethod: {
    vitest: 'vitest list --staticParse --json',
    conditionalVitestSuites:
      'maximum of static collection and source test declarations',
    nativeAndLegacy: 'static test declaration count',
    sourceLines: 'physical lines',
  },
  vitest: {
    total: vitestTotal,
    projects: vitestProjects,
  },
  legacyNode: {
    tests: legacyNodeTests,
    files: legacyNodeFiles.length,
  },
  native: {
    wearTests,
    wearFiles: wearTestFiles.length,
    rustTests,
    rustFiles: rustTestFiles.length,
  },
  playwright: {
    retainedJourneys,
    retainedSpecLines: lineCount(retainedSpec),
    retainedHelperLines: lineCount(retainedHelper),
    retainedActiveSourceLines:
      lineCount(retainedSpec) + lineCount(retainedHelper),
    legacyTests: legacyPlaywrightTests,
    legacySpecFiles: legacyPlaywrightFiles.length,
    legacySourceLines: legacyPlaywrightFiles.reduce(
      (total, filePath) => total + lineCount(filePath),
      0
    ),
  },
  totals: {
    nonE2eTests: vitestTotal + legacyNodeTests + wearTests + rustTests,
    activeTests:
      vitestTotal + legacyNodeTests + wearTests + rustTests + retainedJourneys,
  },
};

const markdown = `# Test-suite inventory

Generated by \`pnpm test:inventory\`. Vitest counts are collected statically and do not execute PostgreSQL, Redis, browsers, or product code.

| Layer | Tests | Files |
| --- | ---: | ---: |
${Object.entries(vitestProjects)
  .map(
    ([name, project]) =>
      `| Vitest ${name} | ${project.tests} | ${project.files} |`
  )
  .join('\n')}
| Legacy Node | ${legacyNodeTests} | ${legacyNodeFiles.length} |
| Wear JUnit | ${wearTests} | ${wearTestFiles.length} |
| Rust | ${rustTests} | ${rustTestFiles.length} |
| Retained Playwright | ${retainedJourneys} | 1 |
| **Active total** | **${inventory.totals.activeTests}** | |

## Playwright source

| Measure | Count |
| --- | ---: |
| Retained journey spec lines | ${inventory.playwright.retainedSpecLines} |
| Retained helper lines | ${inventory.playwright.retainedHelperLines} |
| Active Playwright source lines | ${inventory.playwright.retainedActiveSourceLines} |
| Transitional legacy tests | ${inventory.playwright.legacyTests} |
| Transitional legacy spec lines | ${inventory.playwright.legacySourceLines} |
`;

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  path.join(outputDirectory, 'test-inventory.json'),
  `${JSON.stringify(inventory, null, 2)}\n`
);
writeFileSync(path.join(outputDirectory, 'test-inventory.md'), markdown);

process.stdout.write(
  `Wrote test inventory to ${path.relative(root, outputDirectory)}\n`
);
