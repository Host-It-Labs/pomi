import { readFileSync } from 'node:fs';

const baseline = JSON.parse(
  readFileSync(new URL('../config/coverage-baseline.json', import.meta.url))
);
const summary = JSON.parse(
  readFileSync(new URL('../coverage/coverage-summary.json', import.meta.url))
);
const modeArgument = process.argv.find(argument =>
  argument.startsWith('--mode=')
);
const mode = modeArgument?.slice('--mode='.length);

if (mode !== 'ratchet' && mode !== 'business') {
  throw new Error('Expected --mode=ratchet or --mode=business');
}

const failures = [];
const metrics = ['lines', 'statements', 'functions', 'branches'];

for (const metric of metrics) {
  const current = summary.total[metric];
  const floor = baseline.baseline[metric];

  const floorPercent = (floor.covered / floor.total) * 100;
  if (current.covered < floor.covered) {
    failures.push(
      `${metric}: ${current.covered} covered is below baseline ${floor.covered}`
    );
  }

  if (current.covered * floor.total < floor.covered * current.total) {
    failures.push(
      `${metric}: ${current.pct}% is below baseline ${floorPercent.toFixed(2)}%`
    );
  }

  console.warn(
    `${metric}: ${current.pct}% (${current.covered}/${current.total})`
  );
}

if (mode === 'business') {
  for (const sourcePath of baseline.critical) {
    const entry = Object.entries(summary).find(([filePath]) =>
      filePath.replaceAll('\\', '/').endsWith(`/${sourcePath}`)
    )?.[1];

    if (!entry) {
      failures.push(`${sourcePath}: missing from full-source coverage report`);
      continue;
    }

    for (const metric of metrics) {
      if (entry[metric].pct < 100) {
        failures.push(
          `${sourcePath} ${metric}: ${entry[metric].pct}% is below critical target 100%`
        );
      }
    }
  }

  const dtoEntries = Object.entries(summary).filter(
    ([filePath]) =>
      filePath.replaceAll('\\', '/').includes('/packages/backend/src/') &&
      filePath.replaceAll('\\', '/').includes('/dto/')
  );

  if (dtoEntries.length === 0) {
    failures.push(
      'backend DTO validation: no DTO source files in coverage report'
    );
  }

  for (const [filePath, entry] of dtoEntries) {
    for (const metric of metrics) {
      if (entry[metric].pct < 100) {
        failures.push(
          `${filePath} ${metric}: ${entry[metric].pct}% is below compact DTO contract target 100%`
        );
      }
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Coverage ${mode} check failed:\n${failures.join('\n')}`);
}
