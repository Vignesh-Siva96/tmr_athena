---
title: Architecture — TMR Support Platform
status: working
last-reviewed: 2026-06-04
stack:
  - Next.js (Portal · Bridge)
  - NestJS (API)
  - PostgreSQL (data + pg-boss + pgvector)
  - MinIO (file attachments)
  - Nginx (reverse proxy)
---

# Architecture — TMR Support Platform

System-level overview of how all services connect, communicate, and deploy.
For per-feature detail see the linked atlas docs below.

---

## Services

```
┌──────────────────────────────────────────────────────────────────┐
│                    Nginx  (reverse proxy)                         │
│  support.tmr.com → portal :3000                                  │
│  dash.tmr.com    → bridge :3002                                  │
│  api.tmr.com     → api    :3001                                  │
└──────────┬────────────────────┬─────────────────────────────────┘
           │                    │
  ┌────────▼──────┐  ┌──────────▼────────┐  ┌──────────────────┐
  │ Portal         │  │ Bridge             │  │ API               │
  │ Next.js :3000  │  │ Next.js :3002      │  │ NestJS   :3001    │
  │ (light theme)  │  │ (dark theme)       │  │                   │
  └────────────────┘  └───────────────────┘  └────────┬─────────┘
                                                       │
                         ┌─────────────────────────────┼──────────────────┐
                         │                              │                   │
              ┌──────────▼──┐               ┌───────────▼──┐  ┌───────────▼──┐
              │ PostgreSQL   │               │ MinIO         │  │ External      │
              │ :5432        │               │ :9000         │  │ Gmail REST    │
              │ (data +       │               │ (attachments) │  │ Graph REST    │
              │  pg-boss +    │               └──────────────┘  │ GitHub API    │
              │  pgvector)   │                                  │ Gemini API    │
              └─────────────┘                                   └──────────────┘
```

**Single-tenant.** There is no `Org` model and no `orgId` on any table.
Instance-wide settings, branding, and integration credentials live in a single-row
`AppConfig` record (`apps/api/src/modules/config`).

**Queue.** Background jobs use **pg-boss v9** inside the existing Postgres database
(`pgboss` schema). No Redis, no separate message broker.

**Real-time.** Bridge receives live updates via **SSE** (`GET /api/v1/events`).
No WebSocket. The `EventsModule` is `@Global()`.

---

## Flow: Customer creates a ticket (portal)

```
1. Customer fills portal form  →  POST /api/v1/tickets
2. API: TicketsService.create() — Prisma transaction
   - creates Ticket (isTicket=true, ref=<7-char base32>, status=OPEN)
   - creates Message (type=REPLY, authorUserId)
   - links any pre-uploaded Attachments
3. API enqueues pg-boss job: bot:respond-to-ticket
4. API returns ticket to portal; portal shows confirmation
5. (background) BotWorker runs RAG → posts bot Message or escalates
6. Agent replies → MessagesService.create()
   → enqueues email:send-reply job
   → SendReplyWorker calls EmailService.sendAgentReply()  (Nodemailer / Graph)
```

---

## Flow: Inbound email

```
Gmail REST history.list (30 s cron, gated by EMAIL_SYNC_LIVE_POLL=1)
  OR Microsoft Graph messages/delta
    │
    ▼  EmailSyncLivePoller  →  GmailProvider / GraphProvider
                                │
                                ▼  ThreadIngestionService
                                   - upsert User (category set once)
                                   - upsert Ticket (isTicket=false, status=NEW)
                                   - create Messages
                                   - store inbound attachments via FilesService
                                   - broadcast SSE: ticket-created / ticket-updated
                                   │
                                   ▼  if resurfacing DISMISSED thread → status=NEW
```

Inbound emails land as **conversations** (`isTicket=false`, `status=NEW`).
An agent converts them to real tickets (`POST /tickets/:id/convert`), which
sets `isTicket=true`, triggers the confirmation email, and enqueues the bot.

See [email.md](email.md) for the full inbound/outbound flow detail.

---

## Flow: Agent reply (outbound email)

