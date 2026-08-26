import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowPaths = [
  '../../../../.github/workflows/codeql.yml',
  '../../../../.github/workflows/pr-tests.yml',
  '../../../../.github/workflows/pr-e2e.yml',
];

describe('continuous integration workflows', () => {
  it('runs automatically for pushes and pull requests', async () => {
    const workflows = await Promise.all(
      workflowPaths.map(path =>
        readFile(new URL(path, import.meta.url), 'utf8')
      )
    );

    for (const workflow of workflows) {
      expect(workflow).toContain('\n  push:');
      expect(workflow).toContain('\n  pull_request:');
      expect(workflow).toContain('github.head_ref || github.ref_name');
    }
  });
});
