import { PrismaClient } from '@prisma/client'
import * as crypto from 'crypto'

const db = new PrismaClient()

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex')
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err)
      else resolve(`${salt}:${key.toString('hex')}`)
    })
  })
}

async function main() {
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
    },
    update: {},
  })
  console.log(`✅ AppConfig: ${config.appName}`)

  // Admin agent
  const adminPassword = await hashPassword('admin123')
  const admin = await db.agent.upsert({
    where: { email: 'admin@twominutereports.com' },
    create: { email: 'admin@twominutereports.com', name: 'Sarah Kim', password: adminPassword, role: 'ADMIN', isActive: true, inviteAccepted: true },
    update: {},
  })
  console.log(`✅ Admin: ${admin.email}`)

  // Agent
  const agentPassword = await hashPassword('agent123')
  const agent = await db.agent.upsert({
    where: { email: 'agent@twominutereports.com' },
    create: { email: 'agent@twominutereports.com', name: 'Diego Torres', password: agentPassword, role: 'PRIMARY_AGENT', isActive: true, inviteAccepted: true },
    update: {},
  })
  console.log(`✅ Agent: ${agent.email}`)

  // Customer
  const customerPassword = await hashPassword('customer123')
  const customer = await db.user.upsert({
    where: { email: 'jordan@acmecorp.com' },
    create: { email: 'jordan@acmecorp.com', name: 'Jordan Chen', password: customerPassword },
    update: {},
  })
  console.log(`✅ Customer: ${customer.email}`)

  // Sample tickets
  const ticketSeeds = [
    { title: 'GA4 connector failing to sync after May 12 update', category: 'BUG_REPORT' as const, status: 'IN_PROGRESS' as const, priority: 'URGENT' as const, product: 'Google Sheets', connector: 'GA4 — Google Analytics', description: 'After the May 12 deploy our scheduled GA4 → Sheets pull stops mid-way with "rate limit exceeded".', assigneeId: admin.id },
    { title: 'Pinterest Ads connector authentication keeps expiring', category: 'BUG_REPORT' as const, status: 'OPEN' as const, priority: 'HIGH' as const, connector: 'Pinterest Ads', description: 'Every 24 hours the Pinterest Ads connector disconnects and needs re-auth.' },
    { title: 'Add scheduled CSV exports to Google Drive', category: 'FEATURE_REQUEST' as const, status: 'WAITING' as const, priority: 'NORMAL' as const, product: 'Google Sheets', description: 'Would love automatic CSV export to a Google Drive folder.' },
  ]

  for (const seed of ticketSeeds) {
    const existing = await db.ticket.findFirst({ where: { title: seed.title } })
    if (existing) { console.log(`⏭️  Skipping: ${seed.title.slice(0, 50)}`); continue }

    const ticket = await db.$transaction(async (tx) => {
      const t = await tx.ticket.create({
        data: { title: seed.title, category: seed.category, status: seed.status, priority: seed.priority, product: seed.product, connector: seed.connector, userId: customer.id, assigneeId: seed.assigneeId, source: 'PORTAL' },
      })
      await tx.message.create({ data: { ticketId: t.id, body: seed.description, type: 'REPLY', authorUserId: customer.id } })
      if (seed.status !== 'OPEN') {
        await tx.message.create({ data: { ticketId: t.id, body: `Thanks for reaching out! We're looking into this and will follow up shortly.`, type: 'REPLY', authorAgentId: admin.id, sentVia: 'PORTAL_AND_EMAIL' } })
      }
      return t
    })
    console.log(`✅ Ticket TMR-${ticket.number}: ${seed.title.slice(0, 50)}`)
  }

  console.log('\n🎉 Seed complete!\n')
  console.log('Dashboard: admin@twominutereports.com / admin123')
  console.log('Portal:    jordan@acmecorp.com / customer123')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
