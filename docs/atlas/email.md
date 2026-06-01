---
title: Email
stack: [Gmail REST API, Microsoft Graph REST API, nodemailer, NestJS Schedule, Postgres, AES-256-GCM, Google OAuth2, Microsoft OAuth2]
status: working
last-reviewed: 2026-05-31
---

# Email

## What it does

Customers and agents have a real two-way email conversation that mirrors the ticket thread in Bridge.

- The org connects their support inbox via **OAuth (Google or Microsoft)**. Host/port come from env; OAuth flow stores encrypted tokens.
- **Outbound**: when an agent replies in Bridge, the customer receives a real email from the support address, threaded into the existing Gmail conversation.
- **Inbound (live)**: a 30-second cron job polls the provider REST API for new mail and routes it to the correct ticket (or creates a new one).
- **Inbound (historical)**: on first OAuth connect, the full unbounded inbox archive is processed in the background (no cap, no time limit). A `gmailHistoryId` / `graphDeltaLink` checkpoint is set at archive **start** so live mail arriving during the archive is not missed. Live mail always has priority over backfill.

## Stack

| Layer | Library / service | Why |
|---|---|---|
| Gmail inbound | Gmail REST API (`history.list`, `threads.get`) | No IMAP — works with Google Workspace accounts that block IMAP |
| Microsoft inbound | Microsoft Graph REST API (`messages/delta`, `conversationId` grouping) | Consistent with Google; OAuth scopes `Mail.ReadWrite Mail.Send` |
| Outbound | `nodemailer` (OAuth2) + Microsoft Graph `/me/sendMail` | SMTP OAuth2 for Google; Graph REST for Microsoft |
| Cron | `@nestjs/schedule` + `@Cron` | 30-second tick; gated by `EMAIL_SYNC_LIVE_POLL=1` env var |
| Credential encryption | Node `crypto` (AES-256-GCM) | OAuth tokens stored encrypted at rest |
| Threading | RFC 5322 `Message-ID` / `In-Reply-To` / `References` | Real headers; Gmail / Outlook thread correctly |

## Inbound live-poll flow

```mermaid
sequenceDiagram
  autonumber
  participant Cron as LivePollerService (@Cron 30s)
  participant Factory as ProviderFactory
  participant Provider as GmailProvider / GraphProvider
  participant Ingestion as ThreadIngestionService
  participant DB as Postgres
  participant SSE as SseService

  Cron->>Factory: for(cfg) → IMailProvider
  Cron->>Provider: pollChanges(checkpoint)
  Provider-->>Cron: { threadIds, nextCheckpoint }
  loop each threadId (batch of 5)
    Cron->>Ingestion: fetchAndUpsertThread(provider, threadId)
    Ingestion->>Provider: fetchThread(threadId)
    Provider-->>Ingestion: ParsedThread
    Ingestion->>DB: upsert User (source=EMAIL), upsert Ticket (externalThreadId @unique), upsert Messages (externalMessageId @unique)
    Ingestion->>SSE: broadcast ticket-created / message-created
  end
  Cron->>DB: persist nextCheckpoint AFTER processing (at-least-once)
```

## Inbound backfill flow (on OAuth connect)

```mermaid
sequenceDiagram
  autonumber
  participant OAuthSvc as EmailOAuthService
  participant Events as AppEventsService
  participant Backfill as EmailSyncBackfillService
  participant Provider as GmailProvider / GraphProvider
  participant Ingestion as ThreadIngestionService
  participant DB as Postgres

  OAuthSvc->>DB: store encrypted tokens
  OAuthSvc->>Events: emitOAuthConnected(cfgId)
  Events-->>Backfill: onOAuthConnected listener fires
  Backfill->>Provider: fetchAliases() — build alias set
  Backfill->>DB: archiveStatus = RUNNING
  Backfill->>Provider: fetchCurrentHistoryId() — capture checkpoint BEFORE processing
  Backfill->>DB: persist gmailHistoryId / graphDeltaLink (so live poll catches up after archive)
  Backfill->>Provider: fetchTotalThreadCount() — estimate for progress display
  Backfill->>DB: persist archiveTotalEstimate
  Backfill->>Backfill: runBackgroundArchive() — unbounded pagination
  Note over Backfill: pageToken preserved on cancel; resume continues from last page
  loop background pages
    Backfill->>DB: persist archivePageToken after each page
    Backfill->>DB: check for CANCELLED between pages
  end
  Backfill->>DB: archiveStatus = DONE
  Backfill->>DB: update gmailHistoryId / graphDeltaLink to current (post-archive)
```

