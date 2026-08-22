import { spawn } from 'node:child_process';
import {
  DEFAULT_PORTS,
  getAndroidBackendUrl,
  getBackendBaseUrl,
  getFrontendBaseUrl,
  getViteBackendUrl,
  parsePortNumber,
  readDevPorts,
  resolveFrontendPorts,
  writeDevPorts,
} from './dev-ports.mjs';
import { loadLocalEnvironment } from './local-env.mjs';

loadLocalEnvironment();

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const viteArgs = process.argv.slice(2);

const run = async () => {
  const { frontendPort, frontendHmrPort } = await resolveFrontendPorts(
    process.env
  );
  const storedDevPorts = readDevPorts();
  const backendPort = parsePortNumber(
    process.env.POMI_BACKEND_PORT || storedDevPorts.POMI_BACKEND_PORT,
    DEFAULT_PORTS.backend
  );
  const frontendBaseUrl = getFrontendBaseUrl(frontendPort);
  const backendBaseUrl = getBackendBaseUrl(backendPort);
  const androidBackendUrl =
    process.env.VITE_ANDROID_BACKEND_URL || getAndroidBackendUrl(backendPort);

  if (
    frontendPort !== DEFAULT_PORTS.frontend ||
    frontendHmrPort !== DEFAULT_PORTS.frontendHmr ||
    backendPort !== DEFAULT_PORTS.backend
  ) {
    process.stdout.write(
      `[pomi] frontend dev will use ${frontendBaseUrl}, backend ${backendBaseUrl} (hmr: ${frontendHmrPort})` +
        '\n'
    );
  }

  writeDevPorts({
    POMI_ANDROID_BACKEND_URL: process.env.VITE_ANDROID_BACKEND_URL
      ? androidBackendUrl
      : undefined,
    POMI_FRONTEND_PORT: String(frontendPort),
    POMI_FRONTEND_HMR_PORT: String(frontendHmrPort),
    POMI_FRONTEND_BASE_URL: frontendBaseUrl,
    POMI_BACKEND_PORT: String(backendPort),
    POMI_BACKEND_BASE_URL: backendBaseUrl,
  });

  const child = spawn(pnpmCommand, ['exec', 'vite', ...viteArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      POMI_FRONTEND_PORT: String(frontendPort),
      POMI_FRONTEND_HMR_PORT: String(frontendHmrPort),
      POMI_FRONTEND_BASE_URL: frontendBaseUrl,
      VITE_ANDROID_BACKEND_URL: process.env.VITE_ANDROID_BACKEND_URL,
      VITE_BACKEND_URL: getViteBackendUrl(backendPort),
    },
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on('error', error => {
    console.error(error);
    process.exit(1);
  });
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
