---
title: AI (Gemini + Athena bot)
stack: [Google Generative AI SDK, pg-boss, Prisma AiUsage model, MarkdownService]
status: working
last-reviewed: 2026-05-31
---

# AI Module

## What it does

Background AI analysis on support tickets and messages using **Gemini 2.5 Flash-Lite**. Two combined Gemini calls extract all signals in one shot per trigger event:

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
| `gemini-2.5-flash-lite` | Generative model — classification, bot answers, KB context headers (was `gemini-2.0-flash`, retired by Google 2026-06) |
| `pg-boss` queues | Three async queues: `ai:analyze-message`, `ai:classify-ticket`, `ai:request-csat` |
| `AiUsage` model | Per-call cost + token tracking for the `/settings/ai-usage` page |

## Queue retry configuration

| Queue | `retryLimit` | `retryDelay` | `startAfter` | `retryBackoff` |
|---|---|---|---|---|
| `ai:analyze-message` | 3 | 10 s | — | exponential |
| `ai:classify-ticket` | 3 | 30 s | — | exponential |
| `ai:request-csat` | 2 | — | 30 min (`startAfter` delay before first attempt) | none (linear retry) |

CSAT delays the first send by 30 minutes so the customer isn't pinged the instant the agent clicks Resolve.

### Transient-vs-terminal retry gating (R266)

`retryLimit` alone retries *every* failure, including deterministic ones (model
drift failing the zod schema, a Prisma constraint) that fail identically each
attempt and waste tokens. Both analysis workers (`analyze-message`,
`classify-ticket`) now classify the caught error with the shared
[`common/ai/transient-error.ts`](../../apps/api/src/common/ai/transient-error.ts)
`isTransientGeminiError()` helper: **rethrow only transient** errors (Gemini
503/429, network blip) so pg-boss retries with backoff; **swallow terminal**
errors (`return` without rethrow) so the remaining attempts aren't burned — the
message/ticket simply stays un-analysed until a later edit/resolve re-enqueues
it. The bot's `respondTo` uses the same helper to decide retry-vs-escalate (see
[bot.md](bot.md)).

## Pricing constants (gemini-2.5-flash-lite)

```
input:  $0.10 / 1M tokens
output: $0.40 / 1M tokens
```

Stored in `gemini.service.ts` → `PRICES` (duplicated in `bot/generator.service.ts`). Update there if Google changes pricing.

## Key files

| File | Role |
|---|---|
| [`apps/api/src/modules/ai/ai.module.ts`](../../apps/api/src/modules/ai/ai.module.ts) | `@Global()` module — exports `GeminiService` |
| [`apps/api/src/modules/ai/gemini.service.ts`](../../apps/api/src/modules/ai/gemini.service.ts) | Two public methods (`analyzeMessage`, `classifyAndScoreTicket`) + private `invoke()` wrapper with AiUsage logging |
| [`apps/api/src/modules/ai/gemini.prompts.ts`](../../apps/api/src/modules/ai/gemini.prompts.ts) | Two versioned prompt constants: `ANALYZE_MESSAGE_PROMPT` and `CLASSIFY_AND_SCORE_TICKET_PROMPT` |
| [`apps/api/src/modules/ai/workers/analyze-message.worker.ts`](../../apps/api/src/modules/ai/workers/analyze-message.worker.ts) | pg-boss worker for `ai:analyze-message` |
| [`apps/api/src/modules/ai/workers/classify-ticket.worker.ts`](../../apps/api/src/modules/ai/workers/classify-ticket.worker.ts) | pg-boss worker for `ai:classify-ticket` (topic + CSAT) |
| [`apps/api/src/modules/ai/workers/request-csat.worker.ts`](../../apps/api/src/modules/ai/workers/request-csat.worker.ts) | pg-boss worker for `ai:request-csat` (sends rating email, 30 min delay) |
| [`apps/api/src/common/ai/transient-error.ts`](../../apps/api/src/common/ai/transient-error.ts) | `isTransientGeminiError()` — shared retry-vs-give-up classifier (bot + analysis workers) |
| [`scripts/backfill-ai-analytics.ts`](../../scripts/backfill-ai-analytics.ts) | One-shot backfill against existing tickets/messages |

## Enqueue points

```
MessagesService.create()           → enqueueAnalyzeMessage()  (customer REPLY, isTicket=true only)
TicketsService.update()            → enqueueClassifyTicket()   (on → RESOLVED, isTicket=true only)
                                   → enqueueRequestCsat()      (on → RESOLVED, isTicket=true only, 30 min delay)
TicketsService.convert()           → enqueueAnalyzeMessage()  (backfill for prior unanalyzed customer messages)
TicketsService.create()            → enqueueBotRespond()       (new portal ticket, non-backfill)
ThreadIngestionService (new email) → enqueueAnalyzeMessage()  (customer REPLY, isTicket=true only — conversations skip)
```

