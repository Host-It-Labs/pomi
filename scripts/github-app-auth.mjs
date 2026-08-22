#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadLocalEnvironment,
  repositoryRoot,
  resolveRepositoryPath,
} from './local-env.mjs';

const API_BASE = 'https://api.github.com';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createAppJwt({ appId, privateKey, now = Date.now() }) {
  const timestamp = Math.floor(now / 1000);
  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const payload = encode({
    iat: timestamp - 60,
    exp: timestamp + 540,
    iss: String(appId),
  });
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
}

export async function githubRequest(
  pathname,
  { method = 'GET', token, body, fetchImpl = fetch } = {}
) {
  const response = await fetchImpl(`${API_BASE}${pathname}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'pomi-radar',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(
      `GitHub ${method} ${pathname} failed (${response.status}): ${data?.message || text}`
    );
  }
  return data;
}

export function readGitHubAppConfiguration(environment = process.env) {
  const appId = environment.POMI_RADAR_GITHUB_APP_ID?.trim();
  const installationId =
    environment.POMI_RADAR_GITHUB_APP_INSTALLATION_ID?.trim();
  const privateKeyPath = resolveRepositoryPath(
    environment.POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH
  );
  if (!appId || !installationId || !privateKeyPath) {
    throw new Error(
      'GitHub App configuration is incomplete in .env.local (App ID, installation ID, and private-key path are required).'
    );
  }
  return {
    appId,
    installationId,
    privateKeyPath,
    privateKey: readFileSync(privateKeyPath, 'utf8'),
  };
}

export async function getGitHubAppAuthentication({
  environment = process.env,
  fetchImpl = fetch,
} = {}) {
  const config = readGitHubAppConfiguration(environment);
  const jwt = createAppJwt(config);
  const [app, installationToken] = await Promise.all([
    githubRequest('/app', { token: jwt, fetchImpl }),
    githubRequest(`/app/installations/${config.installationId}/access_tokens`, {
      method: 'POST',
      token: jwt,
      fetchImpl,
    }),
  ]);
  return {
    token: installationToken.token,
    expiresAt: installationToken.expires_at,
    app,
    botLogin: `${app.slug}[bot]`,
  };
}

async function runCli() {
  loadLocalEnvironment();
  const mode = process.argv[2];
  const authentication = await getGitHubAppAuthentication();
  if (mode === 'check') {
    const repository =
      process.env.POMI_RADAR_GITHUB_REPOSITORY || 'NeoHuncho/pomi';
    const repo = await githubRequest(`/repos/${repository}`, {
      token: authentication.token,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          app: authentication.app.slug,
          botLogin: authentication.botLogin,
          repository: repo.full_name,
          expiresAt: authentication.expiresAt,
        },
        null,
        2
      )}\n`
    );
    return;
  }
  if (mode !== 'exec' || process.argv[3] !== '--' || !process.argv[4]) {
    throw new Error(
      'Usage: node scripts/github-app-auth.mjs check | exec -- <command> [args...]'
    );
  }
  const command = process.argv[4];
  const args = process.argv.slice(5);
  const botEmail = `${authentication.app.id}+${authentication.app.slug}[bot]@users.noreply.github.com`;
  const child = spawn(command, args, {
    stdio: 'inherit',
    cwd: repositoryRoot,
    env: {
      ...process.env,
      GH_TOKEN: authentication.token,
      GITHUB_TOKEN: authentication.token,
      POMI_GITHUB_APP_TOKEN: authentication.token,
      POMI_GITHUB_APP_BOT_LOGIN: authentication.botLogin,
      GIT_ASKPASS: path.join(repositoryRoot, 'scripts/github-app-askpass.sh'),
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: `${authentication.app.name} Bot`,
      GIT_AUTHOR_EMAIL: botEmail,
      GIT_COMMITTER_NAME: `${authentication.app.name} Bot`,
      GIT_COMMITTER_EMAIL: botEmail,
    },
  });
  child.on('error', error => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