## Outbound flow (retried via queue)

Agent replies go through the `email:send-reply` pg-boss queue (`SendReplyWorker`), retried up to 3 times with exponential backoff. On permanent failure a `email_delivery_failed:` SYSTEM_EVENT appears in the ticket thread.

```mermaid
sequenceDiagram
  autonumber
  participant Agent as Agent in Bridge
  participant API as MessagesController
  participant Q as QueueService
  participant Worker as SendReplyWorker
  participant Email as EmailService
  participant DB as Postgres
  participant SMTP as Gmail SMTP / Graph API
  participant Customer

  Agent->>API: POST /tickets/:id/messages {body}
  API->>DB: persist Message row
  API->>SSE: broadcast message-created
  API->>Q: enqueueEmailSendReply({ticketId, messageId})
  API-->>Agent: 201 Created
  note over Q,SMTP: async, up to 3 attempts with backoff
  Worker->>DB: load ticket + message + appConfig
  Worker->>Email: sendAgentReply(ticket, message, appConfig)
  Email->>DB: lookup prior Message.messageId for thread chain
  Email->>SMTP: sendMail (OAuth2 for Google, /me/sendMail for Microsoft)
  SMTP-->>Email: 250 OK / 202 Accepted
  Email-->>Worker: returns new Message-ID
  Worker->>DB: store Message-ID on row (for future threading)
  SMTP-->>Customer: delivers email
```

### Inbound email — NEW status flow

When `ThreadIngestionService` creates a **new** ticket from an inbound email, it lands in the Inbox tab as `status = NEW`:

- `isBulk = true` if the message is detected as automated/bulk (newsletters, no-reply senders, list-unsubscribe headers, RFC 3834 `Auto-Submitted`, Exchange suppression) — renders a **Promotional** pill in the Inbox.
- `isBulk = false` for normal customer mail.

**No** confirmation email and **no** bot response are sent on ingest. The agent reviews the Inbox (`/inbox?view=inbox`) and clicks **Convert** to activate the ticket — that fires `TicketsService.activateTicket()` which sends the confirmation and enqueues the bot. Clicking **Dismiss** sets `status = DISMISSED` and stamps `dismissedAt`/`dismissedById` without contacting the customer.

#### Bulk detection signals (`isBulkSender`)

`apps/api/src/modules/email-sync/util/is-bulk-sender.ts` — shared by both Gmail and Graph providers:
- `Auto-Submitted` header present and ≠ `no` (RFC 3834)
- `Precedence` ∈ {bulk, list, junk}
- `List-Unsubscribe` or `List-Id` header present
- `X-Auto-Response-Suppress` header present
- Sender local-part matches `no-?reply` / `donotreply` / `mailer-daemon` / `postmaster`

### Escalation notification (scenarios 7 + 9)

`BotService.escalateToHuman()` (called from both `MessagesService` and `ThreadIngestionService`) sends a brief "a specialist will follow up" email to the customer via `EmailService.sendEscalationNotification()` when `opts.notifyCustomer = true`.

## Provider interface

Both Gmail and Microsoft Graph implement `IMailProvider`:

| Method | Description |
|---|---|
| `listThreadIdsSince(since, cap?)` | Lists thread IDs since a date (backfill foreground) |
| `listAllThreadIds(pageToken?)` | Paginated full archive (background) |
| `fetchThread(threadId)` | Returns `ParsedThread` with all messages |
| `pollChanges(checkpoint)` | Returns new thread IDs + next checkpoint (live poll) |
| `fetchAliases()` | Returns all send-as alias addresses for the account |
| `isStaleCheckpointError(err)` | Detects 404 (Gmail) / 410 (Graph) stale-state errors |
| `recoverFromStaleCheckpoint()` | Falls back to re-listing last 7 days |

## Customer resolver

`CustomerResolverService.resolveCustomer(thread, aliases)`:
1. Collects all `from` addresses across thread messages.
2. Filters out any address that matches the agent's own aliases.
3. Picks the most-frequent remaining address as the customer.
4. The agent's address **never** becomes a `User` row.

## Token refresh

`TokenRefresher` dedupes concurrent refresh calls via `refreshLocks: Map<string, Promise<string>>`. Access token refreshed automatically when within 5 minutes of `oauthTokenExpiresAt`.

