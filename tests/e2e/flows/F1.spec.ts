/**
 * F1 — Portal ticket → Bridge SSE → Agent reply → Portal SSE + email to customer.
 *
 * Six numbered assertions matching the plan (CLAUDE.md checklist §5):
 *   1. Customer signs in (real UI login) and submits a ticket with a unique title.
 *   2. Confirmation email arrives at customer's address (G2 queue → poll).
 *   3. Bridge inbox shows the new ticket row via SSE (debounce ~300 ms).
 *   4. Agent opens the ticket and sends a reply via the compose editor.
 *   5. Customer's portal thread shows the reply (5s poll) + reply email.
 *   6. Customer replies in Portal → Bridge thread updates; G1 portal-copy email sent.
 *
 * Data isolation: each run uses a unique subject prefix so consecutive runs do
 * not accidentally find each other's tickets (seeded DB is NOT reset between runs).
 */

import { test, expect } from '@playwright/test'
import {
  agentApiLogin,
  customerApiLogin,
  plantAgentToken,
  plantCustomerToken,
} from '../fixtures/auth'
import { expectMailDelivered, resetCapturedMail } from '../fixtures/mail'

const PORTAL = 'http://localhost:3000'
const BRIDGE = 'http://localhost:3002'

const CUSTOMER_CREDS = { email: 'jordan@acmecorp.com', password: 'customer123' }
const AGENT_CREDS = { email: 'agent@twominutereports.com', password: 'agent123' }
// G1 portal-copy goes To the support mailbox = AppConfig.oauthEmail, which
// tests/e2e/infra.ts sets to support@e2e.test when marking email "connected".
const SUPPORT_MIRROR_ADDR = 'support@e2e.test'

