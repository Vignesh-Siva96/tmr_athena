/* eslint-disable no-console */
import { readFileSync } from 'node:fs'
import { PrismaClient, Prisma, type TicketCategory, type TicketPriority, type TicketStatus } from '@prisma/client'

// ─── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const positional = args.filter((a) => !a.startsWith('-'))
const flagArgs = args.filter((a) => a.startsWith('-'))
const flags = new Set(flagArgs.filter((a) => !a.includes('=')))
const flagValues = new Map<string, string>(
  flagArgs.filter((a) => a.includes('=')).map((a) => {
    const [k, v] = a.split('=')
    return [k!, v ?? '']
  }),
)
const filePath = positional[0] ?? '/home/vignesh/tmr_chatwoot_conversations_apr0126_to_may1926.json'
const DRY_RUN = flags.has('--dry-run')
const FORCE = flags.has('--force')
const CLEAN_ALL = flags.has('--clean-all')
const LIMIT = flagValues.has('--limit') ? Math.max(1, Number(flagValues.get('--limit'))) : null

const ADMIN_EMAIL = 'admin@twominutereports.com'

// ─── Types ──────────────────────────────────────────────────────────────────

interface RawMessage {
  message_id: number
  content: string
  message_type: number
  created_at: string
}

interface RawConversation {
  conversation_id: number
  conversation_created_at: string
  contact_email: string
  messages: string | RawMessage[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseMessages(raw: string | RawMessage[]): RawMessage[] {
  if (Array.isArray(raw)) return raw
  try {
    return JSON.parse(raw) as RawMessage[]
  } catch {
    return []
  }
}

function humanizeFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  if (/^(no-?reply|info|admin|support|hello|hi|contact|sales|billing)$/i.test(local)) {
    return email
  }
  const cleaned = local
    .replace(/\d+$/g, '')
    .replace(/[._-]+/g, ' ')
    .trim()
  if (!cleaned) return email
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

function stripHtml(s: string | null | undefined): string {
  if (!s) return ''
  return String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

function deriveTitle(firstUserBody: string, fallbackName: string): string {
  let body = stripHtml(firstUserBody).replace(/\s+/g, ' ').trim()
  body = body.replace(/^(hi|hey|hello|hola|dear)[,!\s].*?(?=[A-Z]|$)/i, '').trim()
  if (!body) return `Support request from ${fallbackName}`
  const sentenceEnd = body.search(/[.!?\n]/)
  let title = sentenceEnd > 0 ? body.slice(0, sentenceEnd) : body
  if (title.length > 80) title = `${title.slice(0, 77).trimEnd()}…`
  title = title.replace(/[.,;:!?\s]+$/, '').trim()
  if (!title) return `Support request from ${fallbackName}`
  return title.charAt(0).toUpperCase() + title.slice(1)
}

const BUG_KW = ['bug', 'broken', 'error', 'not working', 'revoked', 'fails', 'failing', 'crash', 'wrong data', 'no data', 'doesn\'t work', "doesn't work"]
const FEATURE_KW = ['feature', 'request', 'please add', 'can you add', 'would like', 'support for', 'add support']
const BILLING_KW = ['invoice', 'billing', 'subscription', 'refund', 'plan', 'price', 'pricing', 'pay', 'payment', 'upgrade', 'downgrade']
const QUESTION_KW = ['how do i', 'how to', 'what is', 'where can i', 'where do i', 'why is', 'why are']

function deriveCategory(body: string): TicketCategory {
  const text = body.toLowerCase()
  if (BUG_KW.some((k) => text.includes(k))) return 'BUG_REPORT'
  // Billing keywords are specific — beat softer FEATURE_REQUEST signals like "would like".
  if (BILLING_KW.some((k) => text.includes(k))) return 'BILLING'
  if (FEATURE_KW.some((k) => text.includes(k))) return 'FEATURE_REQUEST'
  if (QUESTION_KW.some((k) => text.includes(k))) return 'QUESTION'
  if (body.trim().length < 200 && body.includes('?')) return 'QUESTION'
  return 'OTHER'
}

const URGENT_KW = ['urgent', 'asap', 'critical', 'production down', 'not working at all', 'losing money', 'clients are', 'immediately']
const HIGH_KW = ['important', 'priority', 'affecting multiple', 'whole team', 'all our', 'every customer']

function derivePriority(body: string): TicketPriority {
  const text = body.toLowerCase()
  if (URGENT_KW.some((k) => text.includes(k))) return 'URGENT'
  if (HIGH_KW.some((k) => text.includes(k))) return 'HIGH'
  return 'NORMAL'
}

// Connector mapping: detect TMR data source/destination from message text.
// Order matters — more specific patterns first.
const CONNECTOR_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/google\s*analytics|\bga4\b/i, 'Google Analytics 4'],
  [/search\s*console|\bgsc\b/i, 'Google Search Console'],
  [/google\s*ads|adwords/i, 'Google Ads'],
  [/google\s*business\s*profile|\bgmb\b|google\s*my\s*business/i, 'Google Business Profile'],
  [/google\s*sheets?|\bsheets?\b/i, 'Google Sheets'],
  [/looker(\s*studio)?|data\s*studio/i, 'Looker Studio'],
  [/facebook\s*ads?|fb\s*ads/i, 'Facebook Ads'],
  [/\bmeta\s*ads?\b|\bmeta\b/i, 'Meta Ads'],
  [/instagram/i, 'Instagram'],
  [/linkedin/i, 'LinkedIn Ads'],
  [/tiktok/i, 'TikTok Ads'],
  [/youtube/i, 'YouTube'],
  [/shopify/i, 'Shopify'],
  [/amazon\s*ads?|amazon\s*advertising|amazon\s*seller|amazon\s*sp/i, 'Amazon Ads'],
  [/snapchat/i, 'Snapchat Ads'],
  [/bing\s*ads|microsoft\s*ads/i, 'Microsoft Ads'],
  [/pinterest/i, 'Pinterest Ads'],
  [/x\.com|twitter|\b(x|twitter)\s*ads/i, 'X (Twitter) Ads'],
  [/hubspot/i, 'HubSpot'],
  [/salesforce/i, 'Salesforce'],
  [/mailchimp/i, 'Mailchimp'],
  [/klaviyo/i, 'Klaviyo'],
  [/stripe/i, 'Stripe'],
  [/apple\s*(search\s*ads|ads)/i, 'Apple Search Ads'],
]

function deriveConnector(body: string): string | null {
  for (const [re, name] of CONNECTOR_PATTERNS) {
    if (re.test(body)) return name
  }
  return null
}

function deriveStatus(conversationCreatedAt: Date, lastRealMsg: RawMessage | null, now: Date): TicketStatus {
  const ageDays = (now.getTime() - conversationCreatedAt.getTime()) / 86_400_000
  const lastFromAgent = lastRealMsg?.message_type === 1
  if (ageDays > 14) return 'RESOLVED'
  if (ageDays > 3 && lastFromAgent) return 'RESOLVED'
  if (ageDays > 3 && !lastFromAgent) return 'IN_PROGRESS'
  if (lastFromAgent) return 'WAITING'
  return 'OPEN'
}

// ─── Main ───────────────────────────────────────────────────────────────────

interface PreparedConversation {
  conversationId: number
  email: string
  name: string
  conversationCreatedAt: Date
  lastMessageAt: Date
  title: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  connector: string | null
  messages: { body: string; createdAt: Date; fromAgent: boolean }[]
}

// Pick a diverse subset of conversations.
// Strategy: one ticket per connector (rotating through connectors), preferring
// conversations with both user AND agent messages and richer threads.
function curateDiverse(items: PreparedConversation[], n: number): PreparedConversation[] {
  const score = (p: PreparedConversation): number => {
    const userMsgs = p.messages.filter((m) => !m.fromAgent).length
    const agentMsgs = p.messages.filter((m) => m.fromAgent).length
    // Strong bonus for having agent replies (resolved-looking thread), then richness.
    return (agentMsgs > 0 ? 100 : 0) + Math.min(userMsgs, 6) * 5 + Math.min(agentMsgs, 6) * 5
  }
  const sorted = [...items].sort((a, b) => score(b) - score(a))

  const byConnector = new Map<string, PreparedConversation[]>()
  const noConnector: PreparedConversation[] = []
  for (const p of sorted) {
    const key = p.connector ?? '__NONE__'
    if (p.connector) {
      const list = byConnector.get(key) ?? []
      list.push(p)
      byConnector.set(key, list)
    } else {
      noConnector.push(p)
    }
  }

  // Round-robin: take best from each connector until we hit n.
  const picked: PreparedConversation[] = []
  const seenEmails = new Set<string>()
  const connectorKeys = [...byConnector.keys()]
  let cursor = 0
  while (picked.length < n && connectorKeys.length > 0) {
    let progressed = false
    for (let i = 0; i < connectorKeys.length && picked.length < n; i++) {
      const k = connectorKeys[(cursor + i) % connectorKeys.length]!
      const list = byConnector.get(k)!
      // Prefer one unique email per connector pass.
      const idx = list.findIndex((p) => !seenEmails.has(p.email))
      const pick = idx >= 0 ? list.splice(idx, 1)[0] : list.shift()
      if (pick) {
        picked.push(pick)
        seenEmails.add(pick.email)
        progressed = true
      }
      if (list.length === 0) byConnector.delete(k)
    }
    if (!progressed) break
    cursor++
  }

  // Fill any remaining slots from no-connector pool.
  for (const p of noConnector) {
    if (picked.length >= n) break
    picked.push(p)
  }

  // Sort final list by conversation date for tidier output.
  return picked.sort((a, b) => a.conversationCreatedAt.getTime() - b.conversationCreatedAt.getTime())
}

async function main(): Promise<void> {
  const now = new Date()
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Reading ${filePath}`)
  const rawConvos = JSON.parse(readFileSync(filePath, 'utf8')) as RawConversation[]
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Parsed ${rawConvos.length} conversations`)

