import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'node:path';
import { DEFAULT_PORTS, parsePortNumber } from '../../scripts/dev-ports.mjs';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(import.meta.dirname, '../..');
  const env = mode === 'test' ? {} : loadEnv(mode, envDir);
  const host = process.env.TAURI_DEV_HOST || env.VITE_HOST;
  const frontendPort = parsePortNumber(
    process.env.POMI_FRONTEND_PORT || env.VITE_PORT,
    DEFAULT_PORTS.frontend
  );
  const frontendHmrPort = parsePortNumber(
    process.env.POMI_FRONTEND_HMR_PORT || env.VITE_HMR_PORT,
    DEFAULT_PORTS.frontendHmr
  );
  const useStrictPort = Boolean(process.env.POMI_FRONTEND_PORT);
  const sentryDsn = env.VITE_SENTRY_DSN?.trim();
  const sentryRelease = env.VITE_SENTRY_RELEASE?.trim();
  const uploadSentrySourceMaps =
    process.env.POMI_UPLOAD_SENTRY_SOURCEMAPS === 'true';

  if (mode === 'production' && sentryDsn && !sentryRelease) {
    throw new Error(
      'VITE_SENTRY_RELEASE is required for production builds with Sentry enabled.'
    );
  }
  if (
    uploadSentrySourceMaps &&
    (!sentryRelease ||
      !process.env.SENTRY_AUTH_TOKEN ||
      !process.env.SENTRY_ORG ||
      !process.env.SENTRY_FRONTEND_PROJECT)
  ) {
    throw new Error(
      'Sentry source-map upload requires release, token, organization, and frontend project configuration.'
    );
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(uploadSentrySourceMaps
        ? [
            sentryVitePlugin({
              authToken: process.env.SENTRY_AUTH_TOKEN,
              org: process.env.SENTRY_ORG,
              project: process.env.SENTRY_FRONTEND_PROJECT,
              release: { name: sentryRelease },
              sourcemaps: {
                filesToDeleteAfterUpload: ['./dist/**/*.map'],
              },
              telemetry: false,
            }),
          ]
        : []),
    ],
    clearScreen: false,
    envDir: mode === 'test' ? false : envDir,
    envPrefix: 'VITE_',
    build: {
      sourcemap: uploadSentrySourceMaps ? 'hidden' : false,
    },
    resolve: {
      alias: {
        '@pomi/shared': path.resolve(import.meta.dirname, '../shared'),
      },
    },
    server: {
      port: frontendPort,
      strictPort: useStrictPort,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host: host === '0.0.0.0' ? 'localhost' : host,
            port: frontendHmrPort,
          }
        : undefined,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
  };
});