```
Agent sends reply in Bridge
  →  POST /api/v1/tickets/:id/messages
  →  MessagesService.create()  (DB transaction)
  →  enqueues email:send-reply  (pg-boss, retryLimit: 3, retryBackoff: true)
  →  SendReplyWorker: EmailService.sendAgentReply()
       - Gmail:     Nodemailer  (from oauthEmail, XOAUTH2)
       - Microsoft: Graph API   sendMail
       - Reply-To:  VERP  reply+<emailThreadId>.<hmac8>@<domain>
  →  on final failure: writes SYSTEM_EVENT "email_delivery_failed:" to thread
```

---

## NestJS modules

25 modules under `apps/api/src/modules/`. See
[`_generated/module-graph.md`](_generated/module-graph.md) for the full import
graph. Per-feature docs below cover flow and key files.

Notable structural points:

- `orgs/` directory exists on disk but is **not imported** anywhere — dead stub, safe to delete.
- `QueueModule` is `@Global()` — any module can inject `QueueService` without importing it.
- `EventsModule` is `@Global()` — `SseService` is available everywhere.
- `AppEventsModule` is `@Global()` — Node `EventEmitter` singleton for internal cross-module signals.

---

## Shared packages

| Package | Purpose |
|---|---|
| `packages/db` | Prisma schema + client + migrations + seed |
| `packages/ui` | Shared React components (Badge, Button, Input, Textarea) |
| `packages/types` | Shared TypeScript types + Zod schemas |
| `packages/email` | React Email templates |
| `packages/config` | Shared ESLint, TS, Tailwind configs |

---

## Docker Compose (local dev)

```yaml
services:
  postgres:  image: postgres:15  port 5432
  minio:     image: minio/minio  ports 9000 + 9001 (console)
  # api / portal / bridge run via pnpm dev outside Docker in local dev
  # nginx: image: nginx  ports 80 + 443 (production only)
```

No Redis service — pg-boss runs inside Postgres.

---

## Logging & observability

The NestJS app logger is `WinstonLogger` (`apps/api/src/common/logger/logger.service.ts`), set in
`main.ts`. A single shared winston logger fans out to **two transports — no console**:

| Transport | Destination | Notes |
|---|---|---|
| `DailyRotateFile` | `apps/api/logs/app-YYYY-MM-DD.log`, 7-day retention | One JSON record per line — `{ts, level, context, msg}`. This is the shape the CLAUDE.md `tail -f … \| jq` debugging command parses; treat it as a contract (regression R253). |
| `LoggingWinston` (GCP Cloud Logging) | Google Cloud project | Always attached; **non-fatal** — a missing/invalid key file logs to stderr via `defaultCallback` and never crashes the app. |

- **Credentials**: service-account JSON key file at `GOOGLE_CLOUD_CREDENTIALS_PATH` (default
  `./cloudlogging.json`, gitignored). Other env: `GOOGLE_CLOUD_PROJECT_ID`,
  `GOOGLE_CLOUD_SERVICE_CONTEXT`, `CLOUD_PROVIDER`, `LOG_SERVICE_NAME`.
- **256KB cap**: GCP rejects entries over ~256KB (protobuf). `log-truncation.ts` +
  `reduceLogInfoSize` shrink oversized payloads (arrays/strings/depth, then structural summary)
  before send.
- Keeps NestJS `ConsoleLogger` call signatures, so every `new Logger(ctx)` call site is unchanged.
- Mirrors `tmr_data_service/src/configs/logger.ts`.

---

## Feature reference

| Feature | Atlas doc |
|---|---|
| Email (inbound + outbound) | [email.md](email.md) |
| Tickets + Messages | [tickets.md](tickets.md) · [messages.md](messages.md) |
| Bot (Athena) | [bot.md](bot.md) |
| AI analysis (sentiment, CSAT) | [ai.md](ai.md) |
| Analytics | [analytics.md](analytics.md) |
| GitHub | [github.md](github.md) |
| Auth | [auth.md](auth.md) |
| Notifications | [notifications.md](notifications.md) |
| Settings / AppConfig | [settings.md](settings.md) |
| Files (MinIO) | [files.md](files.md) |
| Queue (pg-boss) | [queue.md](queue.md) |
| Real-time (SSE) | [realtime.md](realtime.md) |
