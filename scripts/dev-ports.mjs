import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORTS = Object.freeze({
  backend: 3000,
  db: 5432,
  redis: 6379,
  frontend: 1420,
  frontendHmr: 1421,
});

const defaultDevPortsDirectory = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
  'pomi'
);

export const DEV_PORTS_FILE =
  process.env.POMI_DEV_PORTS_FILE ||
  path.join(defaultDevPortsDirectory, 'dev-ports.env');

const devPortsDirectory = path.dirname(DEV_PORTS_FILE);

export const parsePortNumber = (value, fallback) => {
  const parsedValue = Number.parseInt(String(value ?? ''), 10);

  if (
    Number.isInteger(parsedValue) &&
    parsedValue > 0 &&
    parsedValue <= 65535
  ) {
    return parsedValue;
  }

  return fallback;
};

export const readDevPorts = () => {
  if (!fs.existsSync(DEV_PORTS_FILE)) {
    return {};
  }

  const content = fs.readFileSync(DEV_PORTS_FILE, 'utf8');

  return content.split(/\r?\n/).reduce((ports, line) => {
    if (!line || line.trim().startsWith('#')) {
      return ports;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex === -1) {
      return ports;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key || !value) {
      return ports;
    }

    return {
      ...ports,
      [key]: value,
    };
  }, {});
};

export const writeDevPorts = nextPorts => {
  fs.mkdirSync(devPortsDirectory, { recursive: true, mode: 0o700 });

  const mergedPorts = {
    ...readDevPorts(),
    ...Object.fromEntries(
      Object.entries(nextPorts).filter(([, value]) => value !== undefined)
    ),
  };

  const content = Object.entries(mergedPorts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  fs.writeFileSync(DEV_PORTS_FILE, `${content}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.chmodSync(DEV_PORTS_FILE, 0o600);

  return mergedPorts;
};

export const getBackendBaseUrl = backendPort =>
  `http://localhost:${backendPort}`;

export const getAndroidBackendUrl = backendPort =>
  `10.0.2.2:${backendPort}`;

export const getFrontendBaseUrl = frontendPort =>
  `http://localhost:${frontendPort}`;

export const getViteBackendUrl = backendPort => `localhost:${backendPort}`;

const isPortInUseByLsof = port => {
  try {
    execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      error.status === 1
    ) {
      return false;
    }

    return false;
  }
};

const isPortAvailableOnHost = (port, host) =>
  new Promise(resolve => {
    const server = net.createServer();

    server.unref();

    server.once('error', error => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT')
      ) {
        resolve(true);
        return;
      }

      resolve(false);
    });

    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });

export const isPortAvailable = async port => {
  if (isPortInUseByLsof(port)) {
    return false;
  }

  const wildcardIpv6Available = await isPortAvailableOnHost(port, '::');

  if (!wildcardIpv6Available) {
    return false;
  }

  const wildcardIpv4Available = await isPortAvailableOnHost(port, '0.0.0.0');

  if (!wildcardIpv4Available) {
    return false;
  }

  const ipv6Available = await isPortAvailableOnHost(port, '::1');

  if (!ipv6Available) {
    return false;
  }

  return isPortAvailableOnHost(port, '127.0.0.1');
};

export const findAvailablePort = async (startPort, reservedPorts) => {
  const usedPorts = reservedPorts ?? new Set();
  let port = startPort;

  while (usedPorts.has(port) || !(await isPortAvailable(port))) {
    port += 1;

    if (port > 65535) {
      throw new Error(`No available port found starting from ${startPort}`);
    }
  }

  usedPorts.add(port);

  return port;
};

export const resolveBackendPort = async env => {
  const resolvedEnv = env ?? process.env;
  const startingPort = parsePortNumber(
    resolvedEnv.POMI_BACKEND_PORT,
    DEFAULT_PORTS.backend
  );

  return findAvailablePort(startingPort);
};

export const resolveDockerPorts = async env => {
  const resolvedEnv = env ?? process.env;
  const reservedPorts = new Set();

  const backendPort = await findAvailablePort(
    parsePortNumber(resolvedEnv.POMI_BACKEND_PORT, DEFAULT_PORTS.backend),
    reservedPorts
  );
  const dbPort = await findAvailablePort(
    parsePortNumber(resolvedEnv.POMI_DB_PORT, DEFAULT_PORTS.db),
    reservedPorts
  );
  const redisPort = await findAvailablePort(
    parsePortNumber(resolvedEnv.POMI_REDIS_PORT, DEFAULT_PORTS.redis),
    reservedPorts
  );

  return {
    backendPort,
    dbPort,
    redisPort,
  };
};

export const resolveFrontendPorts = async env => {
  const resolvedEnv = env ?? process.env;
  const reservedPorts = new Set();

  const frontendPort = await findAvailablePort(
    parsePortNumber(resolvedEnv.POMI_FRONTEND_PORT, DEFAULT_PORTS.frontend),
    reservedPorts
  );
  const frontendHmrPort = await findAvailablePort(
    parsePortNumber(
      resolvedEnv.POMI_FRONTEND_HMR_PORT,
      DEFAULT_PORTS.frontendHmr
    ),
    reservedPorts
  );

  return {
    frontendPort,
    frontendHmrPort,
  };
};