## Stale checkpoint recovery

- **Gmail**: `history.list` returns 404 when `historyId` has expired → re-list last 7 days, re-derive a fresh `historyId` from the profile.
- **Microsoft**: `messages/delta` returns 410 (`SyncStateNotFound`) → same fallback, rebuild delta link from last 7 days.

## Inbound email attachments (Gmail)

`parseGmailMessage()` in `GmailProvider` now walks `payload.parts` recursively. For each part where `filename` is non-empty and `body.attachmentId` exists, a `ParsedAttachment` entry is added to the returned `ParsedMessage`.

After the DB transaction completes in `ThreadIngestionService.fetchAndUpsertThread()`, attachments are fetched and stored:

1. `GmailProvider.fetchAttachmentBytes(gmailMessageId, gmailAttachmentId)` — `GET /gmail/v1/users/me/messages/{id}/attachments/{attachmentId}`, decodes base64url.
2. `FilesService.storeBuffer(bytes, { filename, mimeType, size, ticketId, messageId })` — MinIO PUT + presigned URL + `prisma.attachment.create()`.

Attachment fetch runs **outside** the DB transaction (HTTP calls must not run inside a Postgres transaction).

Safety bounds:
- Attachments larger than **25 MB** are skipped with a warning log.
- A failure on one attachment logs an error and continues — it never fails the whole ingest.
- Graph provider (Microsoft) does not yet implement attachment extraction. The capability check is via duck-typing: `'fetchAttachmentBytes' in provider`.

## At-least-once semantics

Checkpoint (historyId / deltaLink / archivePageToken) is persisted to DB **after** the batch is processed, not before. Crashes mid-batch replay the batch on restart. Idempotency is on `Ticket.externalThreadId @unique` and `Message.externalMessageId @unique`.

## Key files

