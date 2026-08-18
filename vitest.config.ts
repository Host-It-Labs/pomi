import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { transform } from '@swc/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));
const sharedSource = path.join(root, 'packages/shared/src');
const backendSource = path.join(root, 'packages/backend/src');

function nestDecoratorPlugin(): Plugin {
  return {
    name: 'pomi-nest-decorator-metadata',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.startsWith(backendSource) || !id.endsWith('.ts')) return null;

      return transform(code, {
        filename: id,
        sourceMaps: true,
        module: { type: 'es6' },
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', decorators: true },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
          },
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [nestDecoratorPlugin()],
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'react/jsx-dev-runtime'],
  },
  resolve: {
    alias: {
      '@pomi/shared': path.join(sharedSource, 'index.ts'),
      '@pomi/shared/src': sharedSource,
      src: path.join(root, 'packages/backend/src'),
    },
  },
  test: {
    clearMocks: true,
    restoreMocks: true,
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'packages/shared/src/**/*.ts',
        'packages/frontend/src/**/*.{ts,tsx}',
        'packages/backend/src/**/*.ts',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/main.ts',
        'packages/frontend/src/main.tsx',
        '**/openapi.ts',
        '**/*.module.ts',
        'packages/backend/src/migrations/**',
      ],
    },
    projects: [
      {
        test: {
          name: 'shared-unit',
          environment: 'node',
          include: ['packages/shared/src/**/*.test.ts'],
        },
      },
      {
        plugins: [nestDecoratorPlugin()],
        resolve: {
          alias: {
            src: path.join(root, 'packages/backend/src'),
          },
        },
        test: {
          name: 'backend-unit',
          environment: 'node',
          include: ['packages/backend/test/unit/**/*.test.ts'],
        },
      },
      {
        optimizeDeps: {
          include: ['react', 'react-dom/client', 'react/jsx-dev-runtime'],
        },
        test: {
          name: 'frontend-unit',
          environment: 'jsdom',
          include: [
            'packages/frontend/src/**/*.test.ts',
            'packages/frontend/src/**/*.test.tsx',
          ],
          exclude: ['packages/frontend/src/**/*.browser.test.tsx'],
          setupFiles: ['packages/frontend/src/test/setup.ts'],
        },
      },
      {
        plugins: [nestDecoratorPlugin()],
        resolve: {
          alias: {
            src: path.join(root, 'packages/backend/src'),
          },
        },
        test: {
          name: 'backend-integration',
          environment: 'node',
          include: [
            'packages/backend/test/integration/**/*.integration.test.ts',
          ],
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        root: path.join(root, 'packages/frontend'),
        plugins: [tailwindcss()],
        optimizeDeps: {
          include: ['react', 'react-dom/client', 'react/jsx-dev-runtime'],
        },
        test: {
          name: 'frontend-browser',
          include: ['src/**/*.browser.test.tsx'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
