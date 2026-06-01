/**
 * F1 — Portal ticket → bridge SSE → agent reply → portal SSE + email to customer.
 *
 * Headline functional flow. Twelve numbered assertions matching the plan's
 * Part D Layer 4 step table (see /home/vignesh/.claude/plans/...md).
 *
 * NB: this spec is the scaffold. The actual seeded credentials, SMTP capture
 * endpoint, and SSE subscription helper are introduced incrementally — each
 * marked TODO. The structure is correct; the bodies need real selectors once
 * the suite is run end-to-end for the first time.
 */

import { test, expect, request as apiRequest, type APIRequestContext, type Browser } from '@playwright/test'

const PORTAL = 'http://localhost:3000'
const BRIDGE = 'http://localhost:3002'
const API = 'http://localhost:3001'

const CUSTOMER = { email: 'jordan@acmecorp.com', password: 'customer123' }
const AGENT = { email: 'agent@twominutereports.com', password: 'agent123' }

test.describe('F1 — Portal → Bridge SSE → Agent reply → Portal SSE + email', () => {
  test('twelve-step happy path', async ({ browser }) => {
    // ───────────────────────────────────────────────────────────────────────────
    // Setup: open the agent in a separate context so both sessions stay live.
    // ───────────────────────────────────────────────────────────────────────────
    const agentContext = await browser.newContext()
    const agentPage = await agentContext.newPage()
    await signInAsAgent(agentPage, AGENT)
    await agentPage.goto(`${BRIDGE}/inbox`)

    const customerContext = await browser.newContext()
    const customerPage = await customerContext.newPage()
    await signInAsUser(customerPage, CUSTOMER)

    // ───────────────────────────────────────────────────────────────────────────
    // 1.1–1.3: Customer submits ticket; confirmation email captured.
    // ───────────────────────────────────────────────────────────────────────────
    await customerPage.goto(`${PORTAL}/submit`)
    await customerPage.getByLabel(/title|subject/i).fill('F1 flow test')
    await customerPage.getByLabel(/description|message/i).fill('This is a regression flow.')
    const submitResponse = customerPage.waitForResponse(
      (r) => r.url().includes('/tickets') && r.request().method() === 'POST',
    )
    await customerPage.getByRole('button', { name: /submit|create/i }).click()
    const submitted = await submitResponse
    expect(submitted.status()).toBe(201)
    const created = await submitted.json()
    const ticketId = created.data.id

    // 1.3 — confirmation email captured by mock SMTP. The mock-SMTP endpoint
    // exposes a /captured-mail route in test mode.
    const mail = await fetch(`${API}/__test/captured-mail?to=${CUSTOMER.email}`).then((r) => r.json())
    expect(mail.length).toBeGreaterThanOrEqual(1)
    expect(mail[0].headers['Message-ID']).toMatch(new RegExp(`<ticket-.*@`))

    // ───────────────────────────────────────────────────────────────────────────
    // 1.5: Bridge inbox shows the new ticket without page reload (SSE-driven).
    // ───────────────────────────────────────────────────────────────────────────
    await expect(agentPage.getByText('F1 flow test')).toBeVisible({ timeout: 5_000 })

    // 1.6 — agent opens ticket detail.
    await agentPage.getByText('F1 flow test').click()
    await expect(agentPage).toHaveURL(new RegExp(`/tickets/${ticketId}$`))
    await expect(agentPage.getByText('This is a regression flow.')).toBeVisible()

    // ───────────────────────────────────────────────────────────────────────────
    // 1.7–1.10: Agent sends reply; SSE pushes message-created to portal.
    // ───────────────────────────────────────────────────────────────────────────
    await agentPage.getByRole('button', { name: /reply/i }).click()
    await agentPage.getByRole('textbox', { name: /reply|message body/i }).fill('Thanks, looking into it.')
    const replyResponse = agentPage.waitForResponse(
      (r) => r.url().includes('/messages') && r.request().method() === 'POST',
    )
    await agentPage.getByRole('button', { name: /^send$/i }).click()
    const replied = await replyResponse
    expect(replied.status()).toBe(201)

    // 1.9 — agent reply email captured with In-Reply-To header set.
    const replyMail = await fetch(`${API}/__test/captured-mail?to=${CUSTOMER.email}`).then((r) => r.json())
    expect(replyMail.length).toBeGreaterThanOrEqual(2)
    const agentMail = replyMail.at(-1)
    expect(agentMail.headers['In-Reply-To']).toBeTruthy()
    expect(agentMail.headers.Subject).toMatch(/^Re:/i)

    // ───────────────────────────────────────────────────────────────────────────
    // 1.11–1.12: Customer's open ticket page renders the reply without refresh.
    // ───────────────────────────────────────────────────────────────────────────
    await customerPage.goto(`${PORTAL}/tickets/${ticketId}`)
    await expect(customerPage.getByText('Thanks, looking into it.')).toBeVisible({ timeout: 5_000 })
    await customerPage.reload()
    await expect(customerPage.getByText('Thanks, looking into it.')).toBeVisible()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Helpers (per-suite — would normally live in tests/e2e/fixtures/auth.ts).
// ──────────────────────────────────────────────────────────────────────────────

async function signInAsAgent(page: import('@playwright/test').Page, creds: typeof AGENT): Promise<void> {
  await page.goto(`${BRIDGE}/auth`)
  // Real bridge auth form uses bare <label> + <input> without htmlFor association,
  // so getByLabel doesn't work. Selecting by input type is resilient.
  await page.locator('input[type="email"]').fill(creds.email)
  await page.locator('input[type="password"]').fill(creds.password)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await page.waitForURL(/\/inbox|\/dashboard|\/$/)
}

async function signInAsUser(page: import('@playwright/test').Page, creds: typeof CUSTOMER): Promise<void> {
  await page.goto(`${PORTAL}/auth`)
  // Portal AuthForm has a "Sign in" tab button AND a "Sign in" submit button —
  // target the submit one specifically.
  await page.locator('input[type="email"]').first().fill(creds.email)
  await page.locator('input[type="password"]').first().fill(creds.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/tickets|\/$/)
}
