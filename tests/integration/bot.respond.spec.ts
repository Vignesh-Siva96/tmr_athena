/**
 * bot.respond.spec — integration tests for the Athena AI first-responder bot.
 *
 * Regression catalogue:
 *   R61 — bot answers confidently → message with authorBotName created, ticket status WAITING
 *   R62 — bot can't answer → ticket escalated to primary agent, SYSTEM_EVENT message created
 *   R63 — bot returns can_answer:true with empty citations → hallucination guard escalates
 *   R64 — bot returns citation URL not in retrieved set → anti-fabrication guard escalates
 *   R65 — bot is disabled → no BotInteraction created, ticket stays OPEN
 *   R72 — bot answer omits the link → "Learn more:" KB link appended deterministically from citations
 *   R73 — model-emitted "Learn more" line is stripped, not duplicated
 */

import { harness } from './harness'
import { makeUser, makeAgent, makeTicket } from './factories'
import './setup'
import { http, HttpResponse } from 'msw'
import { mswServer } from './setup'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockGeminiAnswer(opts: {
  can_answer: boolean
  confidence?: number
  answer?: string
  citations?: string[]
  embeddings?: number[][]
}) {
  mswServer.use(
    // Mock embedding endpoint
    http.post(`${GEMINI_BASE}/text-embedding-004:batchEmbedContents`, () =>
      HttpResponse.json({
        embeddings: (opts.embeddings ?? [[0.1, 0.2, 0.3]]).map((values) => ({ values })),
      }),
    ),
    // Mock chat endpoint (JSON mode)
    http.post(`${GEMINI_BASE}/gemini-2.5-flash-lite:generateContent`, () =>
      HttpResponse.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    answer: opts.answer ?? 'Here is how to set up OAuth.',
                    citations: opts.citations ?? ['https://docs.example.com/help/oauth#step-1'],
                    confidence: opts.confidence ?? 0.9,
                    can_answer: opts.can_answer,
                    reasoning: 'Mocked response for testing.',
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100, totalTokenCount: 300 },
      }),
    ),
  )
}

