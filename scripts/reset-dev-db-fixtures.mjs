import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDevPorts } from './dev-ports.mjs';
import { loadLocalEnvironment } from './local-env.mjs';

loadLocalEnvironment();

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const composeFile =
  process.env.POMI_DOCKER_COMPOSE_FILE ||
  path.join(rootDir, 'packages/backend/docker-compose.dev.yml');
const composeProject = process.env.POMI_COMPOSE_PROJECT || 'pomi';
const pgdataDir =
  process.env.POMI_DEV_DB_DATA_DIR ||
  path.join(rootDir, 'packages/backend/pgdata');
const args = process.argv.slice(2);
const unsupportedArgs = args.filter(argument => argument !== '--copyme-only');

if (unsupportedArgs.length > 0) {
  console.error(
    `[pomi] unsupported database reset option: ${unsupportedArgs[0]}`
  );
  process.exit(1);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      env: options.env ?? process.env,
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} exited via ${signal}`));
        return;
      }

      reject(
        new Error(`${command} ${args.join(' ')} failed with exit code ${code}`)
      );
    });

    child.on('error', reject);
  });
}

function buildBackendEnv() {
  const devPorts = readDevPorts();
  const dbPort = process.env.POMI_DB_PORT || devPorts.POMI_DB_PORT || '5432';
  const redisPort =
    process.env.POMI_REDIS_PORT || devPorts.POMI_REDIS_PORT || '6379';
  const backendPort =
    process.env.POMI_BACKEND_PORT || devPorts.POMI_BACKEND_PORT || '3000';

  return {
    ...process.env,
    POMI_COMPOSE_PROJECT: composeProject,
    POMI_DOCKER_COMPOSE_FILE: composeFile,
    POMI_BACKEND_PORT: backendPort,
    POMI_BACKEND_BASE_URL: `http://localhost:${backendPort}`,
    POMI_DB_PORT: dbPort,
    POMI_REDIS_PORT: redisPort,
    DATABASE_URL: `postgres://user:password@localhost:${dbPort}/pomodoro`,
    REDIS_URL: `redis://localhost:${redisPort}`,
  };
}

async function main() {
  const composeArgs = ['compose', '-f', composeFile, '-p', composeProject];
  const composeEnv = {
    ...process.env,
    POMI_COMPOSE_PROJECT: composeProject,
    POMI_DOCKER_COMPOSE_FILE: composeFile,
  };

  process.stdout.write(`[pomi] stopping compose project ${composeProject}\n`);
  await run('docker', [...composeArgs, 'down', '--remove-orphans'], {
    env: composeEnv,
  });

  process.stdout.write(`[pomi] removing dev database data at ${pgdataDir}\n`);
  await rm(pgdataDir, { recursive: true, force: true });

  process.stdout.write('[pomi] starting dev stack\n');
  await run('pnpm', ['run', 'docker:dev:detached'], { env: composeEnv });

  const backendEnv = buildBackendEnv();

  process.stdout.write('[pomi] running migrations\n');
  await run('pnpm', ['run', 'dev:migrate'], { env: backendEnv });

  process.stdout.write('[pomi] seeding copyme fixture\n');
  await run('pnpm', ['run', 'seed:copyme'], { env: backendEnv });

  process.stdout.write('[pomi] restarting backend\n');
  await run('docker', [...composeArgs, 'restart', 'backend'], {
    env: backendEnv,
  });

  process.stdout.write('[pomi] dev database reset and Copyme seeded\n');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
