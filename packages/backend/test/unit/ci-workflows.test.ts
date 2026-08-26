import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowPaths = [
  '../../../../.github/workflows/codeql.yml',
  '../../../../.github/workflows/pr-tests.yml',
  '../../../../.github/workflows/pr-e2e.yml',
];

describe('continuous integration workflows', () => {
  it('runs automatically for pushes and pull requests without cross-event cancellation', async () => {
    const workflows = await Promise.all(
      workflowPaths.map(path =>
        readFile(new URL(path, import.meta.url), 'utf8')
      )
    );

    for (const workflow of workflows) {
      expect(workflow).toContain('\n  push:');
      expect(workflow).toContain('\n  pull_request:');
      expect(workflow).toMatch(
        /\n\s{2}group: [^\n]*-\$\{\{ github\.event_name \}\}-/
      );
      expect(workflow).toContain('github.head_ref || github.ref_name');
    }
  });

  it('does not turn a workflow cancellation into an aggregate test failure', async () => {
    const workflow = await readFile(
      new URL(workflowPaths[1], import.meta.url),
      'utf8'
    );

    expect(workflow).toContain('if: ${{ always() && !cancelled() }}');
  });
});
