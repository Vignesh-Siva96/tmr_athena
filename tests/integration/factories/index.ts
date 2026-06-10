/**
 * Typed factories for test data. Each function inserts a row via the harness's
 * PrismaService and returns the created entity.
 *
 * Defaults are sensible; pass overrides to test specific edge cases.
 */

import { harness } from '../harness'
import { scrypt as scryptCb, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)

async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = (await scrypt(plain, salt, 64)) as Buffer
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function makeUser(overrides: Partial<{
  email: string
  name: string
  password: string
  isGuest: boolean
  isVerified: boolean
}> = {}) {
  const password = overrides.password ? await hashPassword(overrides.password) : null
  return harness.prisma.user.create({
    data: {
      email: overrides.email ?? `user-${randomBytes(4).toString('hex')}@example.com`,
      name: overrides.name ?? 'Test User',
      password,
      isGuest: overrides.isGuest ?? false,
      isVerified: overrides.isVerified ?? true,
    },
  })
}

export async function makeAgent(overrides: Partial<{
  email: string
  name: string
  password: string
  role: 'ADMIN' | 'PRIMARY_AGENT' | 'SECONDARY_AGENT'
  isActive: boolean
}> = {}) {
  const password = await hashPassword(overrides.password ?? 'agent-pw')
  return harness.prisma.agent.create({
    data: {
      email: overrides.email ?? `agent-${randomBytes(4).toString('hex')}@example.com`,
      name: overrides.name ?? 'Test Agent',
      password,
      role: (overrides.role ?? 'SECONDARY_AGENT') as any,
      isActive: overrides.isActive ?? true,
      inviteAccepted: true,
    },
  })
}

const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function makeRef(): string {
  let ref = ''
  const bytes = randomBytes(7)
  for (let i = 0; i < 7; i++) ref += REF_ALPHABET[bytes[i]! % 32]
  return ref
}

export async function makeTicket(opts: {
  userId: string
  title?: string
  status?: 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED' | 'DISMISSED'
  priority?: 'NORMAL' | 'HIGH' | 'URGENT'
  category?: 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'
  source?: 'PORTAL' | 'EMAIL'
  assigneeId?: string
  isTicket?: boolean
  ref?: string
}) {
  return harness.prisma.ticket.create({
    data: {
      userId: opts.userId,
      ref: opts.ref ?? makeRef(),
      isTicket: opts.isTicket ?? true,
      title: opts.title ?? 'Test ticket',
      status: (opts.status ?? 'OPEN') as any,
      priority: (opts.priority ?? 'NORMAL') as any,
      category: (opts.category ?? 'QUESTION') as any,
      source: (opts.source ?? 'PORTAL') as any,
      assigneeId: opts.assigneeId ?? null,
      emailThreadId: `thread-${randomBytes(4).toString('hex')}`,
    },
  })
}

export async function makeMessage(opts: {
  ticketId: string
  body?: string
  type?: 'REPLY' | 'INTERNAL_NOTE' | 'SYSTEM_EVENT'
  isInternal?: boolean
  authorUserId?: string
  authorAgentId?: string
  sentVia?: 'PORTAL' | 'EMAIL' | 'PORTAL_AND_EMAIL'
  messageId?: string
}) {
  return harness.prisma.message.create({
    data: {
      ticketId: opts.ticketId,
      body: opts.body ?? 'Test message body',
      type: (opts.type ?? 'REPLY') as any,
      isInternal: opts.isInternal ?? false,
      authorUserId: opts.authorUserId ?? null,
      authorAgentId: opts.authorAgentId ?? null,
      sentVia: (opts.sentVia ?? 'PORTAL') as any,
      messageId: opts.messageId ?? null,
    },
  })
}

/** Mint a valid JWT for a user or agent (matches the auth service's algorithm). */
export async function signJwt(subject: { id: string; role: 'user' | 'agent'; orgRole?: string }) {
  const { createHmac } = await import('node:crypto')
  const secret = process.env.BETTER_AUTH_SECRET ?? 'test-jwt-secret-deterministic-0123'
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    sub: subject.id,
    role: subject.role,
    ...(subject.orgRole ? { orgRole: subject.orgRole } : {}),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const signingInput = `${enc(header)}.${enc(payload)}`
  const sig = createHmac('sha256', secret).update(signingInput).digest('base64url')
  return `${signingInput}.${sig}`
}