| File | Role |
|---|---|
| [`apps/api/src/modules/email-sync/providers/mail-provider.interface.ts`](../../apps/api/src/modules/email-sync/providers/mail-provider.interface.ts) | `IMailProvider` interface — single pipeline, two adapters |
| [`apps/api/src/modules/email-sync/providers/gmail.provider.ts`](../../apps/api/src/modules/email-sync/providers/gmail.provider.ts) | Gmail REST adapter (`history.list`, `threads.get`, `settings/sendAs`) |
| [`apps/api/src/modules/email-sync/providers/graph.provider.ts`](../../apps/api/src/modules/email-sync/providers/graph.provider.ts) | Microsoft Graph adapter (`messages/delta`, `conversationId` grouping) |
| [`apps/api/src/modules/email-sync/providers/provider-factory.ts`](../../apps/api/src/modules/email-sync/providers/provider-factory.ts) | `for(cfg)` — creates the right provider, builds alias list |
| [`apps/api/src/modules/email-sync/thread-ingestion.service.ts`](../../apps/api/src/modules/email-sync/thread-ingestion.service.ts) | Provider-agnostic pipeline: upsert User/Ticket/Messages, enqueue AI for live, broadcast SSE |
| [`apps/api/src/modules/email-sync/customer-resolver.service.ts`](../../apps/api/src/modules/email-sync/customer-resolver.service.ts) | Picks non-alias sender; agent address never becomes a User row |
| [`apps/api/src/modules/email-sync/email-sync-backfill.service.ts`](../../apps/api/src/modules/email-sync/email-sync-backfill.service.ts) | OAuth-connect trigger + unbounded background archive; `resumeArchive()` preserves pageToken |
| [`apps/api/src/modules/email-sync/live-poller.service.ts`](../../apps/api/src/modules/email-sync/live-poller.service.ts) | `@Cron('*/30 * * * * *')`, gated by `EMAIL_SYNC_LIVE_POLL=1`; per-thread try/catch; always advances checkpoint |
| [`apps/api/src/modules/email-sync/email-sync.controller.ts`](../../apps/api/src/modules/email-sync/email-sync.controller.ts) | `POST /sync/backfill/run`, `GET /sync/status`, `POST /sync/archive/cancel`, `POST /sync/archive/resume`, `POST /sync/poll/now`, `POST /sync/resync` |
| [`apps/api/src/common/logger/file-logger.ts`](../../apps/api/src/common/logger/file-logger.ts) | `FileLogger extends ConsoleLogger` — writes daily JSON log files to `apps/api/logs/app-YYYY-MM-DD.log` |
| [`apps/api/src/modules/email-sync/email-sync.module.ts`](../../apps/api/src/modules/email-sync/email-sync.module.ts) | Module wiring; imports `ScheduleModule.forRoot()` |
| [`apps/api/src/modules/email-sync/util/with-retry.ts`](../../apps/api/src/modules/email-sync/util/with-retry.ts) | Exponential backoff for 429 rate-limit errors (5s, 10s, 20s, max 3 retries) |
| [`apps/api/src/modules/email/email.service.ts`](../../apps/api/src/modules/email/email.service.ts) | Outbound: `nodemailer` (OAuth2) for Google, `sendViaGraph()` for Microsoft |
| [`apps/api/src/modules/email-oauth/email-oauth.service.ts`](../../apps/api/src/modules/email-oauth/email-oauth.service.ts) | OAuth auth URL generation, code exchange, token storage for Google + Microsoft |
| [`apps/api/src/modules/email-oauth/email-oauth.controller.ts`](../../apps/api/src/modules/email-oauth/email-oauth.controller.ts) | `GET /config/email/oauth/:provider/start`, callback, disconnect |
| [`apps/api/src/modules/email-oauth/token-refresher.ts`](../../apps/api/src/modules/email-oauth/token-refresher.ts) | Checks `oauthTokenExpiresAt`, deduped refresh via `refreshLocks` map |
| [`apps/api/src/common/crypto/credentials-cipher.ts`](../../apps/api/src/common/crypto/credentials-cipher.ts) | AES-256-GCM encrypt/decrypt for OAuth tokens |
| [`apps/bridge/src/app/settings/email/page.tsx`](../../apps/bridge/src/app/settings/email/page.tsx) | Settings → Email UI: method picker (Google/Microsoft), connected state, archive progress |
| [`apps/bridge/src/components/settings/email/MethodPicker.tsx`](../../apps/bridge/src/components/settings/email/MethodPicker.tsx) | Google + Microsoft auth method cards |
| [`apps/bridge/src/components/dashboard/ArchiveProgressCard.tsx`](../../apps/bridge/src/components/dashboard/ArchiveProgressCard.tsx) | Archive progress card: shows "X / Y emails retrieved" (foreground) or "X emails retrieved" (background); proportional or indeterminate bar; Cancel / Pull again buttons |
| [`apps/bridge/src/lib/useBackfillStatus.ts`](../../apps/bridge/src/lib/useBackfillStatus.ts) | Polls `GET /api/v1/sync/status` (5s when RUNNING, 30s otherwise); subscribes to `archive-progress` SSE; takes `Math.max` on `archiveTotalSeen` to prevent stale poll overwriting SSE count |
| [`apps/bridge/src/lib/useEmailConfig.ts`](../../apps/bridge/src/lib/useEmailConfig.ts) | Polls `GET /api/v1/config`; `isConnected` = `oauthConnected` |

## Endpoints

**OAuth** (on `EmailOAuthController`, prefix `config/email/oauth`):
| Method | Path | Description |
|---|---|---|
| `GET` | `/config/email/oauth/:provider/start` | Returns OAuth auth URL |
| `GET` | `/config/email/oauth/:provider/callback` | Exchanges code, stores tokens, redirects to Bridge |
| `DELETE` | `/config/email/oauth/disconnect` | Clears OAuth tokens + resets archive state |

**Sync** (on `EmailSyncController`, prefix `sync`):
| Method | Path | Description |
|---|---|---|
| `POST` | `/sync/backfill/run` | Trigger full unbounded background archive (sets checkpoint first) |
| `GET` | `/sync/status` | Returns `{ archiveStatus, archiveTotalSeen, archiveTotalEstimate }` |
| `POST` | `/sync/archive/cancel` | Sets `archiveStatus = CANCELLED` (preserves pageToken for resume) |
| `POST` | `/sync/archive/resume` | Resumes cancelled archive from saved pageToken (no restart) |
| `POST` | `/sync/poll/now` | Manually trigger one live-poll cycle for all active OAuth configs |
| `POST` | `/sync/resync` | Clears checkpoint and triggers full re-sync |

## Data model touched

**`AppConfig`**: `oauthProvider`, `oauthEmail`, `oauthAccessTokenEnc`, `oauthRefreshTokenEnc`, `oauthTokenExpiresAt`, `oauthScopes`, `oauthAliases[]`, `gmailHistoryId`, `graphDeltaLink`, `archivePageToken`, `archiveStatus`, `archiveTotalSeen`, `archiveTotalEstimate`.

