/**
 * Playwright global teardown.
 *
 * Intentionally a no-op: container lifecycle is owned by tests/e2e/infra.ts so
 * that `--ui` / repeated local runs can reuse a warm stack. `pnpm test:e2e`
 * calls `infra.ts down` after the run; for manual sessions run
 * `pnpm test:e2e:infra:down` when finished.
 */

import { FullConfig } from '@playwright/test'

export default async function globalTeardown(_: FullConfig): Promise<void> {
  // no-op — see header
}
