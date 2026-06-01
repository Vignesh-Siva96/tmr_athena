import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    name: 'unit',
    include: [
      'tests/unit/**/*.spec.ts',
      'tests/unit/**/*.spec.tsx',
      'apps/api/src/**/*.spec.ts',
      'apps/portal/src/**/*.spec.{ts,tsx}',
      'apps/bridge/src/**/*.spec.{ts,tsx}',
      'packages/*/src/**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'tests/integration/**', 'tests/e2e/**'],
    environment: 'node',
    environmentMatchGlobs: [
      ['apps/portal/**', 'jsdom'],
      ['apps/bridge/**', 'jsdom'],
      ['tests/unit/portal/**', 'jsdom'],
      ['tests/unit/bridge/**', 'jsdom'],
    ],
    setupFiles: ['tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage/unit',
      include: [
        'apps/api/src/**',
        'apps/portal/src/**',
        'apps/bridge/src/**',
        'packages/*/src/**',
      ],
      exclude: [
        '**/*.spec.{ts,tsx}',
        '**/*.d.ts',
        '**/index.ts',
        '**/main.ts',
        '**/*.module.ts',
        '**/*.dto.ts',
      ],
      thresholds: {
        lines: 60,
        branches: 50,
        functions: 60,
        statements: 60,
      },
    },
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@tmr/db': resolve(__dirname, '../packages/db/src'),
      '@tmr/types': resolve(__dirname, '../packages/types/src'),
    },
  },
})
