import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowPaths = [
  '../../../../.github/workflows/codeql.yml',
  '../../../../.github/workflows/pr-tests.yml',
  '../../../../.github/workflows/pr-e2e.yml',
];

describe('continuous integration workflows', () => {
  it('runs automatic CI from branch pushes without duplicating pull-request workflows', async () => {
    const workflows = await Promise.all(
      workflowPaths.map(path =>
        readFile(new URL(path, import.meta.url), 'utf8')
      )
    );

    for (const workflow of workflows) {
      expect(workflow).toContain('\n  push:');
      expect(workflow).not.toContain('\n  pull_request:');
      expect(workflow).toMatch(
        /\n\s{2}group: [^\n]*-\$\{\{ github\.event_name \}\}-\$\{\{ github\.repository \}\}-\$\{\{ github\.ref_name \}\}/
      );
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
