import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
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

  return {
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    envDir: mode === 'test' ? false : envDir,
    envPrefix: 'VITE_',
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/')
            ) {
              return 'react';
            }
            if (
              [
                'framer-motion',
                'clsx',
                'react-icons',
                'zustand',
                'socket.io-client',
                'uuid',
                '@sentry/react',
              ].some(dependency => id.includes(`/node_modules/${dependency}/`))
            ) {
              return 'vendor';
            }
          },
        },
      },
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