  // Prepare in memory first
  const prepared: PreparedConversation[] = []
  let skippedNoUserMsg = 0
  let minDate: Date | null = null
  let maxDate: Date | null = null

  for (const c of rawConvos) {
    const msgs = parseMessages(c.messages)
    const realMsgs = msgs.filter((m) => m.message_type === 0 || m.message_type === 1)
    const userMsgs = realMsgs.filter((m) => m.message_type === 0)
    if (userMsgs.length === 0) {
      skippedNoUserMsg++
      continue
    }

    const conversationCreatedAt = new Date(c.conversation_created_at)
    const firstUserBody = String(userMsgs[0]?.content ?? '').trim()
    const name = humanizeFromEmail(c.contact_email)
    const lastRealMsg = realMsgs[realMsgs.length - 1] ?? null
    const lastMessageAt = lastRealMsg ? new Date(lastRealMsg.created_at) : conversationCreatedAt

    if (!minDate || conversationCreatedAt < minDate) minDate = conversationCreatedAt
    if (!maxDate || conversationCreatedAt > maxDate) maxDate = conversationCreatedAt

    // Connector detection scans the entire conversation, not just first message.
    const fullBody = realMsgs.map((m) => stripHtml(m.content)).join('\n')
    prepared.push({
      conversationId: c.conversation_id,
      email: c.contact_email,
      name,
      conversationCreatedAt,
      lastMessageAt,
      title: deriveTitle(firstUserBody, name),
      category: deriveCategory(firstUserBody),
      priority: derivePriority(firstUserBody),
      status: deriveStatus(conversationCreatedAt, lastRealMsg, now),
      connector: deriveConnector(fullBody),
      messages: realMsgs.map((m) => ({
        body: stripHtml(m.content).trim(),
        createdAt: new Date(m.created_at),
        fromAgent: m.message_type === 1,
      })).filter((m) => m.body.length > 0),
    })
  }

