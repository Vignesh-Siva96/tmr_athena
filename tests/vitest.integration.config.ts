import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import swc from 'unplugin-swc'

const REPO_ROOT = resolve(__dirname, '..')

export default defineConfig({
  // Resolve from apps/api so @nestjs/*, @prisma/client, etc. are found via the
  // API's node_modules (they're not hoisted to the root).
  root: resolve(REPO_ROOT, 'apps/api'),

  // SWC handles NestJS decorators + emitDecoratorMetadata cleanly.
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2021',
      },
      module: { type: 'es6' },
    }),
  ],

  test: {
    name: 'integration',
    include: [resolve(REPO_ROOT, 'tests/integration/**/*.spec.ts'), resolve(REPO_ROOT, 'tests/concurrency/**/*.spec.ts')],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    globalSetup: [resolve(REPO_ROOT, 'tests/integration/global-setup.ts')],
    setupFiles: [resolve(REPO_ROOT, 'tests/integration/setup.ts')],
    pool: 'forks',
    poolOptions: {
      forks: {
        // Single fork keeps DB schema management simple: one Postgres, one schema,
        // TRUNCATE between tests. Within a file, beforeAll boots Nest once and
        // beforeEach truncates.
        singleFork: true,
      },
    },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    server: {
      deps: {
        // Inline the Nest stack so the SWC plugin transforms decorators correctly
        // when Vite-Node loads them. Without this Vite tries to externalize
        // CJS packages and the relative requires inside them fail.
        inline: [
          /@nestjs\//,
          /reflect-metadata/,
          /class-transformer/,
          /class-validator/,
          /rxjs/,
          /tslib/,
        ],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: resolve(REPO_ROOT, 'coverage/integration'),
      include: [resolve(REPO_ROOT, 'apps/api/src/**')],
      exclude: ['**/*.spec.ts', '**/*.d.ts', '**/main.ts', '**/*.module.ts', '**/*.dto.ts'],
    },
  },
  resolve: {
    alias: {
      '@tmr/db': resolve(REPO_ROOT, 'packages/db/src'),
      '@tmr/types': resolve(REPO_ROOT, 'packages/types/src'),
    },
  },
})
