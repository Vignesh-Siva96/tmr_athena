const { resolve } = require('node:path')

const REPO_ROOT = resolve(__dirname, '..')

/** @type {import('jest').Config} */
module.exports = {
  displayName: 'integration',
  rootDir: REPO_ROOT,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/integration/**/*.spec.ts', '<rootDir>/tests/concurrency/**/*.spec.ts'],
  globalSetup: '<rootDir>/tests/integration/global-setup.ts',
  globalTeardown: '<rootDir>/tests/integration/global-teardown.ts',
  // Test files explicitly `import './setup'` — Jest 29 no longer supports
  // a config option for "run after framework, before each suite", so we
  // rely on the import side-effect (registers beforeAll/beforeEach/afterAll).
  transform: {
    '^.+\\.(ts|mjs|js)$': ['ts-jest', { tsconfig: '<rootDir>/apps/api/tsconfig.json', isolatedModules: true }],
  },
  // MSW + several of its deps are ESM-only — let ts-jest transform them.
  // pnpm stores packages at node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>/.
  // The transformIgnorePatterns must match both layouts.
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.pnpm/)?(msw|@mswjs|@bundled-es-modules|rettime|until-async|outvariant|strict-event-emitter|@open-draft|headers-polyfill|is-node-process|@inquirer|chalk|graphql|tough-cookie|psl)(@[^/]+)?/)',
  ],
  extensionsToTreatAsEsm: [],
  moduleNameMapper: {
    '^@tmr/db$': '<rootDir>/packages/db/src',
    '^@tmr/db/(.*)$': '<rootDir>/packages/db/src/$1',
    '^@tmr/types$': '<rootDir>/packages/types/src',
    '^@tmr/types/(.*)$': '<rootDir>/packages/types/src/$1',
  },
  modulePaths: ['<rootDir>/apps/api/node_modules'],
  testTimeout: 60_000,
  // Integration tests share one DB schema — run serially.
  maxWorkers: 1,
  verbose: true,
  collectCoverageFrom: ['apps/api/src/**/*.ts', '!**/*.dto.ts', '!**/*.module.ts', '!**/main.ts'],
  coverageDirectory: '<rootDir>/coverage/integration',
  coverageReporters: ['text', 'lcov'],
}