## isTicket gating rule

**All AI/analysis features run only on real tickets (`isTicket = true`).** Email conversations
that arrive as `NEW` (pre-triage) and `DISMISSED` conversations receive no AI processing.

The gate is applied at every enqueue point **and** again defensively in each worker, so a future
enqueue path that forgets the guard is still protected at execution time.

On `convert()` (NEW conversation → real ticket) the service retroactively enqueues
`ai:analyze-message` for all prior unanalyzed customer messages so sentiment history is complete.
Messages that already have `analyzedAt` set are skipped (idempotent).

## Athena (first-response bot)

`BotService.respondTo(ticketId)` is the entry point. It:
1. Checks for an existing `BotInteraction` (idempotency) — returns immediately if one exists.
2. Loads the ticket + first customer `REPLY` message.
3. Embeds the question via `GeneratorService.embed()` with `taskType=RETRIEVAL_QUERY`.
4. Retrieves relevant knowledge-base chunks via `RetrievalService.retrieve()` (FTS sparse + pgvector dense + RRF).
5. Gate 1: max dense cosine similarity below `DENSE_THRESHOLD (0.55)` → `escalateToHuman()` + SSE broadcast.
6. `GeneratorService.generateAnswer()` → structured JSON with `answer`, `confidence`, `can_answer`, `citations`.
7. Gate 2: `can_answer=false` OR `confidence < 0.7` OR citation origin mismatch → `escalateToHuman()` + SSE broadcast.
8. All gates pass: `BotService.appendSource()` appends the `Learn more:` KB link (built from the validated citation, see below), then creates a `REPLY` message with `authorBotName='Athena'`. **`bodyHtml`** is populated by `MarkdownService.render(answer)` for rich rendering in Bridge and Portal.
9. Broadcasts `message-created` SSE event immediately so Bridge shows the reply without waiting for the 10s poll.
10. Updates ticket status → `WAITING`.
11. Sends email reply via `email.sendAgentReply()`.
12. Always writes `BotInteraction` audit row (stores `retrievalTopScore` = max dense cosine).

### Retrieval pipeline (`RetrievalService`)

**Hybrid retrieval** — two arms fused with Reciprocal Rank Fusion (k=60):

| Arm | Method | Why |
|---|---|---|
| **Dense** | pgvector cosine (`1 - embedding <=> query`) | Semantic similarity; top-50 |
| **Sparse** | Postgres FTS `ts_rank_cd(tsv, websearch_to_tsquery(...))` on stored `tsv` column | Keyword relevance; no trigram pollution |

The `tsv tsvector` generated column on `KnowledgeChunk` (GIN-indexed) is populated automatically by Postgres on every insert/update. Because generated columns live in raw-SQL migrations (not `schema.prisma`), `RetrievalService.onModuleInit()` re-runs the idempotent `ADD COLUMN IF NOT EXISTS … STORED` + `CREATE INDEX IF NOT EXISTS` on every boot — so a `migrate reset` can't silently drop it. The sparse arm is also wrapped in try/catch: if FTS fails, retrieval degrades to **dense-only** rather than throwing (a missing `tsv` once escalated every ticket — see STATE.md 2026-06-01).

`retrieve()` returns `{ chunks, maxDenseScore }`. The dense gate is `maxDenseScore ≥ 0.55` (interpretable for L2-normalised gemini-embedding-001 vectors).

**Why FTS, not pg_trgm**: `similarity(text, 'how many accounts connect on Pro')` matches connector pages (trigram `connect` ≈ `connection`) ahead of the Pricing page. FTS with `websearch_to_tsquery` matches document terms, not substring trigrams.

### Bot answer format (BOT_GENERATION_PROMPT)

One direct sentence summarising the answer → up to 3 short bullets (optional). ≤ 80 words. No preamble, no multi-link "Related articles" dump. The LLM writes **no links** in the answer text — it only populates `citations` with the single most relevant passage URL.

The `Learn more:` source link is appended **deterministically in code** (`BotService.appendSource()`), not by the LLM. It strips any stray model-generated `Learn more:` line, then appends one link built from `citations[0]`, matched back to a retrieved chunk so the link label is the chunk's `headingPath` breadcrumb (fallback `Read the full article`). Reason: under structured-JSON output `gemini-2.5-flash-lite` reliably fills the `citations` array but drops the inline link from the prose — `gemini-2.0-flash` used to type it. Owning the link in code makes it model-independent (STATE.md 2026-06-01).

### escalateToHuman()