**`Ticket`**: `externalThreadId @unique`, `externalProvider` (GMAIL/GRAPH), `source = EMAIL`. **`Message`**: `externalMessageId @unique`, `messageId`, `inReplyTo`, `bodyRaw`. **`User`**: `source = EMAIL`.

See [_generated/erd.md](_generated/erd.md) for the full ERD.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server (outbound Gmail) |
| `SMTP_PORT` | `587` | SMTP port (STARTTLS) |
| `EMAIL_CREDS_KEY` | (required) | AES-256-GCM key for OAuth token encryption — `openssl rand -hex 32` |
| `GOOGLE_OAUTH_CLIENT_ID` | (optional) | Google Cloud Console OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | (optional) | Google Cloud Console OAuth client secret |
| `MICROSOFT_OAUTH_CLIENT_ID` | (optional) | Azure Entra app registration client ID |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | (optional) | Azure Entra app registration client secret |
| `OAUTH_CALLBACK_BASE` | `http://localhost:3001` | **API** base URL for OAuth redirect URIs |
| `BRIDGE_URL` | `http://localhost:3002` | Bridge base URL — post-OAuth browser redirect target |
| `EMAIL_SYNC_LIVE_POLL` | `0` | Set to `1` to enable the 30s live-poll cron |

### OAuth redirect URIs to register in provider console

- Google Cloud Console → OAuth 2.0 Client → Authorized redirect URIs: `{OAUTH_CALLBACK_BASE}/api/v1/config/email/oauth/google/callback`
- Azure Entra → App registration → Redirect URIs: `{OAUTH_CALLBACK_BASE}/api/v1/config/email/oauth/microsoft/callback`

## Email-connected gate (Bridge)

When email is not configured (`!oauthConnected`), Bridge shows a full-page gate on `/inbox`, `/tickets`, and `/tickets/[id]`. Sidebar remains accessible so ADMIN agents can navigate to Settings → Email to connect.

- `useEmailConfig(token)` — module-level cached `GET /config` call; `isConnected = oauthConnected`. Cache invalidated on `refresh()`.
- `EmailNotConfiguredGate` — ADMIN gets "Connect email" CTA → `/settings/email`; non-ADMIN gets "ask your admin" message.

## Notable decisions

