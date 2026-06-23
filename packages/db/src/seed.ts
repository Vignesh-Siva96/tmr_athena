import { PrismaClient } from '@prisma/client'
import * as crypto from 'crypto'

const db = new PrismaClient()

const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function generateRef(): string {
  const bytes = crypto.randomBytes(7)
  let ref = ''
  for (let i = 0; i < 7; i++) ref += REF_ALPHABET[bytes[i]! % 32]
  return ref
}

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex')
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err)
      else resolve(`${salt}:${key.toString('hex')}`)
    })
  })
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function hoursAfter(date: Date, h: number): Date {
  return new Date(date.getTime() + h * 60 * 60 * 1000)
}

async function main() {
  // Guard: this seed inserts demo agents/customers/tickets (and a weak `admin123` login).
  // It is a dev/test fixture only — never run it against production. Create the production
  // admin manually via SQL instead (see DEPLOY.md → "Create the first admin").
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error(
      '✋ Refusing to seed: NODE_ENV=production. This script injects demo data and a weak admin login.\n' +
        '   Create the production admin via the SQL recipe in DEPLOY.md.\n' +
        '   To override (NOT recommended), re-run with --force.',
    )
    process.exit(1)
  }

  console.log('🌱 Seeding database…')

  // App config (single row)
  const existingConfig = await db.appConfig.findFirst()
  const config = await db.appConfig.upsert({
    where: { id: existingConfig?.id ?? 'seed' },
    create: {
      appName: 'Two Minute Reports',
      portalTagline: 'Support that actually works.',
      primaryColor: '#2563EB',
      accentColor: '#0EA5E9',
      emailDisplayName: 'TMR Support',
      field1Label: 'Product',
      field1Options: [
        { value: 'google-sheets', label: 'Google Sheets' },
        { value: 'google-data-studio', label: 'Google Data Studio' },
        { value: 'excel', label: 'Microsoft Excel' },
        { value: 'power-bi', label: 'Power BI' },
      ],
      field2Label: 'Connector',
      field2Options: [
        { value: 'ga4', label: 'GA4 — Google Analytics' },
        { value: 'facebook-ads', label: 'Facebook Ads' },
        { value: 'google-ads', label: 'Google Ads' },
        { value: 'pinterest-ads', label: 'Pinterest Ads' },
        { value: 'shopify', label: 'Shopify' },
        { value: 'hubspot', label: 'HubSpot' },
      ],
    },
    update: {},
  })
  console.log(`✅ AppConfig: ${config.appName}`)

  // Agents
  const adminPassword = await hashPassword('admin123')
  const admin = await db.agent.upsert({
    where: { email: 'admin@twominutereports.com' },
    create: { email: 'admin@twominutereports.com', name: 'Sarah Kim', password: adminPassword, role: 'ADMIN', isActive: true, inviteAccepted: true },
    update: {},
  })
  console.log(`✅ Admin: ${admin.email}`)

  const agentPassword = await hashPassword('agent123')
  const agentUser = await db.agent.upsert({
    where: { email: 'agent@twominutereports.com' },
    create: { email: 'agent@twominutereports.com', name: 'Diego Torres', password: agentPassword, role: 'PRIMARY_AGENT', isActive: true, inviteAccepted: true },
    update: {},
  })
  console.log(`✅ Agent: ${agentUser.email}`)

  // Customers
  const customerPwd = await hashPassword('customer123')
  const jordan = await db.user.upsert({ where: { email: 'jordan@acmecorp.com' }, create: { email: 'jordan@acmecorp.com', name: 'Jordan Chen', password: customerPwd }, update: {} })
  const alex   = await db.user.upsert({ where: { email: 'alex@startup.io'     }, create: { email: 'alex@startup.io',     name: 'Alex Rivera',  password: customerPwd }, update: {} })
  const mary   = await db.user.upsert({ where: { email: 'mary@enterprise.com' }, create: { email: 'mary@enterprise.com', name: 'Mary Zhao',    password: customerPwd }, update: {} })
  const tom    = await db.user.upsert({ where: { email: 'tom@smb.co'          }, create: { email: 'tom@smb.co',          name: 'Tom Adeyemi',  password: customerPwd }, update: {} })
  const lisa   = await db.user.upsert({ where: { email: 'lisa@tech.io'        }, create: { email: 'lisa@tech.io',        name: 'Lisa Park',    password: customerPwd }, update: {} })
  console.log('✅ Customers seeded')

  // ── Original 3 tickets ──────────────────────────────────────────────────────
  const ticketSeeds = [
    { title: 'GA4 connector failing to sync after May 12 update', category: 'BUG_REPORT' as const, status: 'IN_PROGRESS' as const, priority: 'URGENT' as const, field1: 'google-sheets', field2: 'ga4', description: 'After the May 12 deploy our scheduled GA4 → Sheets pull stops mid-way with "rate limit exceeded".', assigneeId: admin.id },
    { title: 'Pinterest Ads connector authentication keeps expiring', category: 'BUG_REPORT' as const, status: 'OPEN' as const, priority: 'HIGH' as const, field2: 'pinterest-ads', description: 'Every 24 hours the Pinterest Ads connector disconnects and needs re-auth.' },
    { title: 'Add scheduled CSV exports to Google Drive', category: 'FEATURE_REQUEST' as const, status: 'WAITING' as const, priority: 'NORMAL' as const, field1: 'google-sheets', description: 'Would love automatic CSV export to a Google Drive folder.' },
  ]

  for (const seed of ticketSeeds) {
    const existing = await db.ticket.findFirst({ where: { title: seed.title } })
    if (existing) { console.log(`⏭️  Skipping: ${seed.title.slice(0, 50)}`); continue }

    const ticket = await db.$transaction(async (tx) => {
      const t = await tx.ticket.create({
        data: { ref: generateRef(), isTicket: true, title: seed.title, category: seed.category, status: seed.status, priority: seed.priority, field1: seed.field1, field2: seed.field2, userId: jordan.id, assigneeId: seed.assigneeId, source: 'PORTAL' },
      })
      await tx.message.create({ data: { ticketId: t.id, body: seed.description, type: 'REPLY', authorUserId: jordan.id } })
      if (seed.status !== 'OPEN') {
        await tx.message.create({ data: { ticketId: t.id, body: `Thanks for reaching out! We're looking into this and will follow up shortly.`, type: 'REPLY', authorAgentId: admin.id, sentVia: 'PORTAL_AND_EMAIL' } })
      }
      return t
    })
    console.log(`✅ Ticket TMR-${ticket.ref}: ${seed.title.slice(0, 50)}`)
  }

  // ── Bulk analytics seed (50+ tickets over 30 days) ──────────────────────────
  type BulkSeed = {
    title: string
    category: 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'
    status: 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED' | 'DISMISSED'
    priority?: 'NORMAL' | 'HIGH' | 'URGENT'
    field1?: string
    field2?: string
    daysAgoCreated: number
    isTicket?: boolean           // false = email conversation not yet a ticket
    userId: string
    assigneeId?: string
    frtHours?: number            // hours from creation to first agent reply
    resolvedInHours?: number     // hours from creation to firstResolvedAt
    reopenCount?: number
    dismissed?: boolean          // sets dismissedAt + dismissedById
    botDidAnswer?: boolean       // if defined, creates a BotInteraction row
  }

  const bulk: BulkSeed[] = [
    // ── Resolved bugs ──────────────────────────────────────────────────────
    { title: 'Facebook Ads impressions showing incorrect totals', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'HIGH', field1: 'google-sheets', field2: 'facebook-ads', daysAgoCreated: 28, userId: jordan.id, assigneeId: admin.id, frtHours: 2, resolvedInHours: 36 },
    { title: 'Google Ads cost metrics off by factor of 10', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'HIGH', field1: 'google-data-studio', field2: 'google-ads', daysAgoCreated: 26, userId: alex.id, assigneeId: agentUser.id, frtHours: 3, resolvedInHours: 24 },
    { title: 'Shopify revenue not matching Shopify admin panel', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'HIGH', field1: 'excel', field2: 'shopify', daysAgoCreated: 25, userId: mary.id, assigneeId: admin.id, frtHours: 1.5, resolvedInHours: 48 },
    { title: 'HubSpot CRM contacts count delayed by 48 hours', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'NORMAL', field1: 'google-sheets', field2: 'hubspot', daysAgoCreated: 23, userId: tom.id, assigneeId: agentUser.id, frtHours: 5, resolvedInHours: 18 },
    { title: 'Power BI connector returns empty dataset on refresh', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'URGENT', field1: 'power-bi', field2: 'ga4', daysAgoCreated: 22, userId: lisa.id, assigneeId: admin.id, frtHours: 0.5, resolvedInHours: 12, reopenCount: 1 },
    { title: 'Excel export corrupts UTF-8 characters in report names', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'NORMAL', field1: 'excel', daysAgoCreated: 21, userId: jordan.id, assigneeId: agentUser.id, frtHours: 8, resolvedInHours: 72 },
    { title: 'GA4 sessions metric doubled after property migration', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'HIGH', field1: 'google-sheets', field2: 'ga4', daysAgoCreated: 20, userId: alex.id, assigneeId: admin.id, frtHours: 2, resolvedInHours: 30 },
    { title: 'Pinterest Ads ROAS calculation off when currency is EUR', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'NORMAL', field2: 'pinterest-ads', daysAgoCreated: 19, userId: mary.id, assigneeId: agentUser.id, frtHours: 6, resolvedInHours: 42 },
    { title: 'Scheduled report not firing on Monday mornings', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'HIGH', field1: 'google-sheets', daysAgoCreated: 17, userId: tom.id, assigneeId: admin.id, frtHours: 3, resolvedInHours: 20, reopenCount: 1 },
    { title: 'Facebook Ads connector stalls on accounts with 50+ campaigns', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'NORMAL', field2: 'facebook-ads', daysAgoCreated: 15, userId: lisa.id, assigneeId: agentUser.id, frtHours: 4, resolvedInHours: 28, botDidAnswer: false },
    { title: 'Google Data Studio chart shows null for last day of month', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'NORMAL', field1: 'google-data-studio', field2: 'google-ads', daysAgoCreated: 14, userId: jordan.id, assigneeId: admin.id, frtHours: 3.5, resolvedInHours: 22 },
    { title: 'Connector token refresh failing silently overnight', category: 'BUG_REPORT', status: 'RESOLVED', priority: 'URGENT', field2: 'ga4', daysAgoCreated: 12, userId: alex.id, assigneeId: admin.id, frtHours: 1, resolvedInHours: 8, botDidAnswer: false },
    // ── Resolved feature requests ──────────────────────────────────────────
    { title: 'Add date range picker to scheduled reports', category: 'FEATURE_REQUEST', status: 'RESOLVED', priority: 'NORMAL', field1: 'google-sheets', daysAgoCreated: 27, userId: mary.id, assigneeId: agentUser.id, frtHours: 12, resolvedInHours: 96 },
    { title: 'Support for multiple Google accounts per workspace', category: 'FEATURE_REQUEST', status: 'RESOLVED', priority: 'NORMAL', daysAgoCreated: 24, userId: tom.id, assigneeId: admin.id, frtHours: 10, resolvedInHours: 120 },
    { title: 'Allow custom column ordering in Google Sheets output', category: 'FEATURE_REQUEST', status: 'RESOLVED', priority: 'NORMAL', field1: 'google-sheets', daysAgoCreated: 18, userId: lisa.id, assigneeId: agentUser.id, frtHours: 7, resolvedInHours: 48 },
    { title: 'Webhook notifications when a report fails to run', category: 'FEATURE_REQUEST', status: 'RESOLVED', priority: 'NORMAL', daysAgoCreated: 16, userId: jordan.id, assigneeId: admin.id, frtHours: 9, resolvedInHours: 60 },
    // ── Resolved questions ─────────────────────────────────────────────────
    { title: 'How do I share a report with a client who has no TMR account?', category: 'QUESTION', status: 'RESOLVED', priority: 'NORMAL', daysAgoCreated: 29, userId: alex.id, assigneeId: agentUser.id, frtHours: 4, resolvedInHours: 6, botDidAnswer: true },
    { title: 'What is the difference between sessions and users in GA4 connector?', category: 'QUESTION', status: 'RESOLVED', priority: 'NORMAL', field2: 'ga4', daysAgoCreated: 22, userId: mary.id, assigneeId: agentUser.id, frtHours: 2, resolvedInHours: 4, botDidAnswer: true },
    { title: 'Can I filter by product category in the Shopify connector?', category: 'QUESTION', status: 'RESOLVED', priority: 'NORMAL', field2: 'shopify', daysAgoCreated: 18, userId: tom.id, assigneeId: admin.id, frtHours: 3, resolvedInHours: 5, botDidAnswer: true },
    { title: 'How do I set up automated weekly email reports?', category: 'QUESTION', status: 'RESOLVED', priority: 'NORMAL', field1: 'google-sheets', daysAgoCreated: 13, userId: lisa.id, assigneeId: agentUser.id, frtHours: 1.5, resolvedInHours: 3, botDidAnswer: true },
    // ── Resolved billing ───────────────────────────────────────────────────
    { title: 'Invoice shows wrong plan tier — should be Business not Starter', category: 'BILLING', status: 'RESOLVED', priority: 'HIGH', daysAgoCreated: 26, userId: jordan.id, assigneeId: admin.id, frtHours: 5, resolvedInHours: 24 },
    { title: 'Charge appeared twice for March renewal', category: 'BILLING', status: 'RESOLVED', priority: 'URGENT', daysAgoCreated: 20, userId: alex.id, assigneeId: admin.id, frtHours: 1, resolvedInHours: 6 },
    { title: 'Need VAT invoice for February 2025', category: 'BILLING', status: 'RESOLVED', priority: 'NORMAL', daysAgoCreated: 14, userId: mary.id, assigneeId: agentUser.id, frtHours: 8, resolvedInHours: 18 },
    // ── Closed tickets ─────────────────────────────────────────────────────
    { title: 'HubSpot pipeline stage values mapping incorrectly', category: 'BUG_REPORT', status: 'CLOSED', priority: 'HIGH', field2: 'hubspot', daysAgoCreated: 30, userId: tom.id, assigneeId: admin.id, frtHours: 2, resolvedInHours: 20 },
    { title: 'Google Ads keyword report missing search term column', category: 'BUG_REPORT', status: 'CLOSED', priority: 'NORMAL', field2: 'google-ads', daysAgoCreated: 29, userId: lisa.id, assigneeId: agentUser.id, frtHours: 6, resolvedInHours: 48 },
    { title: 'Shopify orders report skips draft orders', category: 'BUG_REPORT', status: 'CLOSED', priority: 'NORMAL', field2: 'shopify', daysAgoCreated: 27, userId: jordan.id, assigneeId: admin.id, frtHours: 3, resolvedInHours: 30 },
    { title: 'Add support for Power BI paginated reports export', category: 'FEATURE_REQUEST', status: 'CLOSED', priority: 'NORMAL', field1: 'power-bi', daysAgoCreated: 25, userId: alex.id, assigneeId: agentUser.id, frtHours: 12, resolvedInHours: 144 },
    { title: 'Which connectors support historical data backfill?', category: 'QUESTION', status: 'CLOSED', priority: 'NORMAL', daysAgoCreated: 23, userId: mary.id, assigneeId: agentUser.id, frtHours: 3, resolvedInHours: 5, botDidAnswer: true },
    { title: 'Downgrade from Business to Starter plan mid-cycle', category: 'BILLING', status: 'CLOSED', priority: 'NORMAL', daysAgoCreated: 21, userId: tom.id, assigneeId: admin.id, frtHours: 6, resolvedInHours: 12 },
    { title: 'Facebook Ads video view metrics missing from report', category: 'BUG_REPORT', status: 'CLOSED', priority: 'NORMAL', field2: 'facebook-ads', daysAgoCreated: 19, userId: lisa.id, assigneeId: agentUser.id, frtHours: 4, resolvedInHours: 36 },
    { title: 'GA4 ecommerce revenue not matching GA4 admin panel', category: 'BUG_REPORT', status: 'CLOSED', priority: 'HIGH', field2: 'ga4', daysAgoCreated: 16, userId: jordan.id, assigneeId: admin.id, frtHours: 2, resolvedInHours: 18, reopenCount: 1 },
    { title: 'Support SSOT data blending across multiple connectors', category: 'FEATURE_REQUEST', status: 'CLOSED', priority: 'NORMAL', daysAgoCreated: 10, userId: alex.id, assigneeId: agentUser.id, frtHours: 24, resolvedInHours: 240 },
    // ── Open tickets ───────────────────────────────────────────────────────
    { title: 'Google Sheets formula columns get overwritten on refresh', category: 'BUG_REPORT', status: 'OPEN', priority: 'HIGH', field1: 'google-sheets', daysAgoCreated: 6, userId: mary.id, assigneeId: agentUser.id, frtHours: 3 },
    { title: 'Shopify refunds not deducted from revenue totals', category: 'BUG_REPORT', status: 'OPEN', priority: 'NORMAL', field2: 'shopify', daysAgoCreated: 5, userId: tom.id, frtHours: 8 },
    { title: 'Pinterest Ads reach metric unavailable in report builder', category: 'BUG_REPORT', status: 'OPEN', priority: 'NORMAL', field2: 'pinterest-ads', daysAgoCreated: 4, userId: lisa.id },
    { title: 'Can I split revenue by sales channel in Shopify reports?', category: 'QUESTION', status: 'OPEN', priority: 'NORMAL', field2: 'shopify', daysAgoCreated: 3, userId: jordan.id, frtHours: 5, botDidAnswer: false },
    { title: 'HubSpot deal amounts not converting to account currency', category: 'BUG_REPORT', status: 'OPEN', priority: 'HIGH', field2: 'hubspot', daysAgoCreated: 2, userId: alex.id, assigneeId: admin.id, frtHours: 2 },
    { title: 'Request: add Klaviyo email connector', category: 'FEATURE_REQUEST', status: 'OPEN', priority: 'NORMAL', daysAgoCreated: 2, userId: mary.id },
    { title: 'Upgrade billing plan to Business tier', category: 'BILLING', status: 'OPEN', priority: 'NORMAL', daysAgoCreated: 1, userId: tom.id, assigneeId: admin.id, frtHours: 4 },
    { title: 'Power BI embed URL not loading behind corporate proxy', category: 'BUG_REPORT', status: 'OPEN', priority: 'URGENT', field1: 'power-bi', daysAgoCreated: 1, userId: lisa.id, assigneeId: admin.id, frtHours: 1 },
    // ── In-progress ────────────────────────────────────────────────────────
    { title: 'GA4 custom dimensions not appearing in dimension picker', category: 'BUG_REPORT', status: 'IN_PROGRESS', priority: 'HIGH', field2: 'ga4', daysAgoCreated: 8, userId: jordan.id, assigneeId: admin.id, frtHours: 2 },
    { title: 'Google Ads MCC sub-account data missing from roll-up report', category: 'BUG_REPORT', status: 'IN_PROGRESS', priority: 'URGENT', field2: 'google-ads', daysAgoCreated: 5, userId: alex.id, assigneeId: admin.id, frtHours: 1 },
    { title: 'Excel add-in crashes on Windows 10 with Office 2019', category: 'BUG_REPORT', status: 'IN_PROGRESS', priority: 'HIGH', field1: 'excel', daysAgoCreated: 3, userId: mary.id, assigneeId: agentUser.id, frtHours: 5 },
    { title: 'Implement dark mode for embedded report viewer', category: 'FEATURE_REQUEST', status: 'IN_PROGRESS', priority: 'NORMAL', daysAgoCreated: 10, userId: tom.id, assigneeId: agentUser.id, frtHours: 18 },
    // ── Waiting ────────────────────────────────────────────────────────────
    { title: 'Facebook Ads reach vs. impressions discrepancy — awaiting Meta', category: 'BUG_REPORT', status: 'WAITING', priority: 'NORMAL', field2: 'facebook-ads', daysAgoCreated: 7, userId: lisa.id, assigneeId: agentUser.id, frtHours: 3 },
    { title: 'Enterprise SSO setup — waiting for customer IT team', category: 'OTHER', status: 'WAITING', priority: 'HIGH', daysAgoCreated: 5, userId: jordan.id, assigneeId: admin.id, frtHours: 2 },
    { title: 'Billing dispute — awaiting bank confirmation', category: 'BILLING', status: 'WAITING', priority: 'NORMAL', daysAgoCreated: 3, userId: alex.id, assigneeId: admin.id, frtHours: 6 },
    // ── Dismissed email conversations ──────────────────────────────────────
    { title: 'Out of office auto-reply from customer', category: 'OTHER', status: 'DISMISSED', priority: 'NORMAL', daysAgoCreated: 10, isTicket: false, userId: mary.id, dismissed: true },
    { title: 'Unsubscribe from mailing list request', category: 'OTHER', status: 'DISMISSED', priority: 'NORMAL', daysAgoCreated: 8, isTicket: false, userId: tom.id, dismissed: true },
    { title: 'Test email sent from Postman by developer', category: 'OTHER', status: 'DISMISSED', priority: 'NORMAL', daysAgoCreated: 5, isTicket: false, userId: lisa.id, dismissed: true },
    // ── Triage backlog (NEW email conversations, not yet triaged) ──────────
    { title: 'Inbound: GA4 report template request', category: 'QUESTION', status: 'NEW', priority: 'NORMAL', field2: 'ga4', daysAgoCreated: 2, isTicket: false, userId: jordan.id },
    { title: 'Inbound: question about connector limits on Starter plan', category: 'QUESTION', status: 'NEW', priority: 'NORMAL', daysAgoCreated: 1, isTicket: false, userId: alex.id },
    { title: 'Inbound: GDPR data deletion request', category: 'OTHER', status: 'NEW', priority: 'HIGH', daysAgoCreated: 1, isTicket: false, userId: mary.id },
    { title: 'Inbound: referral partner inquiry', category: 'OTHER', status: 'NEW', priority: 'NORMAL', daysAgoCreated: 0, isTicket: false, userId: tom.id },
    { title: 'Inbound: cannot login to portal after password reset', category: 'BUG_REPORT', status: 'NEW', priority: 'HIGH', daysAgoCreated: 0, isTicket: false, userId: lisa.id },
  ]

  for (const seed of bulk) {
    const existing = await db.ticket.findFirst({ where: { title: seed.title } })
    if (existing) { console.log(`⏭️  Skipping: ${seed.title.slice(0, 50)}`); continue }

    const createdAt = daysAgo(seed.daysAgoCreated)
    const isRealTicket = seed.isTicket !== false
    const isResolved = seed.status === 'RESOLVED' || seed.status === 'CLOSED'
    const firstResolvedAt = isResolved && seed.resolvedInHours
      ? hoursAfter(createdAt, seed.resolvedInHours)
      : undefined

    const ticket = await db.$transaction(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          ref: generateRef(),
          isTicket: isRealTicket,
          title: seed.title,
          category: seed.category,
          status: seed.status,
          priority: seed.priority ?? 'NORMAL',
          field1: seed.field1,
          field2: seed.field2,
          userId: seed.userId,
          assigneeId: seed.assigneeId,
          source: 'EMAIL',
          createdAt,
          reopenCount: seed.reopenCount ?? 0,
          reopenedAt: seed.reopenCount ? hoursAfter(createdAt, (seed.resolvedInHours ?? 20) + 5) : undefined,
          firstResolvedAt,
          dismissedAt: seed.dismissed ? hoursAfter(createdAt, 2) : undefined,
          dismissedById: seed.dismissed ? admin.id : undefined,
          convertedAt: isRealTicket && seed.status !== 'NEW' && seed.status !== 'DISMISSED'
            ? hoursAfter(createdAt, 0.5)
            : undefined,
        },
      })

      // Customer opening message
      await tx.message.create({
        data: { ticketId: t.id, body: `Customer inquiry: ${seed.title}`, type: 'REPLY', authorUserId: seed.userId, createdAt },
      })

      // First agent reply (makes FRT metrics populate)
      if (seed.frtHours && seed.assigneeId) {
        await tx.message.create({
          data: {
            ticketId: t.id,
            body: 'Thanks for reaching out! We are looking into this and will update you shortly.',
            type: 'REPLY',
            authorAgentId: seed.assigneeId,
            sentVia: 'PORTAL_AND_EMAIL',
            createdAt: hoursAfter(createdAt, seed.frtHours),
          },
        })
      }

      return t
    })

    // BotInteraction for selected tickets
    if (seed.botDidAnswer !== undefined) {
      await db.botInteraction.create({
        data: {
          ticketId: ticket.id,
          userId: seed.userId,
          retrievedChunkIds: seed.botDidAnswer ? ['chunk-1', 'chunk-2'] : [],
          retrievalTopScore: seed.botDidAnswer ? 0.87 : 0.31,
          llmConfidence: seed.botDidAnswer ? 0.82 : 0.28,
          didAnswer: seed.botDidAnswer,
          escalatedToAgentId: seed.botDidAnswer ? undefined : (seed.assigneeId ?? admin.id),
          reasoning: seed.botDidAnswer ? 'Found relevant KB article.' : 'Low confidence — escalating to agent.',
          citations: seed.botDidAnswer ? ['https://help.example.com/article/1'] : [],
          latencyMs: seed.botDidAnswer ? 1240 : 890,
          costUsd: 0.0008,
          totalTokens: 640,
          promptTokens: 520,
          completionTokens: 120,
          createdAt: hoursAfter(createdAt, 0.1),
        },
      })
    }

    console.log(`✅ Ticket TMR-${ticket.ref}: ${seed.title.slice(0, 50)}`)
  }

  console.log('\n🎉 Seed complete!\n')
  console.log('Dashboard: admin@twominutereports.com / admin123')
  console.log('Portal:    jordan@acmecorp.com / customer123')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
