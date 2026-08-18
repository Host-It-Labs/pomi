import { spawn } from 'node:child_process';
import {
  DEFAULT_PORTS,
  getBackendBaseUrl,
  resolveDockerPorts,
  writeDevPorts,
} from './dev-ports.mjs';

const composeArgsByMode = {
  up: ['up', '--force-recreate'],
  rebuild: ['up', '-d', '--build'],
  detached: ['up', '-d', '--build'],
  logs: ['logs', '-f', '--tail=200'],
  stop: ['stop'],
  down: ['down'],
};
const mode = process.argv[2] ?? 'up';
const extraComposeArgs = process.argv.slice(3);
const composeProject = process.env.POMI_COMPOSE_PROJECT || 'pomi';
const composeFile =
  process.env.POMI_DOCKER_COMPOSE_FILE ||
  'packages/backend/docker-compose.dev.yml';

if (!composeArgsByMode[mode]) {
  console.error(`[pomi] unsupported docker dev mode: ${mode}`);
  process.exit(1);
}

const runCompose = (args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['compose', '-f', composeFile, '-p', composeProject, ...args],
      {
        stdio: 'inherit',
        env,
      }
    );

    child.on('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
        resolve();
        return;
      }

      if (signal) {
        reject(
          new Error(
            `docker compose ${args.join(' ')} failed with signal ${signal}`
          )
        );
        return;
      }

      reject(
        new Error(
          `docker compose ${args.join(' ')} failed with exit code ${code}`
        )
      );
    });

    child.on('error', reject);
  });

const run = async () => {
  if (mode === 'logs' || mode === 'stop' || mode === 'down') {
    await runCompose([...composeArgsByMode[mode], ...extraComposeArgs], {
      ...process.env,
    });
    return;
  }

  const { backendPort, dbPort, redisPort } = await resolveDockerPorts(
    process.env
  );
  const backendBaseUrl = getBackendBaseUrl(backendPort);

  if (
    backendPort !== DEFAULT_PORTS.backend ||
    dbPort !== DEFAULT_PORTS.db ||
    redisPort !== DEFAULT_PORTS.redis
  ) {
    process.stdout.write(
      `[pomi] docker dev will use backend ${backendBaseUrl}, postgres ${dbPort}, redis ${redisPort}` +
        '\n'
    );
  }

  writeDevPorts({
    POMI_BACKEND_PORT: String(backendPort),
    POMI_BACKEND_BASE_URL: backendBaseUrl,
    POMI_DB_PORT: String(dbPort),
    POMI_REDIS_PORT: String(redisPort),
  });

  const env = {
    ...process.env,
    POMI_BACKEND_PORT: String(backendPort),
    POMI_BACKEND_BASE_URL: backendBaseUrl,
    POMI_DB_PORT: String(dbPort),
    POMI_REDIS_PORT: String(redisPort),
  };

  if (mode === 'rebuild') {
    await runCompose(['down', '-v'], env);
  }

  await runCompose([...composeArgsByMode[mode], ...extraComposeArgs], env);
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
