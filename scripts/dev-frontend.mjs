import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const tauriCommands = {
  desktop: ['tauri', 'dev'],
  ios: ['tauri', 'ios', 'dev'],
  android: ['tauri', 'android', 'dev'],
};
const args = process.argv.slice(2);
const useExistingVite = args.includes('--use-existing-vite');
const disableWatch = args.includes('--no-watch');
const platform = args.find(arg => !arg.startsWith('--')) ?? 'desktop';
const tauriCommand = tauriCommands[platform];

if (!tauriCommand) {
  console.error(`[pomi] unsupported frontend target: ${platform}`);
  process.exit(1);
}

const run = async () => {
  const storedDevPorts = readDevPorts();
  const frontendPorts = useExistingVite
    ? {
        frontendPort: parsePortNumber(
          process.env.POMI_FRONTEND_PORT || storedDevPorts.POMI_FRONTEND_PORT,
          DEFAULT_PORTS.frontend
        ),
        frontendHmrPort: parsePortNumber(
          process.env.POMI_FRONTEND_HMR_PORT ||
            storedDevPorts.POMI_FRONTEND_HMR_PORT,
          DEFAULT_PORTS.frontendHmr
        ),
      }
    : await resolveFrontendPorts(process.env);
  const { frontendPort, frontendHmrPort } = frontendPorts;
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
    const androidBackendSuffix =
      platform === 'android' ? `, android backend ${androidBackendUrl}` : '';
    process.stdout.write(
      `[pomi] frontend dev will use ${frontendBaseUrl}, backend ${backendBaseUrl}${androidBackendSuffix} (hmr: ${frontendHmrPort})` +
        '\n'
    );
  }

  writeDevPorts({
    POMI_ANDROID_BACKEND_URL:
      platform === 'android' ? androidBackendUrl : undefined,
    POMI_FRONTEND_PORT: String(frontendPort),
    POMI_FRONTEND_HMR_PORT: String(frontendHmrPort),
    POMI_FRONTEND_BASE_URL: frontendBaseUrl,
    POMI_BACKEND_PORT: String(backendPort),
    POMI_BACKEND_BASE_URL: backendBaseUrl,
  });

  const overrideConfigPath = path.join(
    process.env.TMPDIR || os.tmpdir(),
    `pomi-tauri-dev.${platform}.${process.pid}.json`
  );
  const removeOverrideConfig = () => {
    fs.rmSync(overrideConfigPath, { force: true });
  };

  fs.writeFileSync(
    overrideConfigPath,
    JSON.stringify({
      build: {
        devUrl: frontendBaseUrl,
        ...(useExistingVite ? { beforeDevCommand: null } : {}),
      },
    }),
    'utf8'
  );

  const child = spawn(
    pnpmCommand,
    [
      '--filter',
      '@pomi/frontend',
      ...tauriCommand,
      ...(disableWatch ? ['--no-watch'] : []),
      '--config',
      'src-tauri/tauri.dev.conf.json',
      '--config',
      overrideConfigPath,
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        POMI_FRONTEND_PORT: String(frontendPort),
        POMI_FRONTEND_HMR_PORT: String(frontendHmrPort),
        POMI_FRONTEND_BASE_URL: frontendBaseUrl,
        POMI_BACKEND_PORT: String(backendPort),
        POMI_BACKEND_BASE_URL: backendBaseUrl,
        VITE_ANDROID_BACKEND_URL:
          platform === 'android' ? androidBackendUrl : undefined,
        VITE_BACKEND_URL: getViteBackendUrl(backendPort),
      },
    }
  );

  child.on('exit', (code, signal) => {
    removeOverrideConfig();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on('error', error => {
    removeOverrideConfig();
    console.error(error);
    process.exit(1);
  });
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