Public method on `BotService`. Called from:
- `BotService` internally (low retrieval score / low confidence / origin mismatch / unexpected error)
- `MessagesService.create()` (customer portal reply after bot answered — scenario 9)
- `ThreadIngestionService` (customer email reply after bot answered — scenario 9)

What it does:
1. Guard: no-op if `ticket.assigneeId` is already set.
2. Sets ticket `status = 'OPEN'`, assigns `ShiftResolverService.currentPrimaryAgent()`.
3. Writes `escalated:<agent> — <reason>` `SYSTEM_EVENT` to the thread.
4. If `opts.notifyCustomer = true`: sends `sendEscalationNotification()` email to the customer.

### MarkdownService

`apps/api/src/modules/ai/markdown.service.ts` — converts a subset of Markdown (bold, italic, inline code, links, bullet lists, headings) to sanitized HTML without any ESM-only dependencies. Used exclusively by `BotService` to pre-render `bodyHtml` at write time. Both Bridge and Portal frontends prefer `bodyHtml` over raw `body` when present.

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

## Embedding model

**`gemini-embedding-001` at 768 dimensions** (previously `text-embedding-004`, which was retired by Google).

Config lives in [`apps/api/src/modules/ai/embedding.constants.ts`](../../apps/api/src/modules/ai/embedding.constants.ts):

```ts
EMBEDDING_MODEL = 'gemini-embedding-001'
EMBEDDING_DIMENSIONS = 768
EMBED_PRICE_PER_MILLION = 0.15  // USD per 1M tokens
```

All embed calls pass `outputDimensionality: 768` and then `l2normalize()` each returned vector before storage. L2 normalization is required by Gemini at sub-max dimensions to enable cosine-equivalent dot-product similarity in pgvector.

`EmbeddingService` is the single embed path — `GeneratorService.embed()` now delegates to it (no duplicate logic).

### Asymmetric taskType (gemini-embedding-001)

`EmbeddingService.embedChunks(texts, taskType)` passes `taskType` through to the SDK's `EmbedContentRequest`. The correct values per call site:

| Call site | TaskType |
|---|---|
| `IndexerService.embedSource()` (storing KB chunks) | `RETRIEVAL_DOCUMENT` |
| `IndexerService.indexPage()` (legacy single-URL path) | `RETRIEVAL_DOCUMENT` |
| `GeneratorService.embed()` (user query at query time) | `RETRIEVAL_QUERY` |

Asymmetric task types improve retrieval accuracy because the model learns separate projections for "document to store" vs "query to match". Default is `RETRIEVAL_DOCUMENT` to stay safe if a call site omits the argument.

### Chunk size tuning

`ChunkerService` constants (in `chunker.service.ts`):

| Constant | Old | New |
|---|---|---|
| `MAX_TOKENS` | 800 | 350 |
| `MIN_TOKENS` | 200 | 100 |

Finer chunks mean plan-level facts (e.g. "Pro: 50 accounts per connector") become their own vector instead of being buried in a large catch-all chunk. Small H3 sections are no longer merged into a large sibling.

### Crawler improvements

`CrawlerService` (`crawler.service.ts`):

- **Parallel fetch**: replaces sequential `for + await delay(1000)` with a bounded concurrency pool (CONCURRENCY=6). Wall-clock drops from `pages × (fetch + 1 s)` to `ceil(pages/6) × fetch`.
- **robots.txt sitemap discovery**: reads `Sitemap:` directives from `robots.txt` before trying the hardcoded `/sitemap.xml` candidates.
- **True incremental mode**: parses `<lastmod>` from sitemap entries; skips pages whose `lastmod ≤ source.fetchedAt` (no fetch at all, not just a content-hash skip after download).
- **Retry/backoff**: `fetchPage` retries up to 3 times with 500ms × attempt backoff on 429/5xx responses.
- **Gzip sitemap support**: decompresses `.gz` sitemaps via `DecompressionStream('gzip')` (Node 18+).
- **PrismaService injected** into `CrawlerService` for incremental-mode DB lookups (no other external side effects).

## Help Center Knowledge — two-phase scan → confirm → embed

Crawl and embedding are now split into two phases with a cost-confirmation gate:

**Phase A — Scan** (`POST /kb/scan/start`):
- `CrawlAndIndexWorker` crawls the root URL, calls `IndexerService.scanPage()` per page.
- `scanPage()`: fetch → content-hash → chunk → persist `KnowledgeChunk` rows with `embedding = NULL`, `contextHeader = NULL`. **Zero Gemini calls** — context header generation is deferred to Phase B. Source status = `SCANNED`.
- When done, computes cost estimate covering both (1) embedding tokens and (2) context-header summary calls (one flash call per page) → sets `kbPhase = AWAITING_CONFIRM`.

**Confirmation gate** (frontend): shows "N pages · M sections · estimated cost ≈ $X" with **Make searchable** / **Discard scan**.

