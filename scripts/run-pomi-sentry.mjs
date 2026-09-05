#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  environmentFiles,
  readEnvironmentFile,
  resolveRepositoryPath,
} from './local-env.mjs';

const SENTRY_KEYS = Object.freeze([
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_FRONTEND_PROJECT',
  'SENTRY_BACKEND_PROJECT',
  'SENTRY_ENVIRONMENT',
]);
const PRIVATE_KEY_KEYS = Object.freeze([
  'POMI_RADAR_GITHUB_APP_PRIVATE_KEY',
  'POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH',
  'GITHUB_FEEDBACK_APP_PRIVATE_KEY',
  'GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH',
]);

export function sentryChildEnvironment({
  environment = process.env,
  filePath = environment.POMI_SENTRY_ENV_FILE,
} = {}) {
  const resolvedFile = filePath
    ? resolveRepositoryPath(filePath)
    : environmentFiles.automation;
  const values = readEnvironmentFile(resolvedFile);
  const childEnvironment = { ...environment };
  for (const key of SENTRY_KEYS) {
    if (values[key] !== undefined) childEnvironment[key] = values[key];
  }
  childEnvironment.SENTRY_ENVIRONMENT ||= 'production';
  for (const key of PRIVATE_KEY_KEYS) delete childEnvironment[key];
  return {
    environment: childEnvironment,
    loadedFromFile: Object.keys(values).length > 0,
  };
}

function missingSentryKeys(environment) {
  return SENTRY_KEYS.slice(0, 4).filter(key => !environment[key]);
}

function main() {
  const { environment, loadedFromFile } = sentryChildEnvironment();
  const missing = missingSentryKeys(environment);
  if (missing.length) {
    throw new Error(
      `Sentry configuration incomplete; missing: ${missing.join(' ')}`
    );
  }
  if (process.argv[2] === '--check') {
    process.stdout.write('Sentry configuration: valid\n');
    process.stdout.write('SENTRY_AUTH_TOKEN=present\n');
    process.stdout.write('SENTRY_ORG=present\n');
    process.stdout.write('SENTRY_FRONTEND_PROJECT=present\n');
    process.stdout.write('SENTRY_BACKEND_PROJECT=present\n');
    process.stdout.write(
      `SENTRY_ENVIRONMENT=${environment.SENTRY_ENVIRONMENT}\n`
    );
    process.stdout.write(
      `config_source=${loadedFromFile ? 'env-file-with-process-fallback' : 'process-environment'}\n`
    );
    return;
  }
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    throw new Error(
      'Usage: scripts/run-pomi-sentry.sh --check | <command> [args...]'
    );
  }
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: environment,
  });
  child.on('error', () => {
    process.stderr.write('Pomi Sentry child command could not start.\n');
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Pomi Sentry setup failed.'}\n`
    );
    process.exitCode = 2;
  }
}
