import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubAppTokenService } from '../../src/feedback/github-app-token.service';

describe('GitHubAppTokenService', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_FEEDBACK_APP_ID;
    delete process.env.GITHUB_FEEDBACK_APP_INSTALLATION_ID;
    delete process.env.GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH;
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('mints and caches an installation token for feedback issue creation', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'pomi-github-app-'));
    temporaryDirectories.push(directory);
    const privateKeyPath = path.join(directory, 'private-key.pem');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(
      privateKeyPath,
      privateKey.export({ type: 'pkcs8', format: 'pem' })
    );
    process.env.GITHUB_FEEDBACK_APP_ID = '4675891';
    process.env.GITHUB_FEEDBACK_APP_INSTALLATION_ID = '155743206';
    process.env.GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH = privateKeyPath;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'installation-token',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new GitHubAppTokenService();

    await expect(service.getToken()).resolves.toBe('installation-token');
    await expect(service.getToken()).resolves.toBe('installation-token');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/app/installations/155743206/access_tokens'
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const authorization = (request.headers as Record<string, string>)[
      'Authorization'
    ];
    expect(authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
  });
});
