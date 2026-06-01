import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'contract',
    include: ['tests/contract/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
})
