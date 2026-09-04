#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAutomationEnvironment,
  repositoryRoot,
  resolveRepositoryPath,
} from './local-env.mjs';
import {
  fetchWithRetry,
  NETWORK_RETRY_DELAYS_MS,
  NO_NETWORK_RETRY_DELAYS_MS,
} from './http-client.mjs';
import {
  createPrivateKeyForSigning,
  normalizePrivateKey,
} from './github-app-private-key.mjs';

const API_BASE = 'https://api.github.com';
const PUBLIC_REPOSITORY = 'Host-It-Labs/pomi';
export const EXPECTED_GITHUB_APP_ID = '4675891';
export const EXPECTED_GITHUB_APP_BOT_LOGIN = 'pomi-radar[bot]';
const PRIVATE_KEY_PATH = resolveRepositoryPath(
  'config/secrets/pomi-radar.private-key.pem'
);
export const ALLOWED_COMMANDS = new Set(['gh', 'git', 'node', 'pnpm']);
const REQUIRED_MUTATION_PERMISSIONS = Object.freeze([
  'contents',
  'issues',
  'pull_requests',
]);

function githubUrl(pathname) {
  const [pathPart, query = ''] = pathname.split('?', 2);
  const url = new URL(API_BASE);
  url.pathname = pathPart;
  url.search = query;
  return url;
}

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
  return `${unsigned}.${signer
    .sign(createPrivateKeyForSigning(privateKey))
    .toString('base64url')}`;
}

export async function githubRequest(
  pathname,
  { method = 'GET', token, body, fetchImpl = fetch } = {}
) {
  const normalizedMethod = method.toUpperCase();
  const response = await fetchWithRetry(
    githubUrl(pathname),
    {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'pomi-radar',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    fetchImpl,
    normalizedMethod === 'GET'
      ? NETWORK_RETRY_DELAYS_MS
      : NO_NETWORK_RETRY_DELAYS_MS
  );
  const text = await response.text();
  if (!response.ok) {
    const rateLimited =
      response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.has('retry-after'));
    throw new Error(
      `GitHub ${method} ${pathname} failed (${response.status})${rateLimited ? ': rate limit' : ''}.`
    );
  }
  return text ? JSON.parse(text) : undefined;
}

export function readGitHubAppConfiguration(environment = process.env) {
  const appId = environment.POMI_RADAR_GITHUB_APP_ID?.trim();
  const installationId =
    environment.POMI_RADAR_GITHUB_APP_INSTALLATION_ID?.trim();
  const configuredPrivateKey =
    environment.POMI_RADAR_GITHUB_APP_PRIVATE_KEY?.trim();
  const configuredPrivateKeyPath =
    environment.POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH?.trim();
  if (
    !appId ||
    !installationId ||
    (!configuredPrivateKey && !configuredPrivateKeyPath)
  ) {
    throw new Error(
      'GitHub App configuration is incomplete in config/pomi-automation.env (App ID, installation ID, and private-key value or path are required).'
    );
  }
  if (!/^\d+$/.test(appId) || !/^\d+$/.test(installationId)) {
    throw new Error('GitHub App and installation IDs must be numeric.');
  }
  if (appId !== EXPECTED_GITHUB_APP_ID) {
    throw new Error('GitHub App configuration does not identify Pomi Radar.');
  }
  if (
    !configuredPrivateKey &&
    configuredPrivateKeyPath !== 'config/secrets/pomi-radar.private-key.pem'
  ) {
    throw new Error(
      'The GitHub App private key must use config/secrets/pomi-radar.private-key.pem.'
    );
  }
  return {
    appId,
    installationId,
    ...(configuredPrivateKey ? {} : { privateKeyPath: PRIVATE_KEY_PATH }),
    privateKey: configuredPrivateKey
      ? normalizePrivateKey(configuredPrivateKey)
      : readFileSync(PRIVATE_KEY_PATH, 'utf8'),
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
  const botLogin = `${app.slug}[bot]`;
  if (
    String(app.id) !== EXPECTED_GITHUB_APP_ID ||
    botLogin !== EXPECTED_GITHUB_APP_BOT_LOGIN
  ) {
    throw new Error('GitHub App authentication did not resolve to Pomi Radar.');
  }
  const botUser = await githubRequest(
    `/users/${encodeURIComponent(botLogin)}`,
    {
      token: installationToken.token,
      fetchImpl,
    }
  );
  if (botUser.login !== botLogin || !Number.isSafeInteger(botUser.id)) {
    throw new Error(
      'GitHub App token did not resolve to the expected bot user.'
    );
  }
  return {
    token: installationToken.token,
    expiresAt: installationToken.expires_at,
    permissions: installationToken.permissions,
    app,
    botLogin,
    botUserId: botUser.id,
  };
}

export function appAuthenticatedEnvironment(authentication, environment) {
  const botEmail = `${authentication.botUserId}+${authentication.botLogin}@users.noreply.github.com`;
  const childEnvironment = {
    ...environment,
    GH_TOKEN: authentication.token,
    GITHUB_TOKEN: authentication.token,
    POMI_GITHUB_APP_TOKEN: authentication.token,
    POMI_GITHUB_APP_ID: String(authentication.app.id),
    POMI_GITHUB_APP_BOT_LOGIN: authentication.botLogin,
    POMI_GITHUB_APP_PERMISSIONS: JSON.stringify(
      authentication.permissions ?? {}
    ),
    GIT_ASKPASS: path.join(repositoryRoot, 'scripts/github-app-askpass.sh'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: 'false',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_1: '',
    GIT_AUTHOR_NAME: `${authentication.app.name} Bot`,
    GIT_AUTHOR_EMAIL: botEmail,
    GIT_COMMITTER_NAME: `${authentication.app.name} Bot`,
    GIT_COMMITTER_EMAIL: botEmail,
  };
  delete childEnvironment.POMI_RADAR_GITHUB_APP_PRIVATE_KEY;
  delete childEnvironment.POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH;
  delete childEnvironment.GITHUB_FEEDBACK_APP_PRIVATE_KEY;
  delete childEnvironment.GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH;
  return childEnvironment;
}

export function validateMutationPermissions(permissions) {
  const missing = REQUIRED_MUTATION_PERMISSIONS.filter(
    permission => permissions?.[permission] !== 'write'
  );
  if (missing.length) {
    throw new Error(
      'The Pomi Radar GitHub App installation lacks required contents, issues, or pull-request write permission.'
    );
  }
}

async function runCli() {
  loadAutomationEnvironment();
  const mode = process.argv[2];
  const authentication = await getGitHubAppAuthentication();
  if (mode === 'check') {
    const repository = process.env.POMI_RADAR_GITHUB_REPOSITORY;
    if (repository && repository !== PUBLIC_REPOSITORY) {
      throw new Error(
        `GitHub App writes are restricted to ${PUBLIC_REPOSITORY}.`
      );
    }
    const repo = await githubRequest(`/repos/${PUBLIC_REPOSITORY}`, {
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
  validateMutationPermissions(authentication.permissions);
  const command = process.argv[4];
  const args = process.argv.slice(5);
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(
      `GitHub App command must be one of: ${[...ALLOWED_COMMANDS].join(', ')}.`
    );
  }
  // This local CLI intentionally forwards explicit arguments to a small executable allowlist.
  const child = spawn(command, args, {
    stdio: 'inherit',
    cwd: repositoryRoot,
    env: appAuthenticatedEnvironment(authentication, process.env),
  });
  child.on('error', () => {
    console.error('[pomi] GitHub App child command could not start.');
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