  console.log(`${DRY_RUN ? '[dry-run] ' : ''}After filtering (≥1 user msg): ${prepared.length}`)
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Skipped (no user message): ${skippedNoUserMsg}`)

  // Curate down to LIMIT, prioritizing connector diversity.
  let finalSet = prepared
  if (LIMIT && LIMIT < prepared.length) {
    finalSet = curateDiverse(prepared, LIMIT)
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}Curated to ${finalSet.length} tickets (--limit=${LIMIT})`)
  }

  const totalMessages = finalSet.reduce((s, p) => s + p.messages.length, 0)
  const uniqueEmails = new Set(finalSet.map((p) => p.email))
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Will touch: ${uniqueEmails.size} unique users, ${finalSet.length} tickets, ${totalMessages} messages`)

  // Distribution summary
  const catDist: Record<string, number> = {}
  const priDist: Record<string, number> = {}
  const statDist: Record<string, number> = {}
  const conDist: Record<string, number> = {}
  for (const p of finalSet) {
    catDist[p.category] = (catDist[p.category] ?? 0) + 1
    priDist[p.priority] = (priDist[p.priority] ?? 0) + 1
    statDist[p.status] = (statDist[p.status] ?? 0) + 1
    conDist[p.connector ?? '(none)'] = (conDist[p.connector ?? '(none)'] ?? 0) + 1
  }
  console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}Category:  ${JSON.stringify(catDist)}`)
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Priority:  ${JSON.stringify(priDist)}`)
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Status:    ${JSON.stringify(statDist)}`)
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Connector: ${JSON.stringify(conDist)}`)
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Date range in source: ${minDate?.toISOString()} → ${maxDate?.toISOString()}`)

  if (DRY_RUN) {
    console.log(`\n[dry-run] Full ticket list:\n`)
    for (const p of finalSet) {
      console.log('─────────────────────────────────────────────')
      console.log(`title:     "${p.title}"`)
      console.log(`user:      ${p.name} <${p.email}>`)
      console.log(`category:  ${p.category}`)
      console.log(`priority:  ${p.priority}`)
      console.log(`status:    ${p.status}`)
      console.log(`connector: ${p.connector ?? '(none)'}`)
      console.log(`messages:  ${p.messages.length} (${p.messages.filter((m) => !m.fromAgent).length} user, ${p.messages.filter((m) => m.fromAgent).length} agent)`)
      console.log(`createdAt: ${p.conversationCreatedAt.toISOString()}`)
    }
    console.log('\n[dry-run] No DB writes performed. Re-run without --dry-run to apply.')
    return
  }

  // ─── Live import ─────────────────────────────────────────────────────────
  const db = new PrismaClient({ log: ['warn', 'error'] })

  try {
    const admin = await db.agent.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } })
    if (!admin) throw new Error(`Admin agent ${ADMIN_EMAIL} not found — run seed first`)

    if (CLEAN_ALL) {
      const before = await db.ticket.count()
      console.log(`\n--clean-all: wiping ALL ${before} tickets, messages, attachments, and EMAIL users…`)
      await db.$transaction([
        db.message.deleteMany({}),
        db.attachment.deleteMany({}),
        db.ticket.deleteMany({}),
      ])
      await db.$executeRaw`
        DELETE FROM "User"
        WHERE source = 'EMAIL'
          AND NOT EXISTS (SELECT 1 FROM "Ticket" WHERE "Ticket"."userId" = "User"."id")
      `
      console.log(`Wipe complete.`)
    } else if (minDate && maxDate) {
      // Idempotency check — wipe only EMAIL tickets in source date range.
      const padded = new Date(maxDate.getTime() + 86_400_000) // +1 day
      const existing = await db.ticket.count({
        where: {
          source: 'EMAIL',
          createdAt: { gte: minDate, lt: padded },
        },
      })
      if (existing > 0) {
        if (!FORCE) {
          console.error(`\nERROR: ${existing} EMAIL-source tickets already exist in the import date range.`)
          console.error(`Re-run with --force to wipe them and re-import, --clean-all to wipe everything, or clear them manually.`)
          process.exit(1)
        }
        console.log(`\n--force: wiping ${existing} existing EMAIL-source tickets in date range…`)
        await db.$transaction([
          db.message.deleteMany({
            where: { ticket: { source: 'EMAIL', createdAt: { gte: minDate, lt: padded } } },
          }),
          db.attachment.deleteMany({
            where: { ticket: { source: 'EMAIL', createdAt: { gte: minDate, lt: padded } } },
          }),
          db.ticket.deleteMany({
            where: { source: 'EMAIL', createdAt: { gte: minDate, lt: padded } },
          }),
        ])
        await db.$executeRaw`
          DELETE FROM "User"
          WHERE source = 'EMAIL'
            AND NOT EXISTS (SELECT 1 FROM "Ticket" WHERE "Ticket"."userId" = "User"."id")
        `
        console.log(`Wipe complete.`)
      }
    }

    console.log(`\nImporting ${finalSet.length} conversations…`)
    let done = 0
    const startedAt = Date.now()

    for (const p of finalSet) {
      await db.$transaction(async (tx) => {
        // Upsert user (preserve original createdAt on insert via raw on create)
        const user = await tx.user.upsert({
          where: { email: p.email },
          update: {},
          create: {
            email: p.email,
            name: p.name,
            source: 'EMAIL',
            isVerified: false,
            createdAt: p.conversationCreatedAt,
          },
        })

        const ticket = await tx.ticket.create({
          data: {
            title: p.title,
            status: p.status,
            priority: p.priority,
            category: p.category,
            connector: p.connector,
            source: 'EMAIL',
            userId: user.id,
            createdAt: p.conversationCreatedAt,
            updatedAt: p.lastMessageAt,
          },
        })

        if (p.messages.length > 0) {
          await tx.message.createMany({
            data: p.messages.map((m) => ({
              ticketId: ticket.id,
              body: m.body,
              bodyRaw: m.body,
              type: 'REPLY' as const,
              isInternal: false,
              sentVia: 'EMAIL' as const,
              authorUserId: m.fromAgent ? null : user.id,
              authorAgentId: m.fromAgent ? admin.id : null,
              createdAt: m.createdAt,
              updatedAt: m.createdAt,
            })),
          })
        }
      }, { timeout: 30_000 })

      done++
      if (done % 50 === 0 || done === finalSet.length) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
        console.log(`  ${done}/${finalSet.length} (${elapsed}s)`)
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`\nDone in ${elapsed}s.`)
    const ticketCount = await db.ticket.count({ where: { source: 'EMAIL' } })
    const messageCount = await db.message.count({ where: { ticket: { source: 'EMAIL' } } })
    const userCount = await db.user.count({ where: { source: 'EMAIL' } })
    console.log(`Now in DB:  ${ticketCount} EMAIL tickets, ${messageCount} messages on them, ${userCount} EMAIL users.`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void Prisma
  console.error(err)
  process.exit(1)
})