- **IMAP fully removed** — Gmail REST API (`history.list`) and Microsoft Graph (`messages/delta`) replace `imapflow`. No IDLE connections, no mailbox lock contention, no extra infra. Works with Google Workspace accounts that disable IMAP.
- **Single `IMailProvider` interface** — one ingestion pipeline (`ThreadIngestionService`) works for both Gmail and Microsoft. Provider-specific code lives only in the adapters.
- **Unlimited archive (no 300-thread / 180-day cap)** — removed `FOREGROUND_MAX_THREADS = 300` and `FOREGROUND_DAYS = 180`. Archive is now a single unbounded background phase with no time or count limit.
- **Checkpoint set at archive START, not end** — `setInitialCheckpoint()` is called before any thread is processed. If mail arrives during a long archive, the live poller can pick it up immediately after `archiveStatus = DONE`. Checkpoint is also refreshed at completion to advance past the archive itself.
- **Per-thread error isolation in live poller** — each `fetchAndUpsertThread` call is wrapped in try/catch. A single bad thread logs a warning and continues; the checkpoint always advances after the loop. Previously, one failing thread blocked the checkpoint forever → infinite retry every 30s.
- **`messagesAdded` checked before `messages` in Gmail history** — `history[].messagesAdded[].message.threadId` is more reliable than `history[].messages[].threadId` (which only appears on some entry types). Fixes missed threads on first-ever poll.
- **3-level In-Reply-To matching for portal tickets** — portal tickets have `externalThreadId = null` until linked. When a customer replies to a confirmation email the poller resolves the ticket via: (1) `externalThreadId` fast path, (2) agent reply `Message-ID` in `Message.messageId`, (3) parse `<ticket-{emailThreadId}@domain>` from the synthetic confirmation `Message-ID` and look up `Ticket.emailThreadId`. On match, stamps `externalThreadId` for future fast-path lookups.
- **RFC messageId dedup before `message.create()`** — Gmail includes a sent email twice (Inbox + Sent copy) with different Gmail IDs but identical RFC `Message-ID`. The `externalMessageId` check passes but `messageId @unique` would throw P2002. Fix: `findUnique({ where: { messageId: rfcMessageId } })` → skip if exists.
- **Cancel preserves pageToken; resume continues mid-archive** — `POST /sync/archive/cancel` sets `archiveStatus = CANCELLED` only. `POST /sync/archive/resume` sets status back to `RUNNING` and calls `runBackgroundArchive()` which reads the saved `archivePageToken`. No restart from beginning.
- **Ticket timestamps from actual email dates** — `Ticket.createdAt` = `sentAt` of first message; `Ticket.updatedAt` = `sentAt` of latest message. Existing tickets receiving a new reply update `updatedAt` to the new message's `sentAt`. Avoids all tickets showing the import timestamp.
- **Daily rotating JSON log files** — `FileLogger extends ConsoleLogger` writes `{"ts","level","context","msg"}` JSON lines to `apps/api/logs/app-YYYY-MM-DD.log`. Enables post-hoc debugging without needing a terminal session open. Tail with: `tail -f apps/api/logs/app-$(date +%Y-%m-%d).log | jq -r '[.ts,.level,.context,.msg] | @tsv'`.
- **At-least-once semantics, idempotent upserts** — checkpoint persisted after processing. `externalThreadId @unique` + `externalMessageId @unique` makes replays safe.
- **Stale checkpoint auto-recovery** — Gmail 404 or Graph 410 → re-list last 7 days, re-derive checkpoint. No manual intervention needed.
- **AppEventsService for backfill trigger** — `EmailOAuthService` emits `OAUTH_CONNECTED`; `EmailSyncBackfillService` listens. Avoids circular module dependency (EmailSyncModule imports EmailOAuthModule).
- **OAuth callback on the API, not Bridge** — auth code never touches Bridge request logs; API exchanges it server-side and redirects browser to Bridge with `?connected=1`.
- **`EMAIL_SYNC_LIVE_POLL=1` gate** — live polling is off by default. Dev environments can leave it off; prod sets it explicitly.
- **Background archive resumes on restart** — `OnApplicationBootstrap` in `EmailSyncBackfillService` checks for `archiveStatus === RUNNING` and resumes from `archivePageToken`.
- **`processBatch` callback is async; DB write awaited before SSE** — originally the chunk callback used fire-and-forget `void db.update()`. SSE could broadcast a count before the DB committed it; the next poll would then return 0 and overwrite the UI counter. Making the callback `async` and awaiting the write fixes the race.
- **`useBackfillStatus` takes `Math.max` on poll** — the poll `setStatus` uses `Math.max(polled.archiveTotalSeen, prev.archiveTotalSeen)` so a stale poll response can never roll back a higher count already set by an SSE event.
- **`archiveTotalEstimate` persisted before first chunk** — the total thread count for the foreground phase is saved to `AppConfig.archiveTotalEstimate` before `processBatch` starts, so the very first poll returns the denominator for the `X / Y` display. Background archive has no known total; the UI shows an indeterminate bar instead.
- **Concurrent user upsert — P2002 fallback** — `user.upsert()` outside the transaction can still race when 5 threads process the same customer email simultaneously. Fix: catch `P2002` (`PrismaClientKnownRequestError`) and fall back to `findUnique` — the winning thread already inserted the row.
- **DISMISSED → NEW resurface on customer reply** — `ThreadIngestionService` checks the current ticket status inside the `!wasCreated` update block. If the status is `DISMISSED` and the new message is from a customer (non-agent, `newMessageId` is set), it flips `status = 'NEW'` in the same `tx.ticket.update()` call. This returns the thread to the agent Inbox for re-triage without sending any customer email (ticket is still pre-activation).
- **No AI on backfill messages** — prevents cost spikes on thousands of historical messages. "Run AI on imported emails" gives explicit control back to the admin.
- **TokenRefresher dedupes concurrent refreshes** — `refreshLocks: Map<string, Promise<string>>` ensures two concurrent sends don't both try to refresh the token, causing one to store a stale token.

## Known gaps

- Attachments not yet extracted from inbound email → MinIO.
- Outbound threading headers (`In-Reply-To`, `References`) not yet built for email-originated tickets (no confirmation email was sent as thread root).
- `OAUTH_CALLBACK_BASE` and `BRIDGE_URL` env vars must be set correctly in production; defaults only work for local dev.