async function seedKbChunk(sourceUrl: string, deepUrl: string): Promise<void> {
  const source = await harness.prisma.knowledgeSource.upsert({
    where: { url: sourceUrl },
    create: { url: sourceUrl, title: 'Test KB Article', status: 'INDEXED' },
    update: { status: 'INDEXED' },
  })
  // Insert a chunk with a dummy embedding (768-d vector)
  const dummyEmbedding = Array(768).fill(0.1).join(',')
  await harness.prisma.$executeRawUnsafe(
    `INSERT INTO "KnowledgeChunk" (id, "createdAt", "sourceId", ordinal, text, "headingPath", "deepUrl", "tokenCount", embedding)
     VALUES (gen_random_uuid()::text, NOW(), $1, 0, 'OAuth setup guide content here', ARRAY['OAuth']::text[], $2, 50, '[${dummyEmbedding}]'::vector)`,
    source.id,
    deepUrl,
  )
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('BotService (R61–R65)', () => {
  let appConfig: Awaited<ReturnType<typeof harness.prisma.appConfig.findFirst>>

  beforeEach(async () => {
    // Enable bot with a stub API key
    appConfig = await harness.prisma.appConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        botEnabled: true,
        botApiKeyEnc: 'test-api-key',
        kbRootUrl: 'https://docs.example.com/help/',
        botRetrievalThreshold: 0.0,  // disable retrieval gate so we test LLM gates
        botConfidenceThreshold: 0.7,
      },
      update: {
        botEnabled: true,
        botApiKeyEnc: 'test-api-key',
        kbRootUrl: 'https://docs.example.com/help/',
        botRetrievalThreshold: 0.0,
        botConfidenceThreshold: 0.7,
      },
    })
  })

  it('R61 — confident answer: creates bot message, ticket moves to WAITING', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.message.create({
      data: { ticketId: ticket.id, body: 'How do I set up Google OAuth?', authorUserId: user.id, type: 'REPLY' },
    })

    const kbUrl = 'https://docs.example.com/help/oauth'
    await seedKbChunk(kbUrl, `${kbUrl}#step-1`)

    mockGeminiAnswer({
      can_answer: true,
      confidence: 0.92,
      citations: [`${kbUrl}#step-1`],
    })

    const botService = harness.app.get('BotService')
    await botService.respondTo(ticket.id)

    // Bot message was created
    const messages = await harness.prisma.message.findMany({ where: { ticketId: ticket.id } })
    const botMsg = messages.find((m) => m.authorBotName !== null)
    expect(botMsg).toBeDefined()
    expect(botMsg!.authorBotName).toBe('Athena')
    expect(botMsg!.type).toBe('REPLY')

    // Ticket status moved to WAITING
    const updatedTicket = await harness.prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(updatedTicket!.status).toBe('WAITING')

    // BotInteraction audit row written
    const interaction = await harness.prisma.botInteraction.findFirst({ where: { ticketId: ticket.id } })
    expect(interaction).toBeDefined()
    expect(interaction!.didAnswer).toBe(true)
    expect(interaction!.citations.length).toBeGreaterThan(0)
  })

  it('R72 — answer with no link → "Learn more:" KB link appended deterministically', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.message.create({
      data: { ticketId: ticket.id, body: 'How do I set up Google OAuth?', authorUserId: user.id, type: 'REPLY' },
    })

    const kbUrl = 'https://docs.example.com/help/oauth'
    const deepUrl = `${kbUrl}#step-1`
    await seedKbChunk(kbUrl, deepUrl)

    // flash-lite behaviour: answer prose carries NO link, but citations is populated.
    mockGeminiAnswer({
      can_answer: true,
      confidence: 0.92,
      answer: 'Open Settings → Connections and authorise your Google account.',
      citations: [deepUrl],
    })

    const botService = harness.app.get('BotService')
    await botService.respondTo(ticket.id)

    const botMsg = (await harness.prisma.message.findMany({ where: { ticketId: ticket.id } }))
      .find((m) => m.authorBotName !== null)
    expect(botMsg).toBeDefined()

    // Link is appended from the seeded chunk's headingPath (['OAuth']) → deepUrl.
    expect(botMsg!.body).toContain('Learn more: [OAuth]')
    expect(botMsg!.body).toContain(deepUrl)
    // Only one link line, and the model's prose is preserved.
    expect(botMsg!.body).toContain('Open Settings → Connections')
    expect((botMsg!.body!.match(/Learn more:/gi) ?? []).length).toBe(1)
    // Rendered HTML carries an anchor tag to the article.
    expect(botMsg!.bodyHtml).toContain(`<a href="${deepUrl}"`)
  })

  it('R73 — model-emitted "Learn more" line is stripped, not duplicated', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.message.create({
      data: { ticketId: ticket.id, body: 'OAuth setup?', authorUserId: user.id, type: 'REPLY' },
    })

    const kbUrl = 'https://docs.example.com/help/oauth'
    const deepUrl = `${kbUrl}#step-1`
    await seedKbChunk(kbUrl, deepUrl)

    // Model still typed its own (stale) Learn more line despite the prompt.
    mockGeminiAnswer({
      can_answer: true,
      confidence: 0.9,
      answer: `Authorise via Settings.\nLearn more: [old label](${deepUrl})`,
      citations: [deepUrl],
    })

    const botService = harness.app.get('BotService')
    await botService.respondTo(ticket.id)

    const botMsg = (await harness.prisma.message.findMany({ where: { ticketId: ticket.id } }))
      .find((m) => m.authorBotName !== null)
    expect(botMsg).toBeDefined()
    // Exactly one Learn more line, using the deterministic heading label.
    expect((botMsg!.body!.match(/Learn more:/gi) ?? []).length).toBe(1)
    expect(botMsg!.body).toContain('Learn more: [OAuth]')
    expect(botMsg!.body).not.toContain('old label')
  })

  it('R62 — can_answer:false → escalates to primary agent, creates SYSTEM_EVENT', async () => {
    const user = await makeUser()
    const agent = await makeAgent({ role: 'PRIMARY_AGENT' })
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.message.create({
      data: { ticketId: ticket.id, body: 'Something completely off-topic', authorUserId: user.id, type: 'REPLY' },
    })

    // Create a shift so the resolver can find an agent
    await harness.prisma.shift.create({
      data: { primaryAgentId: agent.id, dayOfWeek: -1, startMinute: 0, endMinute: 0 },
    })

    const kbUrl = 'https://docs.example.com/help/oauth'
    await seedKbChunk(kbUrl, `${kbUrl}#step-1`)

    mockGeminiAnswer({ can_answer: false, confidence: 0.2, citations: [] })

    const botService = harness.app.get('BotService')
    await botService.respondTo(ticket.id)

    // No bot message created
    const messages = await harness.prisma.message.findMany({ where: { ticketId: ticket.id } })
    expect(messages.find((m) => m.authorBotName !== null)).toBeUndefined()

    // Ticket has a SYSTEM_EVENT
    const sysEvent = messages.find((m) => m.type === 'SYSTEM_EVENT')
    expect(sysEvent).toBeDefined()
    expect(sysEvent!.body).toContain('Athena')

    // BotInteraction recorded escalation
    const interaction = await harness.prisma.botInteraction.findFirst({ where: { ticketId: ticket.id } })
    expect(interaction!.didAnswer).toBe(false)
  })

  it('R63 — can_answer:true with empty citations → hallucination guard escalates', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.message.create({
      data: { ticketId: ticket.id, body: 'Tell me about billing', authorUserId: user.id, type: 'REPLY' },
    })

    const kbUrl = 'https://docs.example.com/help/oauth'
    await seedKbChunk(kbUrl, `${kbUrl}#step-1`)

    // can_answer:true but empty citations — hallucination guard should catch this
    mockGeminiAnswer({ can_answer: true, confidence: 0.95, citations: [] })

    const botService = harness.app.get('BotService')
    await botService.respondTo(ticket.id)

    // No bot message created — escalated instead
    const messages = await harness.prisma.message.findMany({ where: { ticketId: ticket.id } })
    expect(messages.find((m) => m.authorBotName !== null)).toBeUndefined()

    const interaction = await harness.prisma.botInteraction.findFirst({ where: { ticketId: ticket.id } })
    expect(interaction!.didAnswer).toBe(false)
  })

  it('R64 — citation URL not same-origin as kbRootUrl → anti-fabrication guard escalates', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.message.create({
      data: { ticketId: ticket.id, body: 'Help!', authorUserId: user.id, type: 'REPLY' },
    })

    const kbUrl = 'https://docs.example.com/help/oauth'
    await seedKbChunk(kbUrl, `${kbUrl}#step-1`)

    // Citation from a different origin — should trigger anti-fabrication guard
    mockGeminiAnswer({
      can_answer: true,
      confidence: 0.9,
      citations: ['https://competitor.com/their-docs'],
    })

    const botService = harness.app.get('BotService')
    await botService.respondTo(ticket.id)

    // No bot message created
    const messages = await harness.prisma.message.findMany({ where: { ticketId: ticket.id } })
    expect(messages.find((m) => m.authorBotName !== null)).toBeUndefined()

    const interaction = await harness.prisma.botInteraction.findFirst({ where: { ticketId: ticket.id } })
    expect(interaction!.didAnswer).toBe(false)
  })

  it('R65 — bot disabled → no BotInteraction created', async () => {
    await harness.prisma.appConfig.updateMany({ data: { botEnabled: false } })

    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })

    const botService = harness.app.get('BotService')
    await botService.respondTo(ticket.id)

    const interaction = await harness.prisma.botInteraction.findFirst({ where: { ticketId: ticket.id } })
    expect(interaction).toBeNull()
  })

  it('idempotency — duplicate job runs are no-ops', async () => {
    const user = await makeUser()
    const ticket = await makeTicket({ userId: user.id })
    await harness.prisma.message.create({
      data: { ticketId: ticket.id, body: 'OAuth question', authorUserId: user.id, type: 'REPLY' },
    })

    const kbUrl = 'https://docs.example.com/help/oauth'
    await seedKbChunk(kbUrl, `${kbUrl}#step-1`)

    mockGeminiAnswer({ can_answer: true, confidence: 0.9, citations: [`${kbUrl}#step-1`] })

    const botService = harness.app.get('BotService')
    await botService.respondTo(ticket.id)
    await botService.respondTo(ticket.id)  // second call should be a no-op

    // Still only one BotInteraction row
    const interactions = await harness.prisma.botInteraction.findMany({ where: { ticketId: ticket.id } })
    expect(interactions).toHaveLength(1)

    // Still only one bot reply message
    const messages = await harness.prisma.message.findMany({
      where: { ticketId: ticket.id, authorBotName: { not: null } },
    })
    expect(messages).toHaveLength(1)
  })
})