**Phase B — Embed** (`POST /kb/embed/confirm`):
- Sets `kbPhase = EMBEDDING`, enqueues `KbEmbedWorker`.
- Worker iterates all `SCANNED` sources, calls `IndexerService.embedSource()`:
  1. Calls `ContextBuilderService.buildContextHeader()` once per source (HTML stripped of nav/footer/script before summarising).
  2. Prepends `[CONTEXT: …]` to each chunk's text and writes it back.
  3. Embeds all chunk texts via `EmbeddingService.embedChunks(texts, TaskType.RETRIEVAL_DOCUMENT)`.
  4. Writes `embedding` vector and marks source `INDEXED`.
- On finish: `kbPhase = DONE`.

**Cancel** (`POST /kb/scan/cancel`): discards `SCANNED` sources+chunks, returns to `IDLE`.

**Manual single-URL add** (`POST /kb/sources/manual`): scans the URL into the pending set; if phase is `IDLE`/`DONE` after, transitions to `AWAITING_CONFIRM` with updated estimate.

### Phase state machine

```
IDLE → SCANNING → AWAITING_CONFIRM → EMBEDDING → DONE
         ↓               ↓
      FAILED          CANCELLED (→ IDLE)
```

### AppConfig phase fields

| Field | Type | Meaning |
|---|---|---|
| `kbPhase` | `KbPhase` | Current phase |
| `kbScanPagesSeen` | Int | Pages crawled in Phase A |
| `kbScanChunkCount` | Int | Pending chunks after scan |
| `kbScanTokenEstimate` | Int | Sum of tokenCount for pending chunks |
| `kbScanCostUsd` | Decimal? | Estimated embed cost |
| `kbEmbedChunksDone` | Int | Chunks embedded so far in Phase B |
| `kbEmbedChunksTotal` | Int | Total chunks to embed in Phase B |
| `kbError` | String? | Error message if phase = FAILED |

### Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/kb/scan/start` | Start Phase A scan |
| POST | `/kb/scan/cancel` | Discard pending scan |
| POST | `/kb/embed/confirm` | Start Phase B embed |
| GET | `/kb/status` | Returns all kbPhase + scan/embed counters |
| POST | `/kb/sources/manual` | Scan single URL into pending set |

### New queues

| Queue constant | Queue name | Purpose |
|---|---|---|
| `KB_SCAN_QUEUE` | `kb:scan` | Phase A crawl job |
| `KB_EMBED_QUEUE` | `kb:embed` | Phase B embed job |

## AI Assistant settings UI (`/settings/ai-assistant`)

Accessible from the Settings nav under **AI > AI Assistant**.

| Card | Controls |
|---|---|
| **AI Assistant** | Provider (Gemini only; OpenAI/Anthropic placeholders), API key (set/update, stored as `botApiKeyEnc`) |
| **Help Center Knowledge** | Help-center URL, Scan documents / Check for updates, cost-confirmation panel while `AWAITING_CONFIRM`, embed progress bar while `EMBEDDING`, manual page add, Remove all documents, documents table with filter + search |

**Term mapping** (developer → admin language):

| Old | New |
|---|---|
| Crawl now | Scan documents |
| Resync | Check for updates |
| Clear index | Remove all documents |
| Re-index | Refresh |
| Chunks (column) | Sections |
| Last indexed | Last updated |
| Status INDEXED / SCANNED / FAILED / SKIPPED / PENDING | Ready / Scanned / Failed / Skipped / Processing |

**Removed from UI and backend** (hardcoded as constants):

| Removed field | Hardcoded value |
|---|---|
| `botEnabled` (DB col dropped) | always on |
| `botModelChat` (DB col dropped) | `gemini-2.5-flash-lite` in `GeneratorService` |
| `botModelEmbedding` (DB col dropped) | `gemini-embedding-001` in `EmbeddingService` |
| `botRetrievalThreshold` (DB col dropped) | `BotService.RETRIEVAL_THRESHOLD = 0.5` |
| `botConfidenceThreshold` (DB col dropped) | `BotService.CONFIDENCE_THRESHOLD = 0.7` |

**Fallback agent** is on **Settings → Agents** page. Saved to `AppConfig.botFallbackAgentId`.

## No guardrails (by design)

Per the plan: observe-only mode. No budget caps, kill switches, or rate limits are implemented yet. The `/settings/ai-usage` page makes costs visible so the team can decide when to add limits.

## Environment variable

```
GEMINI_API_KEY=<your key>
```

If unset at startup, the embedding and context-builder services resolve the key from `AppConfig.botApiKeyEnc` (set via the UI) on each call. All AI worker calls will throw with a clear error if neither source has a key — workers catch and log per-page, so a missing key does not crash the crawl job.
