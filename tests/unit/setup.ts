// Vitest unit-test setup. Per-environment hooks live here so that jsdom-based
// tests for portal/bridge can register cleanup for React Testing Library.

// @testing-library/jest-dom matchers — only imported in jsdom envs to avoid
// pulling DOM polyfills into node-environment unit tests.
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@testing-library/jest-dom/vitest')
}
