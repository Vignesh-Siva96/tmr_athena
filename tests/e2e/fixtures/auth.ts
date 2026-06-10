/**
 * Auth helpers for E2E flows.
 *
 * Programmatic login plants the JWT + user object directly into localStorage
 * (fast, selector-free). Keep at least ONE spec step doing real UI login so
 * the auth form itself stays covered — F1 uses the portal sign-in UI for that.
 */
import type { APIRequestContext, Page } from '@playwright/test'

const API = 'http://localhost:3001'

/** Obtain a JWT for a bridge agent via the API (no browser needed). */
export async function agentApiLogin(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<{ token: string; agent: Record<string, unknown> }> {
  const res = await request.post(`${API}/api/v1/auth/agent/signin`, {
    data: { email, password },
  })
  const body = (await res.json()) as { data: { agent: Record<string, unknown>; token: string } }
  return { token: body.data.token, agent: body.data.agent }
}

/** Obtain a JWT for a portal customer via the API (no browser needed). */
export async function customerApiLogin(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<{ token: string; user: Record<string, unknown> }> {
  const res = await request.post(`${API}/api/v1/auth/signin`, {
    data: { email, password },
  })
  const body = (await res.json()) as { data: { user: Record<string, unknown>; token: string } }
  return { token: body.data.token, user: body.data.user }
}

/** Plant a bridge agent token into localStorage before the first navigation. */
export async function plantAgentToken(
  page: Page,
  token: string,
  agent: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript(
    ([t, a]: [string, unknown]) => {
      localStorage.setItem('tmr_dash_token', t)
      localStorage.setItem('tmr_dash_agent', JSON.stringify(a))
    },
    [token, agent],
  )
}

/** Plant a portal customer token into localStorage before the first navigation. */
export async function plantCustomerToken(
  page: Page,
  token: string,
  user: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript(
    ([t, u]: [string, unknown]) => {
      localStorage.setItem('tmr_portal_token', t)
      localStorage.setItem('tmr_portal_user', JSON.stringify(u))
    },
    [token, user],
  )
}
