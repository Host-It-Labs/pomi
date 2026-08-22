import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public release workflow', () => {
  it('keeps release credentials in a protected environment', async () => {
    const workflow = await readFile(
      new URL('../../../../.github/workflows/release.yml', import.meta.url),
      'utf8'
    );

    expect(workflow).toContain('environment: release');
    expect(workflow).toContain('secrets.SENTRY_AUTH_TOKEN');
    expect(workflow).toContain('secrets.ANDROID_KEY_BASE64');
    expect(workflow).toContain('secrets.ANDROID_KEY_PASSWORD');
    expect(workflow).toContain('secrets.GOOGLE_SERVICES_JSON_BASE64');
    expect(workflow).toContain('vars.PROD_BACKEND_URL');
    expect(workflow).toContain('vars.SENTRY_ORG');
    expect(workflow).not.toContain('secrets.PROD_BACKEND_URL');
    expect(workflow).not.toContain('DOCKERHUB_TOKEN');
  });

  it('publishes the backend through GitHub and preserves Sentry correlation', async () => {
    const workflow = await readFile(
      new URL('../../../../.github/workflows/release.yml', import.meta.url),
      'utf8'
    );

    expect(workflow).toContain('ghcr.io/neohuncho/pomi-backend');
    expect(workflow).toContain('packages: write');
    expect(workflow).toContain('secrets.GITHUB_TOKEN');
    expect(workflow).toContain(
      'refs:[{repository:$repository,commit:$commit}]'
    );
    expect(workflow).toContain('dateReleased');
    expect(workflow).toContain('actions/create-github-app-token@v2');
    expect(workflow).toContain('POMI_RADAR_APP_PRIVATE_KEY');
    expect(workflow).toContain('scripts/radar-lifecycle.mjs release');
  });
});
