// Vitest unit-test setup. Per-environment hooks live here so that jsdom-based
// tests for portal/bridge can register cleanup for React Testing Library.

// @testing-library/jest-dom matchers — only imported in jsdom envs to avoid
// pulling DOM polyfills into node-environment unit tests.
// Only bridge/portal workspaces have @testing-library/jest-dom in their
// package.json; the import is optional and silently skipped if unavailable.
if (typeof window !== 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@testing-library/jest-dom/vitest')
  } catch {
    // package not available in this workspace — matchers not registered,
    // which is fine for tests that only use built-in Vitest expect()
  }
}