test.describe('F1 — Portal → Bridge SSE → Agent reply → Portal SSE + email', () => {
  test.beforeEach(async ({ request }) => {
    await resetCapturedMail(request)
  })

  test('portal-to-bridge round-trip', async ({ browser, request }) => {
    const runId = Date.now()
    const UNIQUE_TITLE = `F1-${runId} flow test`

    // ── Agent browser context (programmatic login — no UI interaction needed) ──
    const { token: agentToken, agent } = await agentApiLogin(
      request,
      AGENT_CREDS.email,
      AGENT_CREDS.password,
    )
    const agentCtx = await browser.newContext()
    const agentPage = await agentCtx.newPage()
    await plantAgentToken(agentPage, agentToken, agent)
    await agentPage.goto(`${BRIDGE}/inbox`)

    // ── Customer browser context (real UI login so auth form stays covered) ──
    const customerCtx = await browser.newContext()
    const customerPage = await customerCtx.newPage()
    await customerPage.goto(`${PORTAL}/auth`)
    await customerPage.locator('input[type="email"]').first().fill(CUSTOMER_CREDS.email)
    await customerPage.locator('input[type="password"]').first().fill(CUSTOMER_CREDS.password)
    await customerPage.locator('button[type="submit"]').click()
    await customerPage.waitForURL(/\/tickets|\/$/)

    // ── 1. Customer submits ticket ───────────────────────────────────────────
    await customerPage.goto(`${PORTAL}/submit`)

    // Category must be selected before form submits — pick the first radio option
    await customerPage.locator('[data-testid="submit-title"]').fill(UNIQUE_TITLE)
    // Description is required for the flow: without it no customer REPLY message
    // exists on the ticket, so the thread has no message card (and no Reply button).
    await customerPage.locator('[data-testid="submit-description"]').fill('Something is broken in the F1 flow — please help.')
    await customerPage.getByRole('radio').first().click()

    const submitResponse = customerPage.waitForResponse(
      (r) => r.url().includes('/api/v1/tickets') && r.request().method() === 'POST',
    )
    await customerPage.locator('[data-testid="submit-send"]').click()
    const submitted = await submitResponse
    expect(submitted.status()).toBe(201)
    const createdBody = (await submitted.json()) as {
      data: { ticket: { id: string }; displayId: string }
    }
    const ticketId = createdBody.data.ticket.id

    // ── 2. Confirmation email arrives at customer address (G2 queue latency) ─
    const confirmMails = await expectMailDelivered(request, CUSTOMER_CREDS.email, 1)
    const confirmMail = confirmMails[0]!
    expect(confirmMail.headers['Subject'] ?? confirmMail.subject).toMatch(/\[/)

    // ── 3. Bridge inbox shows ticket row via SSE (debounce ~300 ms) ──────────
    // SSE event → debounced refetch → row appears; allow generous timeout.
    await expect(
      agentPage.locator('[data-testid="inbox-row"]').filter({ hasText: UNIQUE_TITLE }),
    ).toBeVisible({ timeout: 10_000 })

    // The row should carry a status-pill once it is a real ticket (it is — portal tickets
    // are always isTicket=true) and the ticket-ref displayId badge.
    const row = agentPage.locator('[data-testid="inbox-row"]').filter({ hasText: UNIQUE_TITLE })
    await expect(row.locator('[data-testid="status-pill"]')).toBeVisible()
    await expect(row.locator('[data-testid="ticket-ref"]')).toBeVisible()

    // ── 4. Agent opens ticket and sends a reply ───────────────────────────────
    await row.click()
    await agentPage.waitForURL(new RegExp(`/tickets/${ticketId}$`))

    // Open the compose drawer via the last message card's Reply button.
    // (locator.isVisible() does NOT auto-wait — a conditional click here raced the
    // page load and silently skipped. click() auto-waits for actionability.)
    await agentPage.getByRole('button', { name: /^reply$/i }).first().click()

    const replyEditor = agentPage.locator('[data-testid="reply-editor"]')
    await expect(replyEditor).toBeVisible({ timeout: 5_000 })
    await replyEditor.click()
    await replyEditor.type('Thanks for reaching out — looking into it now.')

    const sendResponse = agentPage.waitForResponse(
      (r) => r.url().includes('/api/v1/tickets') && r.url().includes('/messages') && r.request().method() === 'POST',
    )
    await agentPage.locator('[data-testid="reply-send"]').click()
    const sendRes = await sendResponse
    expect(sendRes.status()).toBe(201)

    // ── 5. Customer portal shows agent reply + reply email ────────────────────
    // Portal polls every 5 s; wait for the reply message to appear.
    await customerPage.goto(`${PORTAL}/tickets/${ticketId}`)
    await expect(
      customerPage.locator('[data-testid="message-body"]').filter({ hasText: 'looking into it now' }),
    ).toBeVisible({ timeout: 15_000 })

    // Reply email sent via pg-boss worker — poll for it.
    const replyMails = await expectMailDelivered(request, CUSTOMER_CREDS.email, 2)
    const agentReply = replyMails.at(-1)!
    expect(agentReply.headers['In-Reply-To'] ?? agentReply.headers['in-reply-to']).toBeTruthy()
    expect(agentReply.headers['Subject'] ?? agentReply.subject).toMatch(/^Re:/i)

    // ── 6. Customer replies in Portal → Bridge updates + G1 portal copy ───────
    // Need a fresh customer token now that the customer is authed.
    const { token: customerToken, user } = await customerApiLogin(
      request,
      CUSTOMER_CREDS.email,
      CUSTOMER_CREDS.password,
    )
    await plantCustomerToken(customerPage, customerToken, user as Record<string, unknown>)
    await customerPage.reload()

    const portalEditor = customerPage.locator('[data-testid="reply-editor"]')
    await expect(portalEditor).toBeVisible({ timeout: 5_000 })
    await portalEditor.click()
    await portalEditor.type('Still having trouble — can you help further?')

    const customerSendResponse = customerPage.waitForResponse(
      (r) => r.url().includes('/api/v1/tickets') && r.url().includes('/messages') && r.request().method() === 'POST',
    )
    await customerPage.locator('[data-testid="reply-send"]').click()
    await customerSendResponse

    // Bridge thread updates via SSE
    await expect(
      agentPage.locator('[data-testid="message-body"]').filter({ hasText: 'can you help further' }),
    ).toBeVisible({ timeout: 15_000 })

    // G1: portal copy should arrive at the support mirror address
    await expectMailDelivered(request, SUPPORT_MIRROR_ADDR, 1, { timeout: 15_000 })
  })
})
