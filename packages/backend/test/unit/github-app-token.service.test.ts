import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GitHubAppTokenService } from '../../src/feedback/github-app-token.service';

describe('GitHubAppTokenService', () => {
  const temporaryDirectories: string[] = [];
  const originalWorkingDirectory = process.cwd();

  afterEach(() => {
    process.chdir(originalWorkingDirectory);
    vi.unstubAllGlobals();
    delete process.env.GITHUB_FEEDBACK_APP_ID;
    delete process.env.GITHUB_FEEDBACK_APP_INSTALLATION_ID;
    delete process.env.GITHUB_FEEDBACK_APP_PRIVATE_KEY;
    delete process.env.GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH;
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('resolves a local key path from the repository root', async () => {
    const repository = mkdtempSync(path.join(tmpdir(), 'pomi-repository-'));
    temporaryDirectories.push(repository);
    const backendDirectory = path.join(repository, 'packages/backend');
    const privateKeyPath = path.join(repository, 'config/private-key.pem');
    mkdirSync(backendDirectory, { recursive: true });
    mkdirSync(path.dirname(privateKeyPath), { recursive: true });
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(
      privateKeyPath,
      privateKey.export({ type: 'pkcs8', format: 'pem' })
    );
    process.chdir(backendDirectory);
    process.env.GITHUB_FEEDBACK_APP_ID = '4675891';
    process.env.GITHUB_FEEDBACK_APP_INSTALLATION_ID = '155743206';
    process.env.GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH = 'config/private-key.pem';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            token: 'installation-token',
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    await expect(new GitHubAppTokenService().getToken()).resolves.toBe(
      'installation-token'
    );
  });

  it('mints and caches an installation token for feedback issue creation', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.GITHUB_FEEDBACK_APP_ID = '4675891';
    process.env.GITHUB_FEEDBACK_APP_INSTALLATION_ID = '155743206';
    process.env.GITHUB_FEEDBACK_APP_PRIVATE_KEY = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString()
      .replaceAll('\n', '\\n');
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

  it('rejects a malformed private key without exposing the crypto error', async () => {
    process.env.GITHUB_FEEDBACK_APP_ID = '4675891';
    process.env.GITHUB_FEEDBACK_APP_INSTALLATION_ID = '155743206';
    process.env.GITHUB_FEEDBACK_APP_PRIVATE_KEY = 'not-a-private-key';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new GitHubAppTokenService().getToken()).rejects.toEqual(
      new ServiceUnavailableException(
        'Feedback GitHub App private key is invalid'
      )
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('translates installation-token transport failures', async () => {
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
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    await expect(new GitHubAppTokenService().getToken()).rejects.toEqual(
      new BadGatewayException('GitHub feedback authentication is unavailable')
    );
  });

  it('translates malformed installation-token responses', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.GITHUB_FEEDBACK_APP_ID = '4675891';
    process.env.GITHUB_FEEDBACK_APP_INSTALLATION_ID = '155743206';
    process.env.GITHUB_FEEDBACK_APP_PRIVATE_KEY = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not-json', { status: 201 }))
    );

    await expect(new GitHubAppTokenService().getToken()).rejects.toEqual(
      new BadGatewayException(
        'GitHub returned invalid feedback application credentials'
      )
    );
  });
});
