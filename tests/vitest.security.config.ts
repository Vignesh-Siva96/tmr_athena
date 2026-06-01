import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Security tests reuse the integration harness — same DB, same MSW, same Nest app.
// They live in a separate config only so they can be run as a dedicated CI job.
export default defineConfig({
  test: {
    name: 'security',
    include: ['tests/security/**/*.spec.ts'],
    environment: 'node',
    globalSetup: ['tests/integration/global-setup.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2 } },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@tmr/db': resolve(__dirname, '../packages/db/src'),
      '@tmr/types': resolve(__dirname, '../packages/types/src'),
    },
  },
})
