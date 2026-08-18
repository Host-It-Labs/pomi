import {
  DEFAULT_PORTS,
  getBackendBaseUrl,
  getFrontendBaseUrl,
  parsePortNumber,
  readDevPorts,
  resolveFrontendPorts,
  writeDevPorts,
} from './dev-ports.mjs';

const run = async () => {
  const storedDevPorts = readDevPorts();
  const { frontendPort, frontendHmrPort } = await resolveFrontendPorts(
    process.env
  );
  const backendPort = parsePortNumber(
    process.env.POMI_BACKEND_PORT || storedDevPorts.POMI_BACKEND_PORT,
    DEFAULT_PORTS.backend
  );

  const frontendBaseUrl = getFrontendBaseUrl(frontendPort);
  const backendBaseUrl = getBackendBaseUrl(backendPort);

  writeDevPorts({
    POMI_FRONTEND_PORT: String(frontendPort),
    POMI_FRONTEND_HMR_PORT: String(frontendHmrPort),
    POMI_FRONTEND_BASE_URL: frontendBaseUrl,
    POMI_BACKEND_PORT: String(backendPort),
    POMI_BACKEND_BASE_URL: backendBaseUrl,
  });

  process.stdout.write(
    `[pomi] prepared frontend ${frontendBaseUrl}, backend ${backendBaseUrl} (hmr: ${frontendHmrPort})\n`
  );
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
