import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');

function repositoryFile(relativePath: string) {
  return readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

describe('backend production startup', () => {
  it('runs installed startup tools directly without a package manager', () => {
    const entrypoint = repositoryFile('packages/backend/docker-entrypoint.sh');

    expect(entrypoint).not.toMatch(/\b(?:corepack|npm|pnpm)\b/);
    expect(entrypoint).toContain(
      'node node_modules/.bin/wait-on tcp:${DB_HOST:-db}:${DB_PORT:-5432} -t 60000'
    );
    expect(entrypoint).toContain(
      'node node_modules/typeorm/cli-ts-node-commonjs.js migration:run -d data-source.ts'
    );
    expect(entrypoint).toContain('node dist/src/main.js');
  });
});
