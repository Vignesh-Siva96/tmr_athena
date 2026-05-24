---
title: AI (Gemini)
stack: [Google Generative AI SDK, pg-boss, Prisma AiUsage model]
status: working
last-reviewed: 2026-05-24
---

# AI Module

## What it does

Background AI analysis on support tickets and messages using **Gemini 2.0 Flash**. Two combined Gemini calls extract all signals in one shot per trigger event:

| Call | Method | Trigger | Output |
|---|---|---|---|
| **analyzeMessage** | `GeminiService.analyzeMessage()` | New customer `REPLY` | `Message.sentimentScore/label` + optional `CustomerSignal` rows (CHURN_RISK or ADVOCACY) |
| **classifyAndScoreTicket** | `GeminiService.classifyAndScoreTicket()` | Ticket reaches `RESOLVED` | `Ticket.topicId` (upserts `Topic`) + `TicketRating.aiRating/aiReasoning/aiEffortScore/aiSummary` |

Every Gemini call writes one `AiUsage` row (model, operation, token counts, computed cost, duration, status, optional ticketId/messageId). Failed calls also write a row with `status = ERROR`.

### Churn-risk active workflow

When `analyzeMessage` detects a churn signal:
1. Inserts `CustomerSignal(type=CHURN_RISK)` with quote + reason
2. Creates `Notification(type=CHURN_RISK_DETECTED)` for the ticket
3. If `Ticket.priority === 'NORMAL'` → bumps to `'HIGH'`
4. Emits a `SYSTEM_EVENT` message on the ticket thread ("Priority raised to HIGH — churn risk detected")

Advocacy signals are passive — insert `CustomerSignal(type=ADVOCACY)` only. No notification or priority change.

## Stack

| Component | What |
|---|---|
| `@google/generative-ai` | Google Generative AI SDK (Gemini) |
| `gemini-2.0-flash` | Model — fast + cheap for classification |
| `pg-boss` queues | Three async queues: `ai:analyze-message`, `ai:classify-ticket`, `ai:request-csat` |
| `AiUsage` model | Per-call cost + token tracking for the `/settings/ai-usage` page |

## Pricing constants (Flash 2.0)

```
input:  $0.075 / 1M tokens
output: $0.30  / 1M tokens
```

Stored in `gemini.service.ts` → `PRICES` constant. Update there if Google changes pricing.

## Key files

| File | Role |
|---|---|
| [`apps/api/src/modules/ai/ai.module.ts`](../../apps/api/src/modules/ai/ai.module.ts) | `@Global()` module — exports `GeminiService` |
| [`apps/api/src/modules/ai/gemini.service.ts`](../../apps/api/src/modules/ai/gemini.service.ts) | Two public methods (`analyzeMessage`, `classifyAndScoreTicket`) + private `invoke()` wrapper with AiUsage logging |
| [`apps/api/src/modules/ai/gemini.prompts.ts`](../../apps/api/src/modules/ai/gemini.prompts.ts) | Two versioned prompt constants: `ANALYZE_MESSAGE_PROMPT` and `CLASSIFY_AND_SCORE_TICKET_PROMPT` |
| [`apps/api/src/modules/ai/workers/analyze-message.worker.ts`](../../apps/api/src/modules/ai/workers/analyze-message.worker.ts) | pg-boss worker for `ai:analyze-message` |
| [`apps/api/src/modules/ai/workers/classify-ticket.worker.ts`](../../apps/api/src/modules/ai/workers/classify-ticket.worker.ts) | pg-boss worker for `ai:classify-ticket` (topic + CSAT) |
| [`apps/api/src/modules/ai/workers/request-csat.worker.ts`](../../apps/api/src/modules/ai/workers/request-csat.worker.ts) | pg-boss worker for `ai:request-csat` (sends rating email, 30 min delay) |
| [`scripts/backfill-ai-analytics.ts`](../../scripts/backfill-ai-analytics.ts) | One-shot backfill against existing tickets/messages |

## Enqueue points

```
MessagesService.create()       → enqueueAnalyzeMessage()  (customer REPLY only)
TicketsService.update()        → enqueueClassifyTicket()   (on → RESOLVED)
                               → enqueueRequestCsat()      (on → RESOLVED, 30 min delay)
```

## Reopen tracking (write-path side effect)

When a customer replies on a `RESOLVED` or `CLOSED` ticket, `MessagesService.create()`:
1. Sets `ticket.reopenCount += 1`
2. Sets `ticket.reopenedAt = now()`
3. Moves status → `IN_PROGRESS`
4. Creates a `SYSTEM_EVENT` message in the thread

`firstResolvedAt` is set in `TicketsService.update()` on the first `→ RESOLVED` transition. It is never overwritten.

## CSAT rating flow

```
Ticket resolved → TicketsService.update()
  → enqueueRequestCsat (30 min delay)
  → RequestCsatWorker sends email with /rate/<token>
  → Customer opens URL → Bridge portal serves form
  → POST /rate/<token> → saves TicketRating.userRating
```

## Backfill script

```bash
# Dry run first — shows estimated costs, makes zero API calls
pnpm tsx scripts/backfill-ai-analytics.ts --dry-run

# Backfill everything (costs real money)
pnpm tsx scripts/backfill-ai-analytics.ts

# Limit to N tickets for testing
pnpm tsx scripts/backfill-ai-analytics.ts --limit=10
```

Cost estimate: ~$0.001 per ticket × 2 calls (analyzeMessage per message + classifyAndScoreTicket per ticket). 10 tickets + ~30 messages ≈ $0.04.

The script now also populates `TicketRating.aiSummary` (the 1-2 sentence scoring rationale) alongside CSAT and effort. The script imports `ANALYZE_MESSAGE_PROMPT` and `CLASSIFY_AND_SCORE_TICKET_PROMPT` directly from `apps/api/src/modules/ai/gemini.prompts.ts` — no duplicate prompt strings to maintain.

## No guardrails (by design)

Per the plan: observe-only mode. No budget caps, kill switches, or rate limits are implemented yet. The `/settings/ai-usage` page makes costs visible so the team can decide when to add limits.

## Environment variable

```
GEMINI_API_KEY=<your key>
```

If unset, `GeminiService.onModuleInit()` logs a warning and the model is not initialized. All AI worker calls will throw — the workers catch and log, so the rest of the app is unaffected.
