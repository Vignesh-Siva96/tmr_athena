/**
 * Playwright global setup.
 *
 * Container lifecycle lives in tests/e2e/infra.ts (`up`/`down`) because Playwright
 * boots webServers BEFORE globalSetup runs — infra created here would arrive too
 * late for the API process. By the time this executes, the webServers are already
 * up against the env from tests/e2e/.env.e2e (read by playwright.config.ts).
 *
 * This hook only verifies the API really is wired to the test stack (and not a
 * stray dev server) by checking a test-only route, so misconfiguration fails the
 * run in seconds with a clear message instead of as cryptic 401s inside flows.
 */

import { FullConfig } from '@playwright/test'

export default async function globalSetup(_: FullConfig): Promise<void> {
  const res = await fetch('http://localhost:3001/api/v1/__test/captured-mail').catch((err: unknown) => {
    throw new Error(`API on :3001 is unreachable: ${String(err)}`)
  })
  if (!res.ok) {
    throw new Error(
      `API on :3001 answered ${res.status} for /__test/captured-mail — it is NOT running in test mode. ` +
      `A dev server is likely occupying the port. Stop \`pnpm dev\` and rerun.`,
    )
  }
}
