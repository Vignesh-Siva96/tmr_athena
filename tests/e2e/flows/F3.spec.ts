/**
 * F3 — Portal email verification banner + forgot/reset-password flows.
 *
 * Two scenarios (plan §6, regression catalogue R204-R208 cover the API side):
 *   1. Sign up via the Portal UI → verification banner is visible (isVerified=false) →
 *      confirmation email arrives → follow verify-email link → banner disappears.
 *   2. "Forgot password?" on /auth → /forgot-password → reset email arrives →
 *      follow reset-password link → set a new password → sign in with it.
 *
 * Regression catalogue:
 *   R212 — previously-dead "Forgot password?" button now navigates to /forgot-password
 *     and completes the reset round-trip end-to-end.
 *
 * Data isolation: each run uses a unique email per scenario so consecutive runs
 * don't collide (seeded DB is NOT reset between runs).
 */

import { test, expect } from '@playwright/test'
import { resetCapturedMail, expectMailDelivered } from '../fixtures/mail'

const PORTAL = 'http://localhost:3000'

const NEW_PASSWORD = 'Br4nd!NewPass'

function extractToken(mailText: string | undefined, path: string): string {
  const match = mailText?.match(new RegExp(`${path}\\?token=([^\\s&]+)`))
  if (!match) throw new Error(`Could not find ${path} token in email body:\n${mailText}`)
  return match[1]!
}

test.describe('F3 — Email verification banner + forgot/reset-password', () => {
  test.beforeEach(async ({ request }) => {
    await resetCapturedMail(request)
  })

  test('signup shows verification banner, verify-email link clears it', async ({ page, request }) => {
    const runId = Date.now()
    const EMAIL = `e2e-f3-signup-${runId}@example.com`

    await page.goto(`${PORTAL}/auth`)

    // Switch to "Create account" tab
    await page.getByRole('button', { name: 'Create account' }).first().click()

    await page.locator('input[type="email"]').first().fill(EMAIL)
    const passwordInputs = page.locator('input[type="password"]')
    await passwordInputs.nth(0).fill('OldPassw0rd!')
    await passwordInputs.nth(1).fill('OldPassw0rd!')

    await page.getByRole('button', { name: /create account/i }).click()
    await page.waitForURL(/\/tickets/)

    // ── Banner visible for unverified user ────────────────────────────────────
    await expect(page.locator('[data-testid="verification-banner"]')).toBeVisible({ timeout: 10_000 })

    // ── Verification email arrives (G2 queue → poll) ───────────────────────────
    const mails = await expectMailDelivered(request, EMAIL, 1)
    const token = extractToken(mails[0]!.text, '/verify-email')

    // ── Follow the verify-email link ───────────────────────────────────────────
    await page.goto(`${PORTAL}/verify-email?token=${token}`)
    await expect(page.getByText('Email verified')).toBeVisible({ timeout: 10_000 })

    // ── Banner gone once verified ──────────────────────────────────────────────
    await page.goto(`${PORTAL}/tickets`)
    await expect(page.locator('[data-testid="verification-banner"]')).not.toBeVisible()
  })

  test('forgot-password → reset → sign in with new password', async ({ page, request }) => {
    const runId = Date.now()
    const EMAIL = `e2e-f3-reset-${runId}@example.com`

    // ── Create an account to reset later ───────────────────────────────────────
    await page.goto(`${PORTAL}/auth`)
    await page.getByRole('button', { name: 'Create account' }).first().click()
    await page.locator('input[type="email"]').first().fill(EMAIL)
    const passwordInputs = page.locator('input[type="password"]')
    await passwordInputs.nth(0).fill('OldPassw0rd!')
    await passwordInputs.nth(1).fill('OldPassw0rd!')
    await page.getByRole('button', { name: /create account/i }).click()
    await page.waitForURL(/\/tickets/)

    // Sign out so the "Forgot password?" flow starts from a signed-out state
    await page.getByRole('button', { name: /sign out/i }).click()
    await page.waitForURL(/\/auth|\/$/)

    // ── R212 — "Forgot password?" navigates to /forgot-password ───────────────
    await resetCapturedMail(request)
    await page.goto(`${PORTAL}/auth`)
    await page.getByRole('button', { name: /forgot password/i }).click()
    await page.waitForURL(/\/forgot-password/)

    await page.locator('input[type="email"]').first().fill(EMAIL)
    await page.locator('button[type="submit"]').click()
    await expect(page.getByText('Check your email')).toBeVisible({ timeout: 10_000 })

    // ── Reset email arrives ─────────────────────────────────────────────────────
    const mails = await expectMailDelivered(request, EMAIL, 1)
    const token = extractToken(mails[0]!.text, '/reset-password')

    // ── Follow the reset-password link and set a new password ─────────────────
    await page.goto(`${PORTAL}/reset-password?token=${token}`)
    const resetPasswordInputs = page.locator('input[type="password"]')
    await resetPasswordInputs.nth(0).fill(NEW_PASSWORD)
    await resetPasswordInputs.nth(1).fill(NEW_PASSWORD)
    await page.locator('button[type="submit"]').click()
    await expect(page.getByText('Password updated')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(/\/auth/)

    // ── Sign in with the new password ───────────────────────────────────────────
    await page.locator('input[type="email"]').first().fill(EMAIL)
    await page.locator('input[type="password"]').first().fill(NEW_PASSWORD)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/tickets/)
  })
})
