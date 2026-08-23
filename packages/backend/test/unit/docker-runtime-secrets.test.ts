import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');

function repositoryFile(relativePath: string) {
  return readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

describe('backend Docker secret boundary', () => {
  it('keeps environment and private-key files outside the image build context', () => {
    const dockerIgnore = repositoryFile('.dockerignore');

    expect(dockerIgnore).toMatch(/^\*\*\/\.env$/m);
    expect(dockerIgnore).toMatch(/^\*\*\/\.env\.\*$/m);
    expect(dockerIgnore).toMatch(/^!\*\*\/\.env\.example$/m);
    expect(dockerIgnore).toMatch(/^\*\*\/\*\.key$/m);
    expect(dockerIgnore).toMatch(/^\*\*\/\*\.pem$/m);
  });

  it('keeps optional integrations disabled without runtime configuration', () => {
    const dockerfile = repositoryFile('packages/backend/Dockerfile');
    const compose = repositoryFile('packages/backend/docker-compose.yml');

    expect(dockerfile).not.toMatch(/\b(?:ARG|ENV)\s+OPENROUTER_API_KEY\b/);
    expect(compose).toContain('OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}');
    expect(compose).toContain(
      'OPENROUTER_HTTP_REFERER: ${OPENROUTER_HTTP_REFERER:-}'
    );
    expect(compose).toContain(
      'GITHUB_FEEDBACK_REPOSITORY: ${GITHUB_FEEDBACK_REPOSITORY:-}'
    );
  });

  it('requires production secrets and does not publish data services', () => {
    const compose = repositoryFile('packages/backend/docker-compose.yml');

    expect(compose).toContain('JWT_SECRET: ${JWT_SECRET:?Set JWT_SECRET}');
    expect(compose).toContain(
      'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}'
    );
    expect(compose).toContain(
      'REDIS_PASSWORD: ${REDIS_PASSWORD:?Set REDIS_PASSWORD}'
    );
    expect(compose).toContain('POSTGRES_USER: ${POSTGRES_USER:-pomi}');
    expect(compose).toContain('POSTGRES_DB: ${POSTGRES_DB:-pomi}');
    expect(compose).toContain('tauri://localhost');
    expect(compose).not.toContain('DATABASE_URL: postgres://${');
    expect(compose).not.toContain('REDIS_URL: redis://:${');
    expect(compose).toContain('pgdata17:/var/lib/postgresql/data');
    expect(compose).toContain('--requirepass');

    const redisService = compose.slice(compose.indexOf('\n  redis:'));
    expect(redisService).not.toMatch(/\n\s+ports:/);
  });

  it('keeps production Redis private with an authenticated administration path', () => {
    const compose = repositoryFile('packages/backend/docker-compose.yml');
    const securityGuide = repositoryFile('docs/self-hosting-security.md');
    const redisService = compose
      .split('\n  redis:\n')[1]
      .split('\nvolumes:\n')[0];

    expect(redisService).not.toContain('ports:');
    expect(securityGuide).toContain(
      'docker compose -f packages/backend/docker-compose.yml exec redis redis-cli'
    );
  });

  it('sets explicit production authentication capacity defaults', () => {
    const compose = repositoryFile('packages/backend/docker-compose.yml');

    expect(compose).toContain(
      'AUTH_ATTEMPT_IDENTITY_LIMIT: ${AUTH_ATTEMPT_IDENTITY_LIMIT:-10}'
    );
    expect(compose).toContain(
      'AUTH_REGISTRATION_GLOBAL_LIMIT: ${AUTH_REGISTRATION_GLOBAL_LIMIT:-200}'
    );
  });
});
