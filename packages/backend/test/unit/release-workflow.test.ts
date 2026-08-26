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
    expect(workflow).toContain('secrets.VITE_SENTRY_DSN');
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

    expect(workflow).toContain('ghcr.io/host-it-labs/pomi-backend');
    expect(workflow).toContain('packages: write');
    expect(workflow).toContain('secrets.GITHUB_TOKEN');
    expect(workflow).toContain(
      'refs:[{repository:$repository,commit:$commit}]'
    );
    expect(workflow).toContain('dateReleased');
    expect(workflow).toContain('actions/create-github-app-token@v3');
    expect(workflow).toContain('POMI_RADAR_APP_PRIVATE_KEY');
    expect(workflow).toContain('scripts/radar-lifecycle.mjs release');
    expect(workflow).toMatch(
      /release-radar-issues:[\s\S]*?permissions:\n\s+contents: read\n\s+issues: write/
    );
    expect(workflow).toContain('radar_only:');
    expect(workflow).toContain('release-radar-issues-recovery:');
    expect(workflow).toContain('export RELEASE_SHA=');
  });

  it('builds each backend architecture natively before publishing one manifest', async () => {
    const workflow = await readFile(
      new URL('../../../../.github/workflows/release.yml', import.meta.url),
      'utf8'
    );

    expect(workflow).toMatch(
      /docker-backend-amd64:\n[\s\S]*?needs: \[sentry-release, build-macos, build-android-wear\]/
    );
    expect(workflow).toMatch(
      /docker-backend-amd64:[\s\S]*?platforms: linux\/amd64/
    );
    expect(workflow).toMatch(
      /docker-backend-arm64:\n[\s\S]*?runs-on: ubuntu-24\.04-arm/
    );
    expect(workflow).toMatch(
      /docker-backend-arm64:[\s\S]*?platforms: linux\/arm64/
    );
    expect(workflow).toContain('docker buildx imagetools create');
    expect(workflow).toContain('--tag "$IMAGE:${RELEASE_TAG}"');
    expect(workflow).toContain('--tag "$IMAGE:latest"');
    expect(workflow).not.toContain('platforms: linux/amd64,linux/arm64');
    expect(workflow).toMatch(
      /finalize-sentry-release:[\s\S]*?needs: \[docker-backend-manifest, build-macos, build-android-wear\]/
    );
  });

  it('keeps local cross-platform builds isolated and non-publishing', async () => {
    const [amd64Script, arm64Script, dockerScript] = await Promise.all([
      readFile(
        new URL('../../../../scripts/build-linux-deb.sh', import.meta.url),
        'utf8'
      ),
      readFile(
        new URL(
          '../../../../scripts/build-linux-arm64-deb.sh',
          import.meta.url
        ),
        'utf8'
      ),
      readFile(
        new URL('../../../../scripts/build-backend-image.sh', import.meta.url),
        'utf8'
      ),
    ]);

    for (const script of [amd64Script, arm64Script]) {
      expect(script).toContain('node:26-bookworm');
      expect(script).toContain(
        '--mount type=volume,destination=/workspace/node_modules'
      );
      for (const variable of [
        'VITE_BACKEND_URL',
        'VITE_USE_HTTPS',
        'VITE_RENDER_SYSTEM_TRAY_ICON',
        'VITE_DEBUG_PANEL_ENABLED',
        'VITE_PROD',
        'VITE_ANDROID_BACKEND_URL',
        'VITE_SENTRY_DSN',
        'VITE_SENTRY_RELEASE',
      ]) {
        expect(script).toContain(variable);
      }
      expect(script).not.toContain('pomi_0.1.0');
    }
    expect(amd64Script).toContain('target/linux-amd64');
    expect(arm64Script).toContain('target/linux-arm64');
    expect(dockerScript).toContain('--output type=cacheonly');
    expect(dockerScript).toContain('--builder "$POMI_DOCKER_BUILDER"');
    expect(dockerScript).not.toContain('--push');
  });

  it('uses the release profile and unsigned mode for local macOS builds', async () => {
    const packageJson = await readFile(
      new URL('../../../../package.json', import.meta.url),
      'utf8'
    );

    expect(packageJson).toContain('build:macos');
    expect(packageJson).toContain('--profile release');
    expect(packageJson).toContain('--no-sign');
  });
});
