# STATE.md — TMR Support Platform

Living document. Updated every session. Reflects current reality, not the original spec.
Last updated: 2026-06-14 (Plan in-portal-signup-flow-enumerated-clarke: Email verification + forgot/reset password)

---

## Quick Reference

| Item           | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Portal         | http://localhost:3000                                   |
| API            | http://localhost:3001                                   |
| Bridge (agent) | http://localhost:3002                                   |
| MinIO Console  | http://localhost:9001                                   |
| DB             | postgresql://postgres:{pass}@localhost:5432/tmr_support |
| Customer login | jordan@acmecorp.com / customer123                       |
| Admin login    | admin@twominutereports.com / admin123                   |
| Agent login    | agent@twominutereports.com / agent123                   |

### Start the stack

```bash
# 1. Start infra (if not running) — standalone containers, see DEPLOY.md
docker run -d --name athena-pg -p 5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tmr_support \
  pgvector/pgvector:pg16
docker run -d --name athena-minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# 2. API
pnpm --filter @tmr/api dev

# 3. Portal
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm --filter @tmr/portal dev

# 4. Bridge
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm --filter @tmr/bridge dev
```

### After schema changes

```bash
cd packages/db && npx prisma db push   # dev only — skip migration file
pnpm --filter @tmr/db db:seed          # re-seed if needed
pnpm --filter @tmr/db exec prisma generate
```

### GitHub webhook (local dev)

```bash
# Expose API via tunnel (ngrok example)
ngrok http 3001
# Use the ngrok URL as NEXT_PUBLIC_API_URL and in GitHub webhook settings
# Webhook path: https://{tunnel}/api/v1/github/webhook
# Secret: generate from Settings → GitHub → Webhook Configuration
```

---

## Architecture Decisions (deviations from original spec)

| Decision                                                                | Reason                                                                                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Single-tenant** — `orgId` removed from all tables                     | Original spec was multi-tenant but intent was self-hosted single instance                                                          |
| **`AppConfig` table** instead of `Org`/`BrandConfig`                    | Single-row config table; edited via Settings page                                                                                  |
| **Custom JWT** (HMAC-SHA256 via Node crypto) instead of Better Auth     | Better Auth's schema conflicts with our custom Prisma models                                                                       |
| **`@prisma/client` imported directly** in `PrismaService`               | `@tmr/db` is TypeScript source — NestJS can't load `.ts` at runtime                                                                |
| **`Attachment.ticketId` is optional**                                   | Files pre-uploaded before ticket creation; linked at ticket create time                                                            |
| **Attachment download URLs signed on click, not persisted** (`GET /files/:id/sign` + `Attachment.objectKey`) | `storeBuffer` used to mint a **7-day** presigned URL once at upload and store it, so every link died 7 days after upload regardless of activity. Now each row keeps a durable `objectKey`; the endpoint authorizes (agent any / customer owns ticket) then re-signs a short-lived URL (`S3_READ_URL_TTL_SECONDS`, default 600 s) per click — links never go stale, leaked URLs expire fast. Rejected a static-link/longer-TTL approach (would break clicks on long-open pages) and a 302-redirect endpoint (bare anchors carry no Bearer token → 401); the click handler `fetch`es the endpoint then `window.open`s the URL. Object bytes are never deleted/lifecycle-expired — only the signature. Risky types (`.html`/`.svg`/`.exe`) force-download; `.exe` upload blocked. (2026-06-23) |
| **Object storage via `@aws-sdk/client-s3`, not the `minio` client** (`FilesService`) | The `minio` client requires `endPoint` to be a bare host and threw `InvalidEndpointError` at construction when `S3_ENDPOINT` held a full URL — which, under NestFactory's default `abortOnError:true`, exited the API silently (error only in the file logger). Swapped to the AWS S3 SDK: one client (`forcePathStyle:true`) for both MinIO (local) and E2E (prod). The SDK takes `endpoint` as a **full URL** (the original `.env` value was correct all along; minio was the problem) and rejects a bare host / `host:port` — so `S3_ENDPOINT` is now a full URL passed straight through, and the minio-era `S3_PORT`/`S3_USE_SSL` split was dropped (scheme + port encode both). Env vars renamed `MINIO_*`→`S3_*`. Bucket is **not** auto-created (shared, pre-provisioned in prod; tests `CreateBucketCommand` it). `main.ts` now uses `abortOnError:false` so fatal bootstraps print instead of vanishing. (2026-06-23) |
| **pg-boss queue** for inbound emails (replaces BullMQ + Redis)          | `email.inbound` queue backed by Postgres (`pgboss` schema); 5x exponential retry; same `DATABASE_URL`; zero extra infra to deploy |
| **Transient Gemini failures are retried, not escalated/given-up** (`common/ai/transient-error.ts` → `isTransientGeminiError`) | A momentary Gemini 503 ("model experiencing high demand") used to escalate a bot ticket to a human on the **first** failure — `BotService.respondTo` caught the error and escalated without rethrowing, so the queue's `retryLimit:3` never fired. Now every Gemini caller classifies the error: **transient** (status 408/429/500/502/503/504, or a network/abort/timeout message) is rethrown so pg-boss retries with backoff; **terminal** (4xx client, zod/JSON parse on model drift, plain errors) is not. The bot worker threads pg-boss retry metadata (`job.retrycount`/`retrylimit`) into `respondTo({ isFinalAttempt })` and escalates only on a terminal error or the final attempt, so a sustained outage still reaches a human. The analysis workers (`analyze-message`, `classify-ticket`) rethrow transient / swallow terminal — stopping wasted retries on deterministic failures. Classifier is duck-typed (numeric `status` + message regex), **not** `instanceof` on the SDK error classes, so it's dependency-free and robust across module/bundler realms. (2026-06-23) |
| **Generated FTS `tsv` column asserted at boot** (`RetrievalService.onModuleInit`) | Generated columns live in raw-SQL migrations, not `schema.prisma`; `migrate reset`/0-step migrations can silently drop them and break bot retrieval. Idempotent boot guard self-heals. (2026-06-01) |
| **Athena `Learn more:` link rendered in code, not by the LLM** (`BotService.appendSource`) | The bot answer used to rely on the LLM typing the source link into `answer`. Under structured-JSON output `gemini-2.5-flash-lite` fills the `citations` array but drops the inline link; `gemini-2.0-flash` didn't. Link now appended deterministically from `citations[0]` (matched to a retrieved chunk for a heading label), so it's model-independent. (2026-06-01) |
| **KB + Shifts controllers: `@UseGuards(AuthGuard, AgentGuard)` at class level, ADMIN-only on every mutation** | They had zero auth guards (KB even had a literal `// TODO: Add auth guard`) — anyone could crawl/delete the knowledge base, trigger `manualIndex` (SSRF surface), or CRUD on-call shifts. Matched the existing `ConfigController`/`AgentsController` pattern: class-level guard + per-mutation `if (agent.role !== 'ADMIN') throw new ForbiddenException(...)`. Read-only `GET` routes (`kb/status`, `kb/sources`, `shifts`) require auth but not ADMIN. (2026-06-07, plan `you-are-a-senior-wiggly-piglet` T1.1) |
| **`worldgraph/atlas.world.json`: single `connects: string[]` per node** (mirrored into `index.<label>.connects`, equality-checked by `validate.ts`) instead of the plan's literal "union of typed reference arrays" | 105 hand-authored nodes — one explicit array per node is far less bookkeeping than per-kind typed-array unions, while a generic recursive label scan still catches dangling refs and the index/node duplication is validator-enforced. (2026-06-15) |
| **`worldgraph/pnpm-workspace.yaml` with `packages: ["viewer"]`** | Without it, `cd worldgraph && pnpm install` was absorbed into the root pnpm workspace (no isolated `node_modules`/lockfile). This file makes `worldgraph/` its own pnpm workspace root, isolating its deps (and `viewer/`'s) from the monorepo's `pnpm-lock.yaml` entirely. (2026-06-15) |
| **Single shared SSRF guard** — `apps/api/src/common/net/assert-public-url.ts` (`assertPublicUrl` + `fetchPublic` + `readBodyCapped`) | Three server-side `fetch()`s of admin/config-supplied URLs (`config.service.extractBrand`, KB crawler `fetchPage`/`fetchRobotsSitemaps`/`fetchSitemapUrlsWithLastmod`) had no protection against internal targets (loopback, link-local incl. `169.254.169.254`, RFC1918 ranges, `localhost`), non-`http(s)` schemes, redirect chains, or oversized bodies. One module now: resolves the hostname via DNS at call time (covers DNS-rebinding), rejects private/loopback/link-local ranges + non-public schemes (`http` allowed only outside `production`), and `fetchPublic` re-validates every redirect hop (capped at 3) and caps response bytes (5 MB) via `readBodyCapped`. (2026-06-07, plan `you-are-a-senior-wiggly-piglet` T1.2) |
| **Portal reply ack to customer, not self-addressed mirror** — `sendPortalReplyAck` replaces `sendPortalReplyCopy` | Self-addressed mirrors were awkward: the customer's portal message was quoted back at them in a later agent reply, and the mirror only landed in the support inbox. A direct "Received your response" ack To the customer puts the portal message in the thread on both sides cleanly. Agent/bot reply emails also drop all quoted history — the thread is in the email client's native chain. (2026-06-16) |
| **Dropdown `value` is a frozen key; UI resolves `value → label` everywhere** (`apps/bridge/src/lib/useFieldConfig.ts`) | `Ticket.field1/field2` and analytics `groupBy` key on the option `value`, never the label. The ticket sidebar + both analytics dashboards were showing the raw value (e.g. `google-sheets`); they now resolve to the configured label via the shared `useFieldConfig`/`labelForValue`. Branding form derives `value` from the label (`slugify`) for **new** options only and freezes persisted keys, so a label rename is cosmetic + retroactive (no migration). Considered collapsing to labels-only — rejected: renaming would orphan existing tickets. Deleting an in-use option is gated by `GET /config/field-usage` (admin) counts. (2026-06-22) |
| **Production deploys via PM2 (`ecosystem.config.cjs`), Docker dropped** | The `docker/` dir (3 app Dockerfiles + `docker-compose.yml` + `nginx.conf`) was removed. The three Node apps now run under PM2 on the host (`athena-api`:3001, `athena-portal`:3000, `athena-bridge`:3002); reverse proxy + TLS handled at the server level. Postgres (pgvector) and S3-compatible object storage are provisioned separately and wired via root `.env` (MinIO is dev-only; prod points `S3_*` at the E2E S3 endpoint over HTTPS). The app Dockerfiles were already broken anyway (`Dockerfile.dashboard` referenced the non-existent `apps/dashboard`, and copied `.next/standalone` though neither Next app sets `output:'standalone'`). Docker is still required for the **test** suite (Testcontainers spins up ephemeral pgvector+MinIO) — that's the Docker *daemon*, not a deployment artifact, and was kept. Runbook: `DEPLOY.md`. (2026-06-23) |
| **GitHub label/state change → `Ticket.githubUpdatePending` attention flag, NOT `TicketStatus`** | The webhook now reacts to all `issues` label/state actions on a linked issue (was: only `fix-deployed` → notification). It raises a dedicated boolean flag + `githubUpdatedAt` and lets the agent decide the real next step. Injecting a GitHub state into the workflow `TicketStatus` enum would corrupt analytics buckets, bot logic, and kanban columns that all read `status`. The flag clears on `POST /tickets/:id/github/acknowledge` or the next agent `findById` (portal reads never clear it). (2026-06-22) |
| **`GithubIssueEvent` table (not a JSON column on `GithubIssue`)** | The linked-issue activity timeline is append-only and ordered; a relational row keeps `create` atomic under GitHub's near-simultaneous webhook deliveries (a read-modify-write JSON append would race) and stays queryable. Mirrors `BotInteraction`/`CustomerSignal`. (2026-06-22) |
| **Label config + agent→GitHub push removed entirely** | Dropped `AppConfig.fixDeployedLabel`/`pendingConfirmationLabel`, the `PATCH /github/webhook-config` label endpoint, the "Mark pending confirmation" button (`POST /tickets/:id/github/pending`), the `/github` "Action needed" page, and the `GITHUB_FIX_DEPLOYED` notification type (→ `GITHUB_ISSUE_UPDATED`). A label is purely an inbound signal now; the old config/round-trip flow added surface for no benefit. Acknowledge lives on `TicketsController` (mutates `Ticket`, rides `findById`). (2026-06-22) |
| **`GithubIssue.labels` stored as `{name,color}[]` from the webhook payload** | GitHub includes `label.color` (hex) on `issues` events, so the dashboard renders real label colours without inventing any (respects the design-token rule). Trade-off: a recolour with no subsequent issue event can leave a stale colour until the next sync. (2026-06-22) |
| **IMAP IDLE client** replaces smtp-server inbound listener              | `ImapClientService` reads from org's existing inbox via IMAP IDLE, no MX changes needed                                           |
| **VERP signed reply tokens** for threading                              | `reply+<emailThreadId>.<hmac8>@<domain>` — signed with AES-256-GCM key from `EMAIL_CREDS_KEY` env                                 |
| **IMAP/SMTP creds stored encrypted in AppConfig**                       | AES-256-GCM via `credentials-cipher.ts`; never returned plain on GET; password-set boolean returned instead                        |
| **`TransformResponseInterceptor` always wraps** in `{ data: ... }`      | Previous passthrough logic caused double-unwrap bugs in list responses                                                             |
| **`Ticket.number` removed → `ref` (7-char Crockford base32)**           | Opaque, URL-safe code; `number` leaked sequential DB counts; `ref` never null (generated at creation for conversations too); display gated on `isTicket` |
| **`Ticket.isTicket Boolean @default(false)`**                            | Inbound email rows land as conversations (`false`); convert sets `true`; invariant `isTicket=false ⇔ status ∈ {NEW,DISMISSED}` |
| **`User.category` set once on first email, never overwritten**           | First-email bulk signal is highest-fidelity; subsequent emails don't mislabel real customers who got one promo in a thread |
| **`Tag.name` is `@unique`**                                             | No org scope means tags are global                                                                                                 |
| **Connector field is a dropdown** (not free text)                       | Better UX; maps to a fixed connector_map list                                                                                      |
| **Destination field** (was "product") trimmed to Hub/Sheets/Data Studio | Per product decision                                                                                                               |
| **GitHub webhook uses rawBody**                                         | NestJS `rawBody: true` enabled for HMAC-SHA256 signature verification                                                              |
| **Notifications are global** (all agents see all)                       | No per-agent scoping; assignment is for tracking only, not access control                                                          |
| **`fix-deployed` / `pending-customer-confirmation` label names**        | Configurable via Settings → GitHub → Label Configuration                                                                           |
| **`NEXT_PUBLIC_*` vars loaded via dotenv in next.config.ts**            | Next.js only reads `.env` from its own project dir; monorepo root `.env` loaded explicitly via dotenv in both apps                 |
| **Light/dark theme via `data-theme` attribute on `<html>`**             | CSS variables override on `html[data-theme="light"]`; dark is default and completely unaffected; preference stored in localStorage |
| **GitHub OAuth callback at `/settings/github/callback`**                | Must be registered as Authorization callback URL in GitHub OAuth App settings                                                      |
| **Logging: winston `WinstonLogger` → daily-rotate file + GCP Cloud Logging** (replaced hand-rolled `FileLogger`) | Wired as the Nest app logger in `main.ts`; mirrors `tmr_data_service/src/configs/logger.ts`. **No console transport** — output goes only to `apps/api/logs/app-YYYY-MM-DD.log` (preserving the exact `{ts,level,context,msg}` shape the CLAUDE.md `jq` debugging command parses) and to GCP. GCP creds via `GOOGLE_CLOUD_CREDENTIALS_PATH` keyFile (always-on but **non-fatal** — a missing/invalid key file logs to stderr via `defaultCallback` and never crashes the app). 256KB protobuf cap handled by porting `log-truncation.ts` + a `reduceLogInfoSize` guard. Keeps NestJS `ConsoleLogger` signatures so all 36 `new Logger(ctx)` call sites are unchanged. (2026-06-22) |
| **Gemini 2.0 Flash for all AI operations**                              | Cheap ($0.075/$0.30 per 1M tokens) + fast for classification; no guardrails in Phase 1 — observe-only; see `docs/atlas/ai.md`     |
| **AI analytics observe-only (no budget caps)**                          | Per user decision: visibility first, controls later once real spend numbers are known                                               |
| **`firstResolvedAt` is immutable — set once, never overwritten**        | Preserves original resolution time even if ticket is reopened and resolved again                                                    |
| **`/analytics` → redirect to `/analytics/operations`**                  | Preserves existing bookmarks/links while adding the new `/analytics/customers` sub-route                                           |
| **Email-card format is Bridge-only; portal keeps chat bubbles**          | Portal is customer-facing — chat bubbles feel friendlier and match the portal's light-theme aesthetic. The new email-card format suits the agent tool. `MessageCard` is in `apps/bridge/` only, not `packages/ui`. |
| **Maintenance mode: master overrides individual feature flags**          | `maintenanceMode=true` suppresses all five automated features regardless of their individual flags; individual flags only matter when master is OFF. Guard rule: `isFeatureSuppressed(config, feature)` in `apps/api/src/modules/config/feature-flags.ts`. (2026-06-14) |
| **Bot suppressed = leave for humans silently**                           | When `botReply` is suppressed (maintenance or flag), the bot does NOT write a BotInteraction, does NOT escalate, and does NOT post any note — ticket stays NEW/unassigned for humans. Silent skip only. (2026-06-14) |
| **Tags: fixed color palette (8 colors), any agent manages, agent-only** | Tags are agent-facing productivity — no Portal exposure. Fixed palette keeps UI consistent; no admin gate needed since tags have no security sensitivity. `tags_changed` SYSTEM_EVENT is `isInternal:true` so portal `isInternal=false` filter already hides it. (2026-06-19) |
| **Tags: `Tag.orgId` drift fixed by migration `20260619000000_tag_drop_orgid`** | Initial migration created `orgId NOT NULL` + `(orgId,name)` unique index; schema.prisma was already single-tenant (no orgId) but no reconciliation migration was ever added. Inserts would fail at runtime. Fixed by dropping the column and creating `Tag_name_key`. (2026-06-19) |
| **Canned responses: one shared library, any agent, HTML body, no variables** | Shared library avoids per-agent clutter. HTML stored as-is (authored by trusted agents, inserted into agent composer only — never sent to Portal). No variable placeholders in v1 (adds complexity; defer). (2026-06-19) |
| **Bridge uses a `(dashboard)` route-group layout for the persistent sidebar; pages render content only** | Every dashboard page used to render the whole shell itself (`<div flex><DashboardSidebar/><main/></div>`), so sibling navigations (e.g. Inbox→Analytics) tore down and remounted the sidebar and held the old page painted until the new client page fetched its data — visible flicker + repeated `/tickets/stats`, `/github/status`, `/config` fetches. A `(dashboard)/layout.tsx` now renders the sidebar + outer flex once; pages and `loading.tsx` files render only the `<main>` content slot. Route groups don't change URLs. (2026-06-20) |
| **Canned responses: slash command `/name` in composer (not a separate button)** | Slash command is minimal UI surface, discoverable without cluttering the toolbar, and works for both reply and note tabs. Picker positioned near caret via Selection/getBoundingClientRect. (2026-06-19) |
| **CSAT survey is its own toggle** (`featCsatSurvey`)                    | Separate from `featAiAnalysis` — operators may want AI classification running but no survey emails, e.g. during incident windows. Five individual flags total. (2026-06-14) |
| **Bridge renders `bodyHtml` preferentially** (parity with Portal); quoted HTML history collapsed via `splitQuotedHtml()` (`div.gmail_quote` / `blockquote[type=cite]` detection) | Customer/agent replies in Bridge only rendered the plain-text `body`, so Gmail signatures/tables/images were lost. Worse, `isHtmlBody()`'s any-tag regex misdetected Gmail plain-text autolinks (`<https://…>`) as HTML, pushing the body through `dangerouslySetInnerHTML` and flattening it onto one line. `isHtmlBody()` now matches a known-tag allowlist. (2026-06-10, plan `when-a-email-received-soft-abelson`, R199/R200) |
| **GraphProvider `bodyPlain` via structure-preserving `htmlToText()`** (`email-sync/util/html-to-text.ts`, no new dependency) | The old naive `replace(/<[^>]*>/g,' ')` + collapse-all-whitespace flattened the whole email onto one line in the stored `Message.body`. (2026-06-10, R201) |
| **atlas-gen: enum-typed Prisma fields are columns, not relations, in the generated ERD** | The generator classified any uppercase non-scalar type as a relation and the ERD emitter skipped relation fields — every enum column (`Ticket.status`, `CustomerSignal.type`, …) was silently missing from `_generated/erd.md`. Enum names are now pre-scanned and excluded from relation classification. (2026-06-10, R202) |
| **E2E simulates the mail server at the provider seam (`/__test/ingest-email` + captured-mail)** | Real-Gmail smoke testing stays manual; the test endpoint builds a `ParsedThread`, creates a fake `IMailProvider`, and calls the production `ThreadIngestionService` — all downstream logic (dedup, G3 transitions, SSE, bot) is production code. (2026-06-10, plan `when-a-email-received-soft-abelson`) |
| **Bot disabled in E2E via absent `GEMINI_API_KEY` + no `botApiKeyEnc` in seed** | `BotService.respondTo()` catches embedding errors and writes a `BotInteraction` with `didAnswer=false` — does not crash or leave a retrying pg-boss job. E2E flows assert nothing about bot behavior. (2026-06-10) |
| **Portal ticket thread redesigned to Zendesk-style (uniform cards)**    | Chat bubbles (blue customer / left-border agent) replaced with fully symmetric left-aligned threaded cards at 1180px width. Motivation: wider monitors had empty margins; asymmetry felt inconsistent on long tickets. Both customers and agents now see the same structure (avatar + name + body + attachments + divider). Accent reserved for customer avatar fill and the Support badge only. |
| **Attachment fix at the data layer (not the UI layer)**                  | Portal and Bridge renderers already read `msg.attachments` correctly — the data just never arrived. Fixed three root causes: (1) `MessagesService.create()` now links `attachmentIds` via `updateMany` inside the transaction; (2) `GmailProvider.parseGmailMessage()` now extracts `payload.parts` attachments; (3) `ThreadIngestionService` fetches and stores each inbound attachment via `FilesService.storeBuffer()`. |
| **`attachment.updateMany` guards: `ticketId` + `messageId: null`**      | Prevents cross-ticket attachment hijacking and prevents re-linking an attachment already owned by another message. Both checks run inside the same DB transaction as the message create. |
| **Email attachment fetch runs outside the DB transaction**               | `GmailProvider.fetchAttachmentBytes()` makes an HTTP call. HTTP calls inside Postgres transactions can hold a DB connection for seconds and cause lock waits. Attachment list collected inside the transaction; HTTP fetch + MinIO upload happen after the transaction commits. |
| **Email verification is a soft gate** — signup signs the user in immediately; unverified users see a persistent `VerificationBanner` instead of being blocked | Matches the low-friction support-ticket use case — customers shouldn't be locked out of filing a ticket over an unverified email. (2026-06-14, plan `in-portal-signup-flow-enumerated-clarke`) |
| **`MagicToken.type: MagicTokenType` (`EMAIL_VERIFICATION` \| `PASSWORD_RESET`)** reuses one model for both verification and password-reset tokens | Both are single-use, time-limited, link-based tokens with the same shape — a second model would just duplicate the cleanup/expiry/used-at logic. (2026-06-14, plan `in-portal-signup-flow-enumerated-clarke`) |
| **`SendVerificationWorker` / `SendPasswordResetWorker` bypass `isFeatureSuppressed`/`maintenanceMode`** | Email verification and password reset are core auth flows, not "automated features" — they must keep working even when maintenance mode suppresses bot/CSAT/AI email features. (2026-06-14, plan `in-portal-signup-flow-enumerated-clarke`) |
| **`POST /auth/forgot-password` always returns 200** regardless of whether the account/password exists | Prevents account enumeration via response status; the portal `/forgot-password` page shows the same "Check your email" confirmation either way. (2026-06-14, plan `in-portal-signup-flow-enumerated-clarke`) |
| **`attachment.updateMany` guard allows `ticketId: null` OR ticket match** | Freshly-uploaded files have `ticketId: null` (uploaded before being associated to any ticket). The original guard `ticketId: ticketId` (exact match only) blocked all reply-composer uploads because the attachment had never been pre-scoped. Fixed to `OR: [{ ticketId }, { ticketId: null }]`; `ticketId` also written into `data` so it is set correctly when a null-scoped attachment gets linked. |
| **`ZodValidationPipe` on `@Body` is incompatible with multipart uploads** | NestJS pipes run before the method body. When Multer processes a multipart request, it sets the body to `{}`. Wrapping `@Body` with `ZodValidationPipe(uploadLinkSchema)` causes Zod to validate `{}` against the `linkUrl`-required schema and throw — before the method even inspects the uploaded file. Fix: remove the pipe from `@Body`, parse `rawBody` manually inside the method only on the link-upload path. |
| **Portal auth page supports two layouts (MINIMAL default / BRANDED opt-in)** | MINIMAL works out-of-the-box with just `logoUrl` + `appName`; BRANDED requires headline + ≥1 feature to save. Server-side validation in `updateAppConfigSchema` mirrors client-side rules. |
| **Testimonial block deliberately excluded from BRANDED layout**          | Kept the scope minimal. Hardcoded fake testimonial (Mia Chen, Northwind) fully deleted. Can be re-introduced later if operators request it. |
| **Portal Google OAuth wired against existing `POST /auth/google` backend** | Reuses the same Google OAuth client as agent flow; only adds `/auth/google/callback` as a new redirect URI. State nonce in `sessionStorage` for CSRF protection. Callback mirrors Bridge GitHub OAuth callback pattern. |
| **OAuth callback handled by NestJS API, not Bridge**                     | Avoids the auth code appearing in Bridge request logs; API exchanges it server-side then redirects browser to Bridge with `?connected=1`. Cleaner security boundary. |
| **180-day default backfill, triggered automatically on OAuth connect**   | Gives agents a populated inbox immediately; long enough to capture most active threads. "Pull full archive" (sinceDays: 'all') available manually post-connect. |
| **Backfill jobs at `priority: 0`, live mail at `priority: 10`**          | pg-boss pops higher-priority first — a live customer reply mid-backfill jumps the entire backfill queue, keeping Bridge responsive. |
| **No AI pipeline on backfill messages**                                  | Prevents surprise cost spikes on potentially thousands of historical messages. "Run AI on imported emails" endpoint gives explicit control back to the admin. |
| **Dedicated IMAP client for backfill (separate from IDLE supervisor)**   | Prevents race on `mailboxOpen` between IDLE's lock and the backfill range fetch. Backfill client closes after the import finishes. |
| **`OAUTH_CALLBACK_BASE` vs `BRIDGE_URL` separation**                    | `OAUTH_CALLBACK_BASE` = API external URL (must match registered OAuth redirect URI); `BRIDGE_URL` = Bridge URL for post-OAuth browser redirect. Two separate concerns, two separate env vars. |
| **Single Inbox at `/inbox`; `/tickets` list page removed**              | Merged flat inbox + domain-grouped view into one page. `/inbox` is the domain-grouped view. `/tickets/[id]` and `/tickets/domain/[domain]` remain. The old flat list (`/inbox`) is gone. |
| **`useEmailConfig` uses module-level promise cache**                     | Multiple pages mount simultaneously and each would otherwise fire `GET /config` independently. One cached promise ensures a single in-flight request. Cache is invalidated on `refresh()` so the settings page can clear the gate immediately after save. |
| **`useEmailConfig.isConnected` is `oauthConnected` only**               | After IMAP removal there is only one auth method (OAuth). The old `emailAuthMethod === 'PASSWORD'` branch is gone. |
| **`useBackfillStatus` poll uses `Math.max` for seen count**             | Poll response can race with SSE — if DB write hasn't committed when the poll fires, `archiveTotalSeen` would be stale-low. Hook takes `Math.max(polled, current)` so SSE-updated counts are never overwritten by a stale poll. |
| **`archiveTotalEstimate` persisted to DB before processing starts**     | Persisting upfront (before the first chunk) means even the very first poll returns the denominator for the `X / Y` display. Only the foreground phase has a known total (it collects all thread IDs before processing); background archive uses an indeterminate bar. |
| **`processBatch` callback is `async`; DB write is awaited before SSE**  | Fire-and-forget `void db.update()` inside the chunk callback meant SSE could broadcast a count before the DB committed it. The next poll would then return 0, overwriting the UI. Making the callback async and `await`ing the DB write fixes the race. |
| **IMAP fully removed; Gmail REST + Microsoft Graph replace it**         | `imapflow`, `inbound.processor.ts`, `routing.service.ts`, `verp.util.ts`, `backfill.service.ts` (IMAP era), all IMAP/SMTP schema fields deleted. Gmail `history.list` + Graph `messages/delta` give near-identical functionality with zero IDLE connection management overhead. |
| **Single `IMailProvider` interface**                                     | One ingestion pipeline (`ThreadIngestionService`); provider-specific logic isolated in `GmailProvider` / `GraphProvider`. Adding a third provider (e.g. IMAP generic) only requires a new adapter. |
| **At-least-once semantics; checkpoint after batch**                     | Checkpoint (historyId / deltaLink / archivePageToken) persisted to DB **after** the batch is processed. `externalThreadId @unique` + `externalMessageId @unique` make replays safe and idempotent. |
| **AppEventsService bridges OAuth → backfill trigger**                   | `EmailOAuthService.exchangeCode()` emits `OAUTH_CONNECTED`; `EmailSyncBackfillService` listens in constructor. Avoids circular module dependency (EmailSyncModule imports EmailOAuthModule; adding EmailSyncModule as dep of EmailOAuthModule would close the cycle). |
| **`EmailSyncLivePoller` gated by `EMAIL_SYNC_LIVE_POLL=1`**            | Dev environments don't need live polling. Explicit opt-in prevents runaway API calls during local testing. |
| **`Message.customerEmailedAt DateTime?`** nullable watermark (not boolean) for delta-quoting | Records *when* a message's content reached the customer's inbox; matches `analyzedAt`/`deletedAt` conventions. Confirmation/agent-reply emails quote only `customerEmailedAt = NULL` messages (the delta), not the full thread — keeps outbound emails short. Quote/mark logic centralized in `EmailService` (`loadUndeliveredHistory`, `renderQuotedHistory`, `markMessagesEmailed`), not duplicated per worker. No backfill for pre-existing NULL rows — accepted one-time "previous messages" recap on first post-deploy reply. (2026-06-15, plan `in-ticket-flow-i-dreamy-toast`) |
| **Unlimited archive; `threadsTotal` from Gmail profile as estimate**   | Removed the 300-thread foreground cap. `GET /users/me/profile` returns `threadsTotal` which is persisted to `archiveTotalEstimate` before processing starts — gives accurate `X / Y` from the first poll. |
| **`gmailHistoryId` set at archive START (not just end)**               | Setting checkpoint only at end meant emails arriving during a long archive were never picked up by the live poller. Setting it before processing starts ensures the poller catches everything from that point forward once the archive finishes. |
| **Per-thread error isolation in live poller**                          | A single bad thread (`messageId` unique violation, network error, etc.) was throwing out of `pollOne`, preventing the checkpoint from updating — causing infinite re-processing of the same threads on every 30s poll. Each thread now has its own try/catch; checkpoint always advances. |
| **`messagesAdded` checked first in Gmail History API response**        | `entry.messages` (summary field) is not always populated by Gmail. `entry.messagesAdded[].message` is the reliable field for new inbound messages. Both are now checked (messagesAdded first) for full coverage. |
| **In-Reply-To matching for portal ticket replies (3-level lookup)**    | Portal tickets have no `externalThreadId`. When a customer replies, the live poller would create a duplicate ticket instead of threading to the original. Fix: (1) match by stored agent-reply `messageId`, (2) parse `<ticket-{emailThreadId}@domain>` synthetic IDs from the confirmation email. Both paths stamp `externalThreadId` for future fast-path hits. |
| **RFC `messageId` dedup before `message.create()`**                   | Gmail includes the same email twice in a thread (Inbox copy + Sent copy) with different Gmail message IDs but identical RFC `Message-ID`. Added pre-create check `findUnique({ where: { messageId } })` to skip the duplicate before hitting the `@unique` constraint. |
| **File logger (`ConsoleLogger` + daily rotating file)**                | `FileLogger` in `apps/api/src/common/logger/` extends `ConsoleLogger`, writes JSON lines to `apps/api/logs/app-YYYY-MM-DD.log` with daily rotation. Wired as NestJS app logger in `main.ts`. Allows post-hoc debugging without attaching to the terminal. |
| **Cancel/Resume preserves `archivePageToken`**                         | The "Resume" button previously called `startForeground()` which reset `archivePageToken: null` → restarted from beginning. New `POST /sync/archive/resume` endpoint sets status back to `RUNNING` without touching pageToken or totalSeen — archive continues from where it left off. |
| **Ticket `createdAt`/`updatedAt` from actual email dates**             | Archive was stamping all tickets with the DB insertion time (today). Imported tickets now get `createdAt = firstMessage.sentAt`, `updatedAt = lastMessage.sentAt`. Existing-ticket updates set `updatedAt` to the latest new message's `sentAt`. Fixes both the ticket detail timestamp display and inbox sort order (new portal tickets always float to the top). |
| **SSE over WebSockets**                                                  | One-directional push is all we need. SSE is simpler, HTTP/1.1 compatible, works through most corporate proxies without configuration. |
| **JWT in SSE query param**                                               | `EventSource` API doesn't support custom headers. Token verified inline in `SseController`, not logged. |
| **`@Global()` EventsModule; `setSseService()` for circular avoidance**  | `ThreadIngestionService` (in EmailSyncModule) and `EmailSyncBackfillService` need to broadcast SSE but can't import EventsModule directly without creating a cycle. `setSseService(sse)` method called in `onModuleInit` by EventsModule sidesteps this. |
| **sseEventBus is in-process only**                                      | No Redis pub/sub. Sufficient for single-process; a multi-process deployment would need an external broker or sticky sessions. |
| **pgvector in existing Postgres for bot knowledge base**                 | Zero new infra; help-center corpus is small (hundreds–thousands of pages); HNSW index provides sub-millisecond vector search at this scale |
| **pg-boss queue for bot response (async)**                              | Ticket creation endpoint stays fast; bot runs ~3–8s in background; async also makes retries and idempotency straightforward |
| **Hybrid dense+sparse retrieval with RRF**                             | Pure pgvector misses exact product names, error codes, version numbers; FTS handles those; RRF fuses both lists |
| **FTS (not pg_trgm) for sparse arm**                                   | pg_trgm `similarity(text, 'how many accounts can I connect')` matched connector pages (trigram 'connect' ≈ 'connection') ahead of the Pricing page. `websearch_to_tsquery` is topically correct — it matches document terms, not substring trigrams |
| **Dense cosine gate (0.55) replaces RRF score gate (0.01)**            | RRF scores are bounded by ~0.033 and not interpretable. Dense cosine on L2-normalised gemini-embedding-001 vectors is bounded by [0,1] and directly measures semantic relevance; 0.55 cleanly separates relevant from noise at current corpus scale |
| **Embedding taskType asymmetry (RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY)** | gemini-embedding-001 produces better aligned representations when the model knows the usage intent at embed time; documents and queries are in different distribution spaces |
| **Contextual retrieval (Anthropic 2024 pattern)**                      | One Gemini Flash call per page generates a doc-level summary prepended to every chunk; lifts recall 35–50% at trivial cost ($0.06 for 5000-chunk corpus) |
| **Context header deferred to Phase B (embed), not Phase A (scan)**     | Phase A now makes zero Gemini calls — scan is purely fetch+chunk+persist. Context header generated once per source at embed time. `estimatePendingCost()` includes the summary call cost so the confirm screen shows one honest total |
| **Chunk MAX_TOKENS 800→350, MIN_TOKENS 200→100**                      | Pricing page's ~850-token chunk buried the pricing table so its dense embedding was diluted. Finer chunks make plan-level facts (e.g. "Pro: 50 accounts per connector") their own discrete vector |
| **Parallel crawl (CONCURRENCY=6) replaces sequential+1s delay**        | Sitemap path was `pages × (fetch + LLM + 1s)`; now `ceil(pages/6) × fetch`. No quality loss — `onPage` callback still runs per page |
| **True incremental mode via `<lastmod>` (not just content-hash)**      | Previous incremental mode fetched every page then skipped on content-hash match. Now pages with `lastmod ≤ source.fetchedAt` are skipped before fetching |
| **robots.txt sitemap discovery**                                        | Help center sitemaps aren't always at `/sitemap.xml`. Reads `Sitemap:` directives from robots.txt first, then falls through to hardcoded candidates |
| **SSE broadcast from BotService after reply/escalation**               | Bot wrote its message directly to DB but never called SseService. Bridge received Athena's reply on the next 10s poll instead of immediately. Now broadcasts `message-created` (reply) and `ticket-updated` (escalation) events |
| **Safety overrides: empty citations + foreign-origin citations → escalate** | Belt-and-suspenders against hallucination; Gemini JSON mode enforces schema but explicit guards ensure no answer ships without valid KB citations |
| **`AgentRole.AGENT` → `PRIMARY_AGENT`**                                | Semantically correct; all existing agents remain assignable as first responders; admins can demote to `SECONDARY_AGENT` later |
| **`botApiKeyEnc` excluded from getSafe()**                             | Follows same redaction pattern as `oauthAccessTokenEnc`; API returns `botKeySet: boolean` instead |
| **Bot message uses `authorBotName` not `authorAgentId`**               | No phantom agent row needed; display name is configurable; portal/bridge branch on `authorBotName !== null` |
| **Guest token allowed for real-account emails (A4 fix)**               | Previously returned 409; new behavior issues a guest token bound to the existing user ID but does NOT flip `user.isGuest`. `NoGuestsGuard` applied to `GET /tickets` (and similar list endpoints) blocks guest tokens from browsing account history. Prevents lockout for TMR customers trying to submit a support ticket. |
| **`Ticket.product`/`Ticket.connector` renamed to `field1`/`field2`**  | Makes dropdowns brand-configurable. Labels and option lists live in `AppConfig.field1Label`, `field1Options`, `field2Label`, `field2Options` (Json arrays). Portal uses `OptionSelect` component driven by config; Bridge displays the stored values directly. |
| **Dropdown options store `value` keys, not display labels**            | Labels may change; stored `value` is stable. Display label is resolved from the current `field*Options` array at render time. Fallback: show raw value if no matching option found. |
| **`useEmailConfig` cross-instance invalidation via module-level listener set (A3)** | `layout.tsx` and `email/page.tsx` mount separate instances of `useEmailConfig`. A module-level `Set<() => void>` lets any instance call `invalidateEmailConfigCache()` and have all instances re-fetch. Eliminates the stale "Connected" badge after OAuth disconnect. |
| **Shared `applyReplyTransition()` utility (G3)** | Status-machine logic for inbound replies was copy-pasted between `MessagesService` (portal path) and `ThreadIngestionService` (email path). Extracted into `apps/api/src/modules/tickets/util/apply-reply-transition.ts`. Both paths now call the same utility inside the same Prisma transaction — identical behavior for OPEN→IN_PROGRESS, IN_PROGRESS→WAITING, WAITING→IN_PROGRESS, and RESOLVED/CLOSED→IN_PROGRESS+reopen. (2026-06-10, plan `when-a-email-received-soft-abelson`) |
| **Confirmation email via pg-boss queue, not direct call (G2)** | `activateTicket()` previously called `EmailService.sendTicketConfirmation()` synchronously, blocking the HTTP response for SMTP latency (~200ms+). Now enqueues `email:send-confirmation` (3× retry, 30s backoff). `SendConfirmationWorker` checks `confirmation_sent:` SYSTEM_EVENT for idempotency before sending. (2026-06-10) |
| **Portal reply email mirror via `kind: 'portal-copy'` (G1)** | Portal-submitted customer replies are mirrored to email (self-addressed copy) so the email thread stays current. `MessagesService` enqueues a second job with `kind: 'portal-copy'`; `SendReplyWorker` branches on this field and calls `sendPortalReplyCopy()`. RFC messageId stored on the portal Message row so the poller's `@unique` dedup guard drops the self-copy on the next cycle. Gated by `AppConfig.mirrorPortalRepliesToEmail`. (2026-06-10) |
| **Bounce detection before user upsert (G4)** | `mailer-daemon`/`postmaster` senders are intercepted before the `user.upsert()` block in `ThreadIngestionService.fetchAndUpsertThread()`. No phantom User row for delivery systems. Matched bounce writes `email_delivery_failed:bounce` SYSTEM_EVENT + sets `User.emailStatus = BOUNCING`. Unmatched bounce falls through to normal ingest. Regex `[a-z0-9][a-z0-9-]*` in synthetic-pattern lookup ensures hyphenated `emailThreadId` values match correctly. (2026-06-10) |
| **Graph attachments stored in Gmail-named ParsedAttachment fields (G5)** | `ParsedAttachment.gmailMessageId` / `gmailAttachmentId` are provider-opaque (named for Gmail historically). Graph stores its own message/attachment IDs there rather than adding new interface fields. `'fetchAttachmentBytes' in provider` duck-type check lets `ThreadIngestionService` use both adapters without branching. (2026-06-10) |
| **Inbox uses SSE as primary signal, 60s poll as fallback (G6)** | Inbox previously polled every 15s. Now subscribes to `ticket-created`, `ticket-updated`, `message-created` SSE events with 300ms debounce. The `setInterval` fallback stretched to 60s — it only fires if the SSE connection dropped silently (some corporate proxies buffer SSE). (2026-06-10) |
| **pg-boss `newJobCheckInterval: 100` in test mode** | Default pg-boss v9 polling interval is 2000ms. Queue integration tests (R112) need pg-boss to process jobs quickly; a 100ms interval in `NODE_ENV=test` is enough without timing-sensitive sleeps. (2026-06-10) |
| **Operations analytics scoped to `isTicket=true` only** | All operational metrics (volume, FRT, resolution, SLA, category, priority, agent performance) now use `REAL = { deletedAt: null, isTicket: true }`. Conversations (`NEW`) and dismissed rows are excluded — they were inflating numbers and made the KPIs incoherent (open/resolved counted different universes). (2026-06-14) |
| **Agent FRT clock start = bot escalation time (not ticket.createdAt) when bot engaged** | Counting triage delay against FRT is unfair to agents when the bot ran first. Clock starts at the `BotInteraction.createdAt` with `didAnswer=false`; falls back to `ticket.createdAt` if no bot interaction. This is per-ticket (not a global flag) so historical tickets are correct even if the setting changed. (2026-06-14) |
| **`Ticket.convertedAt` stamped in `convert()`** | Enables Time-to-Triage metric (`convertedAt − createdAt`). Portal tickets never pass through `convert()` so `convertedAt` is null for them (portal tickets start as `isTicket=true`). Analytics service filters `convertedAt NOT NULL` before computing the median. (2026-06-14) |
| **`AppConfig.slaFirstResponseHours = 4` (read-only, no UI yet)** | SLA target is instance config, not a hard-coded constant in the service. Defaults to 4h; settable via DB; full Settings UI is a follow-up. (2026-06-14) |
| **Resolution time uses `firstResolvedAt`, not `:RESOLVED` message scan** | The old code text-scanned message bodies for the magic string `:RESOLVED` and labeled the result "median" while computing a mean. Replaced with direct read of `Ticket.firstResolvedAt` (already set by the status-machine when a ticket first enters RESOLVED). (2026-06-14) |
| **Gmail sends now use Gmail REST API, not SMTP XOAUTH2** | SMTP XOAUTH2 required the `https://mail.google.com/` scope (full mailbox control). Gmail REST API `users.messages.send` uses narrow `gmail.modify + gmail.send`. Nodemailer still builds MIME; raw RFC 2822 buffer is base64url-POSTed. Existing connected accounts must re-consent. Microsoft SMTP path is unchanged (parked). (2026-06-14, plan `in-this-app-we-nested-squirrel`) |
| **Gmail send errors always propagate — no silent swallow** | `sendAgentReply`, `sendPortalReplyCopy`, `sendTicketConfirmation` previously caught errors internally and returned null/void, making the workers' retry + `email_delivery_failed` logic dead code. All three now throw on failure. Workers already have correct catch blocks. (2026-06-14) |
| **Sync dispatcher/importer split via pg-boss queue** | Live poller was monolithic: fetch → ingest in-process → advance checkpoint only if all succeeded. A single permanently-failing thread jammed the entire inbox. Now: dispatcher enqueues one `email:ingest-thread` pg-boss job per thread, then always advances the checkpoint. `IngestThreadWorker` handles ingestion with per-job retry (5×). Dead-lettered jobs surface at `GET /sync/health`. (2026-06-14) |
| **Live poll default-on** | `EMAIL_SYNC_LIVE_POLL === '1'` was the gate — absent (the default) meant sync was off. Changed to default-on: `EMAIL_SYNC_LIVE_POLL !== '0'` enables polling. Set `EMAIL_SYNC_LIVE_POLL=0` to disable. (2026-06-14) |
| **Delete ticket action removed** | `DELETE /tickets/:id` (soft-delete, ADMIN only) removed. `findById()` now guards `deletedAt: null`. Previously the delete action existed but didn't prevent the ticket from being viewable (R101 known bug). Resolves the bug cleanly by removing the action. `deletedAt` column retained. (2026-06-14) |
| **Confirmation SYSTEM_EVENT carries RFC messageId** | After `sendTicketConfirmation` sends, the `confirmation_sent:` SYSTEM_EVENT row is written with `messageId = <ticket-{emailThreadId}@domain>`. Customer replies to the confirmation are now matched at Level 2 (RFC Message-ID lookup) instead of falling through to Level-3 regex. (2026-06-14) |
| **Bounce pattern widened** | `BOUNCE_PATTERN` extended from `mailer-daemon|postmaster` to also catch `bounce|bounces|noreply|no-reply|no.reply|donotreply|do-not-reply|auto-reply|autoreply`. Bounce handler failure is now logged at WARN rather than being silent. (2026-06-14) |
| **SSO handoff uses HMAC shared secret (HS256) over OIDC/SAML** | Single-tenant, first-party host only. HMAC mirrors Intercom's identity-verification model; simpler than OIDC/SAML for self-hosted single-tenant use. RS256 for untrusted third-party hosts deferred to v2. (2026-06-17, plan in-this-app-for-composed-puppy) |
| **SSO replay protection via `SsoUsedToken` table** | Single-column table keyed on `jti` (primary key). A direct `create()` followed by catching `P2002` (Prisma unique constraint violation) detects replays without a TOCTOU race. Row TTL cleanup (cron delete past `expiresAt`) deferred to v2. (2026-06-17) |
| **SSO `externalId` lookup order: externalId → email (backfill) → create** | Prevents duplicate accounts when a user first signed up via portal (no externalId) and later arrives via SSO. On email-only match, `externalId` is backfilled so subsequent SSO logins hit the fast path. (2026-06-17) |
| **AI/analysis features gated on `isTicket=true`; sentiment was leaking onto NEW conversations** | `ThreadIngestionService` enqueued `ai:analyze-message` for every inbound email regardless of `isTicket`. Raw `NEW` conversations and `DISMISSED` rows now receive no AI processing. Guards at every enqueue point (`ThreadIngestionService`, `MessagesService`, `TicketsService`) plus defense-in-depth inside the workers (`AnalyzeMessageWorker`, `ClassifyTicketWorker`). On `convert()`, prior unanalyzed customer messages are retroactively queued for sentiment (idempotent). Customer-intelligence analytics (`CustomersService`) scoped to `isTicket=true` across all queries. (2026-06-18, plan `great-one-thing-these-hazy-seahorse`) |
| **Brand accent switched blue→orange `#FF6700` dashboard-wide; inbox hierarchy redesign** | All `--d-accent`/`--d-accent-hv`/`--d-accent-bg` tokens updated to orange in both dark `:root` and light override. Full `--d-*` token palette tuned to spec. Status/category pills restyled to alpha-tint approach (works in both themes — light overrides collapsed). Inbox rows restructured to 4-column grid (gutter + avatar + content + meta). Group header promoted to dominant banner with `--d-raised-2` background and `--d-headline` divider. `CategoryPill` changed from filled chip to colored dot+label globally. `CLOSED`/`DISMISSED` statuses map to new `.d-closed` pill class. Nav rail gets `--d-rail` surface. Pure visual change — no data/API/logic changes. (2026-06-20, plan `okay-i-made-a-sprightly-kazoo`) |

---

## Where the per-feature reference lives

The current-state docs (how each feature works, what stack it uses, key files,
flow diagrams) live in [`docs/atlas/`](docs/atlas/). One file per feature.

STATE.md (this file) tracks **history**: architecture decisions, known issues,
session-by-session changelog. If you want to know how something works *today*,
read the atlas. If you want to know how it got that way, read this.

---

## Known Issues / Deferred Work

| Issue                                       | Priority           | Notes                                                                  |
| ------------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| Google OAuth (portal) requires env vars set  | Low                | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` must be set in `.env`; same client as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Also register `{portal-origin}/auth/google/callback` in Google Cloud Console authorized redirect URIs. |
| Inbound email needs real MX record          | Medium             | Works locally if you point MX to your server                           |
| No real-time updates (polling/websockets)   | Medium             | Notifications poll every 30s; no instant push                          |
| File attach in reply (bridge compose)       | Low                | Paperclip button present but `action: undefined`; no upload flow wired |
| Export as CSV (portal)                      | Low                | Button renders; no handler                                             |
| `EMAIL_CREDS_KEY` env var must be set       | Medium             | 64-char hex key required for IMAP/SMTP password + OAuth token encryption; app starts without it but IMAP won't connect |
| OAuth env vars not yet set                  | Medium             | `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_CLIENT_ID/SECRET`, `OAUTH_CALLBACK_BASE`, `BRIDGE_URL` must be configured before OAuth login works |
| `orgs` module still exists on disk          | Intentional        | Gutted stub, never imported; kept on purpose (possible future multi-tenant) — 2026-06-23 |
| Auth token stored in localStorage           | Medium             | Acceptable for internal tool; consider httpOnly cookies for production |
| GitHub Issues analytics dashboard           | Deferred — Phase 2 | Charts: issue volume by destination/connector, resolution time trends  |

---

## Session Log

### 2026-06-23 — Squashed the broken migration history into one baseline

**Problem:** no migration ever created the `AppConfig` table — it only ever existed because of an
old untracked `db push`. Every later migration just `ALTER`s it. So building a DB **from scratch**
crashed at `20260530000000_athena_bot` (`relation "AppConfig" does not exist`). Verified this breaks
**both** `prisma migrate dev` (shadow-DB replay) **and** `prisma migrate deploy` on a fresh DB — i.e.
a first-time production deploy (DEPLOY.md Scenario A) would have failed.

**Fix (safe because production isn't live yet):** replaced the 17-migration history with a single
`packages/db/prisma/migrations/00000000000000_init` baseline that reproduces the current schema.
Generated it from the live dev DB via `prisma migrate diff --from-empty --to-schema-datasource`, then
hand-corrected three things Prisma's generator gets wrong for raw-SQL features: prepended
`CREATE EXTENSION vector`/`pg_trgm`, fixed the generated `tsv` column (`GENERATED ALWAYS … STORED`,
not an invalid `DEFAULT`), and dropped the bogus `ASC` on the GIN index. Reset the dev DB's
`_prisma_migrations` ledger and `migrate resolve --applied` the baseline (no data/schema touched).
Old files backed up under `/tmp` + retained in git history.

**Verified:** `migrate deploy` onto an empty DB applies cleanly; `migrate dev` no longer crashes;
dev DB `migrate status` = up to date.

**Known footnote:** the bot FTS `tsv` column lives outside `schema.prisma` (owned by
`RetrievalService.onModuleInit`, which re-creates it idempotently every boot), so `migrate dev`
will offer a spurious `DROP tsv` in generated migrations — strip those two lines, or it self-heals
on next API boot anyway. Optional permanent silencer: declare `tsv Unsupported("tsvector")?` on
`KnowledgeChunk`.

### 2026-06-23 — Retry transient Gemini failures (bot + AI analysis) instead of escalating/giving up

User reported a bot reply failed. Watched the logs first (per the debugging rule): at `12:24:37`
`GeneratorService.generateAnswer` → `BotService.respondTo` failed with a Gemini **503 "model
experiencing high demand"**, and the ticket immediately escalated to a human (Admin replied manually
9 min later). Root cause: `respondTo`'s catch escalated on the **first** failure without rethrowing,
so the queue's `retryLimit:3` never fired — a momentary upstream blip permanently burned the bot's
attempt. The same 503 hit `AnalyzeMessageWorker` but that path self-healed (it rethrows → pg-boss
retried it).

- **New shared helper** `apps/api/src/common/ai/transient-error.ts` → `isTransientGeminiError(err)`.
  Duck-typed (numeric `status` ∈ {408,429,500,502,503,504} → transient; else a network/abort/timeout
  message regex), **not** `instanceof` on the SDK error classes — dependency-free and robust across
  module/bundler realms. 4xx, zod/JSON parse failures, and plain errors are terminal.
- **Bot** (`bot.service.ts` + `respond-to-new-ticket.worker.ts`): worker registers with
  `{ includeMetadata: true }` and threads `isFinalAttempt = job.retrycount >= job.retrylimit` into
  `respondTo(ticketId, { isFinalAttempt })`. The catch rethrows transient errors while retries remain
  (pg-boss retries with backoff) and escalates only on a terminal error or the final attempt — so a
  sustained outage still reaches a human. The `BotInteraction` audit row is skipped when rethrowing
  for a retry (a later attempt writes the definitive row).
- **Analysis workers** (`analyze-message.worker.ts`, `classify-ticket.worker.ts`): catch now rethrows
  **only** transient errors and swallows terminal ones (`return`), so a deterministic failure (model
  drift failing zod, a Prisma constraint) no longer burns the remaining retry attempts and their
  tokens. Both are idempotent, so a retried transient is safe.
- **Tests**: `tests/unit/api/gemini-transient-retry.spec.ts` (R266) — classifier table + bot
  `isFinalAttempt` threading + both analysis workers rethrow-transient/swallow-terminal. All green.
- **Also fixed** the 2 **pre-existing** `worker-guards.spec` (R194) failures noted in the S3 session:
  the ClassifyTicketWorker mock was missing `isTicket: true`, so commit `a889545`'s `isTicket` guard
  early-returned before `$transaction`. One-line mock fix; unrelated to the retry change.
- Docs: `docs/atlas/bot.md`, `docs/atlas/ai.md`, `tests/regression-catalogue.md` (R266),
  `worldgraph/atlas.world.json` (validated — 118 nodes), Decisions table above.
- Known unrelated red: `sso-auth.spec` fails to load locally (`@nestjs/common` unresolvable from the
  repo root in this machine's pnpm layout — it directly imports the package from `tests/`). Committed
  in `26ae21f`, pre-existing, environment-specific; not touched here.

### 2026-06-23 — S3 SDK migration (storage client: minio → @aws-sdk/client-s3)

The API wouldn't bootstrap. Root cause: `.env` had `MINIO_ENDPOINT=https://objectstore.e2enetworks.net`
(a full URL). The `minio` client requires a **bare host**, so it threw `InvalidEndpointError` in
`FilesService`'s constructor → DI failed. Because `NestFactory.create` defaults to
`abortOnError: true`, Nest called `process.exit(1)` **silently** — the error only reached the
file/GCP logger (no console transport), so `node dist/main.js` exited 1 with zero output. Setting
`abortOnError: false` surfaced the real stack.

- **`main.ts`**: `NestFactory.create(..., { abortOnError: false })` + a `bootstrap().catch()` that
  prints to the console and exits — fatal bootstrap errors are now visible instead of vanishing.
- **Storage migrated to `@aws-sdk/client-s3`** (the original ask was just to fix startup, but the
  user opted to switch off the brittle minio client). One client serves both MinIO (local) and E2E
  (prod) via `endpoint` + `forcePathStyle: true`. `FilesService` keeps the same five operations:
  `HeadBucketCommand` (bucket guard), `PutObjectCommand`, `getSignedUrl(GetObjectCommand)` ×2
  (the risky-type path uses `ResponseContentDisposition`), and `GetObjectCommand` +
  `transformToByteArray()` for the email-attachment byte fetch. `minio` removed from deps.
- **`S3_ENDPOINT` is a full URL, passed straight through**: verified the AWS SDK rejects a bare host
  and `host:port` but accepts a full URL — so the original `.env` value was right and minio was the
  only problem. Dropped the minio-era `S3_PORT`/`S3_USE_SSL` split (scheme + port encode both) and
  the endpoint-normalisation block — `FilesService` just forwards `S3_ENDPOINT` to the client.
- **Env vars renamed `MINIO_*` → `S3_*`** across `.env`, `.env.example`, `files.service.ts`,
  `scripts/backfill-attachment-keys.ts`, the integration/e2e test setups, and `playwright.config.ts`.
- **Test setups now provision the bucket** (`CreateBucketCommand`) — `FilesService` no longer
  auto-creates it (the prod bucket is shared and pre-provisioned; this was a pre-existing working-tree
  change, surfaced when the integration test went red). `@aws-sdk/client-s3` added to root devDeps.
- **Verified**: API bootstraps (port 3001); `files-sync.spec` 13/13 green against a real MinIO
  container (upload→presign→fetch); new `files-service-endpoint.spec` (R265) guards the regression.
- Docs: updated `docs/atlas/files.md`, `DEPLOY.md`, `worldgraph/atlas.world.json` (validated). The
  2 failing `worker-guards.spec` (R194) cases are **pre-existing** and unrelated to storage.

### 2026-06-23 — Pre-deployment cleanup & safety pass

Audited the repo for unused files / harmful scripts / prod-unsafe config before going live, then
actioned the agreed items (most findings left as-is by decision — see the plan for the full list).

- **Untracked build caches**: `git rm --cached` the three `tsconfig.tsbuildinfo` files
  (bridge/portal/worldgraph viewer) and added `*.tsbuildinfo` to `.gitignore`. Build cache, no
  source value; one was the worldgraph *viewer* cache, unrelated to `atlas.world.json`.
- **Removed the Chatwoot importer**: deleted `packages/db/src/import-chatwoot.ts`, its
  `import:chatwoot` package script, and `docs/import-chatwoot-plan.md`. Its `--clean-all` path could
  `deleteMany({})` all tickets/messages/attachments — a foot-gun with no place in production.
- **Guarded the seed against production**: `packages/db/src/seed.ts` `main()` now aborts when
  `NODE_ENV=production` (override `--force`). It injects demo data + a weak `admin123` admin and is
  the E2E fixture, so it's kept for dev/test but can no longer pollute prod.
- **Documented manual admin bootstrap**: the seed was the *only* admin-creation path
  (`/auth/signup` makes customers, not agents). Replaced the `db:seed` first-install step in
  `DEPLOY.md` with a "Create the first admin (production)" recipe — scrypt hash one-liner (matching
  `auth.service.ts` verifier) + `INSERT INTO "Agent" …`.
- **No worldgraph change** (no node covered chatwoot/seed). No `docs/atlas/` change — no user-facing
  feature behavior changed.

### 2026-06-23 — PM2 deployment, Docker dropped

Switched production deployment from Docker to **PM2** ahead of going live.

- **Removed** the `docker/` directory: `docker-compose.yml`, `Dockerfile.api`, `Dockerfile.portal`,
  `Dockerfile.dashboard`, `nginx.conf`. (The app Dockerfiles were already stale —
  `Dockerfile.dashboard` referenced `apps/dashboard` which doesn't exist, and they copied
  `.next/standalone` though neither Next app enables standalone output.)
- **Added** `ecosystem.config.cjs` (repo root) — three fork-mode processes: `athena-api`
  (`node dist/main.js`, :3001), `athena-portal` / `athena-bridge` (`next start`, :3000/:3002).
- **Added** `DEPLOY.md` — runbook from `git clone` → install → `.env` → `prisma migrate deploy` →
  `pnpm build` (sources `.env` so `NEXT_PUBLIC_*` get inlined) → `pm2 start ecosystem.config.cjs`,
  plus update/rollback and local-infra `docker run` commands.
- **Infra**: Postgres (pgvector) + S3-compatible object storage provisioned separately, wired via
  root `.env`. MinIO is dev-only; prod points `MINIO_*` at the E2E S3 endpoint over HTTPS. Reverse
  proxy + TLS handled at the server level (out of repo).
- **Kept**: Docker daemon for the test suite (Testcontainers) — not a deployment concern.
- **Docs**: CLAUDE.md (§4 commands + §5 structure), `docs/atlas/architecture.md` (stack +
  deployment section), this Decisions row + Session Log.

No code/feature behavior changed — deployment-only. No worldgraph node covered Docker, so no
worldgraph change.

### 2026-06-23 — Secure, durable attachment links (sign-on-click)

Fixed the attachment download flow. Bug: `FilesService.storeBuffer` minted a 7-day presigned URL
**once at upload** and persisted it in `Attachment.url`; it was never refreshed, so every link
died 7 days after upload regardless of how recently the ticket was opened.

Changes:
- **Schema**: added nullable `Attachment.objectKey`. Backfill script
  `scripts/backfill-attachment-keys.ts` derives `objectKey` from legacy URLs.
- **FilesService**: config-driven `minio` client (`MINIO_USE_SSL`/`MINIO_REGION` — local HTTP, prod
  E2E HTTPS); `storeBuffer` persists `objectKey`; new `presignReadUrl` mints a fresh short-lived URL
  (`MINIO_READ_URL_TTL_SECONDS`, default 600 s) with `response-content-disposition: attachment` for
  risky types; `getAttachmentBuffer` (email path) now resolves bytes via `objectKey` (URL-parse
  fallback); `.exe` uploads rejected.
- **Endpoint**: `GET /files/:id/sign` — authorizes (agent any / customer owns ticket, mirrors the
  upload IDOR guard) then returns a fresh URL; link attachments return their stored URL.
- **Frontend**: portal + bridge attachment chips changed from static `<a href>` to a click handler
  that opens a blank tab, `fetch`es the sign endpoint with the Bearer token, and navigates the tab
  to the returned URL. `MessageCard` gained an `onOpenAttachment` callback (token lives on the
  ticket page).
- **Tests**: `files-sync.spec` R173 (objectKey persisted), R174 (.exe rejected), R175 (fresh URL +
  IDOR 403 + 401). Catalogue rows R262–R264. (Two `worker-guards.spec` failures are pre-existing on
  master, unrelated.)
- **Docs**: `docs/atlas/files.md`, `_generated/` (atlas:gen — new route), worldgraph
  (`feature:files` + new route node, validated).

Deferred (agreed with user): virus scanning; broader upload allowlist.

### 2026-06-23 — TMR back-office server-to-server auth

The `tmr_data_service` back-office API (consumed by `TmrDataService` for customer product metadata)
previously had no enforced auth on Athena's calls — Athena sent a key in a custom `x-api-key`
header that the back-office middleware never validated (its JWT auth was commented out for free
local integration). Added a **dual-auth** scheme that adds Athena's path *without touching* the
existing frontend JWT flow:

- **Athena side** (`tmr-data.service.ts`): now sends the secret as `Authorization: Bearer
  <TMR_DATA_SERVICE_API_KEY>` plus an inert marker header `x-auth-mode: service`. Dropped the
  `TMR_DATA_SERVICE_API_KEY_HEADER` env var (removed from `.env`/`.env.example`).
- **Back-office side** (`tmr_data_service/src/middleware/back-office.middleware.ts`): when
  `x-auth-mode: service` is present, validates the Bearer token against `BACK_OFFICE_API_KEY` using
  a **constant-time compare** (`crypto.timingSafeEqual`, length-guarded) → 200 on match, 401
  otherwise. Requests without the marker fall straight through to the existing (still-commented)
  JWT/frontend path — unchanged. healthCheck stays open.

**Why `Authorization` + marker over `x-api-key`:** the secret in `Authorization` is auto-redacted
by logging/APM tooling (a custom `x-api-key` would print in cleartext); the marker is only a
routing flag (carries no secret) so it cleanly selects the API-key branch without modifying the
JWT scheme. Both are equally secure on the wire — choice is about redaction + clean coexistence.
Requires HTTPS in prod. New env: back-office `BACK_OFFICE_API_KEY` (must equal Athena's
`TMR_DATA_SERVICE_API_KEY`).

Tests: `tests/integration/tmr-data.spec.ts › R233` (asserts the outbound auth headers). Docs:
`docs/atlas/tmr-data.md` (External API contract), worldgraph `feature:tmr-data`,
regression-catalogue R261. type-check clean (both repos); worldgraph valid. Note: the tmr-data
integration suite's upstream-success cases can't run in this sandbox (MSW doesn't intercept Node-22
native `fetch` here — R223 fails identically), but pass in CI.

### 2026-06-22 — Pre-deployment UI/email bug fixes (5 manual-QA findings)

Five defects found during final pre-deploy manual testing, all fixed:

1. **Portal custom-field labels** — ticket-detail DETAILS card hardcoded "Field 1"/"Field 2" and showed raw values. Now reads `field1Label`/`field2Label` + options from `useAppConfig()` (`apps/portal/src/lib/brand.tsx`, already used by the submit page) and maps the stored value to its option label via a local `labelForValue`. Mirrors the bridge sidebar.
2. **Bridge reply link popup** — the reply editor's link button used a native `window.prompt`. Replaced with the existing `PromptDialog` (`components/ui/Dialog.tsx`), copying the canned-responses editor's save/restore-selection pattern (`savedRangeRef` captured before the dialog steals focus).
3. **Outbound emails showed literal HTML tags** — `EmailService.sendAgentReply`/`sendPortalReplyAck` only ever sent `text`. Now send `html` (`message.bodyHtml ?? message.body`) plus a tag-stripped `text` fallback via new `htmlToPlainText()` (keeps link URLs, list bullets). Covers agent **and** bot replies (both go through `sendAgentReply`). `send()`/`buildMimeBuffer` already supported `html`. See R258.
4. **Bot "Learn more" link artifact** — Turndown turns anchor-linked headings into markdown (`[Prerequisites](#prerequisites)`), which the chunker stored as the heading label and slugified to the doubled `prerequisites-prerequisites`. Added `stripInlineMarkdown()` (exported from `chunker.service.ts`), applied at H2/H3 extraction (fixes future crawls) and defensively in `bot.service.appendSource` (cleans the label for already-indexed chunks). Bot prompt tone lightly softened (`bot.prompts.ts`). See R259. **Post-deploy action required: re-crawl the KB** (`POST /kb/crawl/start`) to clean existing chunk anchors — the defensive label fix renders cleanly meanwhile.
5. **Dead edit icon** — removed the no-op `<Edit2>` button from `CustomerProfilePanel` header (import kept; still used by the notes edit control).
6. **Agent attachments never emailed** (follow-up finding) — files attached to a bridge reply showed in the portal but were absent from the outbound email. `sendAgentReply` never set nodemailer's `attachments`. Added `FilesService.getAttachmentBuffer` (recovers the MinIO object key from the presigned URL path), wired `FilesModule` into `EmailModule`, and made `sendAgentReply` load the message's non-link attachments (`attachment.findMany {messageId, isLink:false}`) and attach their bytes. A file that fails to fetch is logged and dropped without failing the send. The capturing transport now records attachment filenames. See R260.

Tests: `tests/unit/api/email-html-body.spec.ts` (R258), `tests/unit/api/strip-inline-markdown.spec.ts` (R259), `tests/unit/api/email-agent-reply-attachments.spec.ts` (R260). Docs: `email.md`, `bot.md`, module-graph (`EmailModule → FilesModule`), worldgraph. type-check clean.

### 2026-06-22 — GitHub: remove the /github page + label config, add label→ticket attention flag

- **Removed the `/github` "Action needed" page** (`apps/bridge/.../github/`), its sidebar rail entry + unread badge, and the `GITHUB_FIX_DEPLOYED` notification type/flow. Also removed the **Label Configuration** section from `settings/github`, the agent→GitHub "Mark pending confirmation" button, `POST /tickets/:id/github/pending`, `PATCH /github/webhook-config` (label fields), and `AppConfig.fixDeployedLabel`/`pendingConfirmationLabel`. Kept OAuth connect, default repo, webhook secret, and ticket-detail issue create/link/unlink.
- **New flow:** the `issues` webhook now reacts to `labeled/unlabeled/opened/closed/reopened` on a *linked* issue → syncs the issue's live `labels` (`{name,color}[]`) + `state` onto `GithubIssue`, appends a `GithubIssueEvent` (new table — append-only activity timeline), raises `Ticket.githubUpdatePending` + `githubUpdatedAt` **without touching `TicketStatus`**, and `createAndBroadcast`s a `GITHUB_ISSUE_UPDATED` notification. Cleared by `POST /tickets/:id/github/acknowledge` or the next agent `findById`; portal reads never clear it and never receive `labels`/`events`/the flag (DTO guard in `findById`).
- **UI:** ticket-detail GitHub card now shows live label chips, an orange "GitHub issue updated" attention banner with Acknowledge + latest-change summary, and an expandable "Issue activity (N)" timeline; a header badge sits beside (not replacing) the workflow status; inbox rows show a quiet GitHub icon + orange dot. The dead `NotificationsPanel` was generalized (type-driven) and wired to a new **bell** button in the dashboard rail.
- **Schema:** `db push` to dev (migration `20260622000000_github_issue_activity` committed; the enum rename pre-deletes old `GITHUB_FIX_DEPLOYED` rows). Dropped unused `GithubIssue.reviewers`/`daysOpen`.
- Docs: rewrote `docs/atlas/github.md`, updated worldgraph (`feature:github` dossier, `entity:GithubIssueEvent`, acknowledge route, enum note) + `pnpm atlas:gen`. Tests: new `tests/integration/github.webhook.spec.ts` (R255–R257), repurposed catalogue R19/R20.

### 2026-06-22 — Ticket dropdown label/value resolution + sidebar consistency

- **Right-sidebar fields fixed.** The ticket detail right bar showed hardcoded `Field 1`/`Field 2`
  labels and the raw stored values (e.g. `google-sheets`, `ls`). It now uses the configured
  `field1Label`/`field2Label` and resolves each value to its option label, matching the portal.
- **Tags moved to the right bar** for UI consistency (out of the thread header, into a dedicated
  "TAGS" sidebar section). Fixed the TMR Product widget being clipped — it had `overflow:hidden`,
  so flexbox shrank it below content height once the sidebar grew; added `flexShrink:0`.
- **Shared `useFieldConfig.ts`** (hook + `labelForValue`) now backs the ticket sidebar and both
  analytics dashboards (operations field1/field2 cards + customer-intelligence friction chart),
  which previously rendered raw values and hardcoded "field 1/2" titles.
- **Branding form reworked.** Removed the free-text `value` input; `value` is now derived from the
  label via `slugify` for new options and **frozen** for persisted ones (label edits never re-key).
  Each option shows its `key:` + ticket count; deleting an in-use option is gated by a confirmation
  modal backed by the new admin endpoint `GET /config/field-usage` (per-value non-deleted counts).
- Tests: `config.spec › R254` (2 cases, field-usage endpoint + auth boundary); extended `makeTicket`
  factory with `field1/field2/deletedAt`. Atlas (settings/analytics) + worldgraph + `_generated/`
  refreshed.

### 2026-06-21 — Pre-deployment full-regression QA checklist

- **Manual-QA catalog expanded for whole-app coverage.** The catalog had drifted behind recent
  work (tags, canned responses, SSO, TMR panel, GitHub action-needed queue, domain view, portal
  password-reset/email-verify) and was thin on edge cases. Added 8 new features
  (`tags-setup`, `canned-setup`, `sso-setup`, `portal-recovery`, `domain-view`, `tmr-data`,
  `github-actions`) and appended scenarios to existing ones. `tests/manual/_catalog/catalog.json`
  now: **27 features · 175 cases** (was 20 features · 72 cases), still user-facing-only, unique ids,
  journey/phase order preserved.
- **Generated the final pre-deploy report.** `pnpm qa:new "Pre-Deployment Full Regression"
  --features all` → `tests/manual/reports/2026-06-21_pre-deployment-full-regression/` (all 175 cases
  seeded). Added a companion `TESTING-PLAN.md` (time estimate ≈ 12h focused / ~15–16h wall-clock,
  per-phase breakdown, suggested session split, pre-flight checklist).
- No app code changed — docs/test-asset only.

### 2026-06-21 — Merge Shifts into Agent settings + fix stale `AgentRole` taxonomy

- **Shifts UI merged into Agents settings.** Shifts management was a standalone page
  (`/settings/shifts`) reachable only via a separate Calendar rail icon. Extracted its body into
  `apps/bridge/src/app/(dashboard)/settings/agents/ShiftsSection.tsx` and render it at the bottom of
  the Agents settings page (next to the AI first-responder fallback agent it routes to). The standalone
  `/settings/shifts/page.tsx` is now a `redirect('/settings/agents')` for back-compat; the Calendar rail
  icon (and its unused `lucide-react` import) was removed from `Sidebar.tsx`, and the Settings rail
  active-state logic simplified (no longer special-cases `/settings/shifts`).
- **Bug found + fixed (R249).** The schema's `AgentRole` enum is `ADMIN | PRIMARY_AGENT | SECONDARY_AGENT`
  (the `AGENT → PRIMARY_AGENT` rename was made in the bot session and documented in `docs/atlas/bot.md`),
  but `agents.dto.ts` and the entire Agents UI were never updated — they still used a non-existent `AGENT`
  role. Inviting/role-changing sent `'AGENT'`, cast `as AgentRole`, which **Prisma rejected at the DB**, so
  no new agent could be created through the UI. Because the Shifts agent picker filters for
  `PRIMARY_AGENT`/`ADMIN`, this silently meant only seeded agents were ever schedulable. Fixed the zod
  enums (`inviteAgentSchema`, `updateAgentSchema`), the Agents page role types/selects (now Admin / Primary
  agent / Secondary agent with friendly labels), and the `role` types in `lib/auth.tsx` + `auth/page.tsx`.
- **Shifts backend verified working** end-to-end: `ShiftResolverService.currentPrimaryAgent` correctly
  resolves day/time windows (incl. overnight wrap), round-robins on `lastAssignedAt`, then falls back to
  `botFallbackAgentId` → first active `PRIMARY_AGENT` → first active `ADMIN`. No backend behavior change.
- **Tests.** Added `agents-shifts.spec › R249` (invite with `PRIMARY_AGENT` persists that role; invalid
  `AGENT` role → 400) and the catalogue row; fixed a stale `role: 'AGENT'` literal in the R149 test. Full
  `agents-shifts` suite green (11/11). `type-check` clean for `@tmr/bridge` and `@tmr/api`.
- **Docs.** Updated `docs/atlas/bot.md` (Settings UI table, Shifts description, key-files table). No new
  endpoint/module/Prisma model, so `atlas:gen` not required; worldgraph bot node dossier touched below.

### 2026-06-20 — Bridge shared `(dashboard)` route-group layout (sidebar persistence / navigation flicker fix)

- **Bug fixed.** Navigating between top-level Bridge pages (e.g. Inbox → Analytics) left the *previous*
  page's content lingering in the center until the new page finished fetching; on cached repeat visits
  no skeleton showed at all. Root cause: every page was a `'use client'` component rendering the entire
  shell itself (`<div flex><DashboardSidebar/><main/></div>`), with no shared layout segment between
  siblings. Each sibling swap remounted the sidebar (re-fetching its stats) and React held the old tree
  painted until the new client page committed and *then* fetched its data in `useEffect` (so `loading.tsx`
  never fired on cached visits — nothing suspended).
- **Fix.** Introduced `apps/bridge/src/app/(dashboard)/layout.tsx` — renders `<DashboardSidebar />` +
  the outer flex container once, slots `{children}`. Moved `inbox/`, `tickets/`, `customers/`, `github/`,
  `analytics/`, `settings/` into the `(dashboard)` route group (parenthesized → **URLs unchanged**).
  `auth/`, root `layout.tsx`, root `page.tsx` stay at top level (no shell).
- **Pages stripped to content-only.** Each moved page dropped its `import { DashboardSidebar }` and outer
  `<div flex><DashboardSidebar/>…</div>` wrapper, now returning just its `<main>` (or a fragment where it
  had sibling panels: `customers/page.tsx` → `CustomerProfilePanel`; `tickets/[id]/page.tsx` → `<main>` +
  `<aside>` + `CustomerProfilePanel`, across all three return branches). `settings/layout.tsx` dropped its
  own sidebar+flex and now returns just the inner `<div flex>{nav}{main}</div>`.
- **Loading files.** The four `loading.tsx` (inbox/analytics/customers/github) rewritten content-only
  (no sidebar/flex); `settings/loading.tsx` was already content-only. Added a generic
  `(dashboard)/loading.tsx` fallback for `tickets/` (no loading file before).
- **Verified.** `pnpm --filter @tmr/bridge build` (clean, all 25 routes at unchanged URLs) +
  `type-check` pass. Frontend-only structural refactor — no API/module/route/schema change, so
  `atlas:gen`, worldgraph, and integration/e2e suites are **not** triggered (no atlas page documents
  the Bridge dashboard shell).

### 2026-06-15 — Worldgraph (AI-maintained app map + zoomable/storyboard viewer)

- Added a top-level **`worldgraph/`** directory: a single-file, AI-maintained JSON map of the whole
  platform (`atlas.world.json`) plus a standalone viewer — fully decoupled from the main app
  (own `package.json`/install/lockfile/`pnpm-workspace.yaml`, **not** referenced by the root
  `pnpm-workspace.yaml`, `turbo.json`, or `.github/workflows/test.yml`).
- **`atlas.world.json`** — 105 nodes (12 `feature:*`, 22 `module:*`, 22 `entity:*`, 33 `route:*`,
  5 `ext:*`, 11 `queue:*`) + 5 `journey:*` storyboards (`inbound-email`, `send-reply`,
  `bot-first-response`, `ticket-resolution-csat`, `auth-signin`). Label-addressed by `kind:name`;
  every node has a top-level `connects: string[]`, mirrored into `index.<label>.connects`.
- **`atlas.world.schema.json`** (JSON Schema draft-07) + **`validate.ts`** (read-only, `tsx`):
  checks schema conformance, label well-formedness, index/node `connects` consistency, and
  dangling-label references via a generic recursive label scan. `pnpm worldgraph:check` from repo
  root (or `pnpm validate` inside `worldgraph/`) → `atlas.world.json OK — 105 nodes, 5 journeys`.
- **Viewer** (`worldgraph/viewer`, port 3003): standalone Next.js 15 + React Flow app with
  Map / Detail / Storyboard views — dagre auto-layout, zustand selection/playhead state,
  framer-motion storyboard captions, dark theme mirroring bridge's `--d-*` tokens. `pnpm
  worldgraph:view` from repo root. Verified headless via Playwright (node click → detail panel,
  journey selection → storyboard captions).
- **CLAUDE.md**: added item 7 to the 30-second checklist (update `atlas.world.json` dossier +
  `connects` + `index`, then `pnpm worldgraph:check`, on any feature/module/route/queue/external
  change), a row to §4 Commands, a row to "Always Read These First", and a `worldgraph/` line in
  §5 Project Structure.
- Design note: simplified the plan's "union of typed reference arrays" requirement to a single
  explicit `connects: string[]` per node (duplicated into `index`, equality-checked by the
  validator) — same guarantees, far less per-kind bookkeeping across 105 hand-authored nodes.

### 2026-06-08 — Delivery QA flow (catalog-driven manual release-testing reports)

- Added a repeatable release gate: per-release human testing checklists composed from a canonical
  catalog, saved as durable, dated delivery-quality reports.
- **Catalog (source of truth):** `tests/manual/_catalog/catalog.json` — all 107 manual scenarios
  grouped by feature (18 features, tiers 0/A/B/C/D), each case `{id,type,scenario,ui,backend,tags}`
  with stable `<feature>.<kebab>` ids. Add new scenarios here; reports only reference it.
- **Tooling:** `pnpm qa:new "<release>" [--features a,b]` (`scripts/new-delivery-report.mjs`)
  scaffolds `tests/manual/reports/<YYYY-MM-DD>_<slug>/` with `checklist.html` (generic runner) +
  `report.json`. `--features` pre-seeds the checklist from the catalog deterministically; otherwise
  it's empty for Claude to fill on demand (procedure documented in `tests/manual/README.md`).
- **Runner:** `_template/checklist.html` is a generic, data-driven runner (no embedded cases) — loads
  the per-report `report.json`, renders its `checklist`, tracks `results` keyed by case id.
- **Persistence:** **File System Access API** autosaves results into `report.json` in the release
  folder (localStorage session backup; download/load fallback on Firefox/Safari). Committed folder =
  permanent QA record. Tier-D cases re-verify remediation fixes (T1.x/T2.x) in the running app.
- Design note: chose a single `catalog.json` over per-feature files + index (simpler, no index drift,
  jq-navigable). No app code changed; no atlas/schema impact. Command added to CLAUDE.md §4.

### 2026-06-08 — Manual-QA catalog v2 (user-journey, user-facing only)

- Reworked the manual-QA catalog (`tests/manual/_catalog/catalog.json`) from feature/tier grouping
  (107 mixed cases) to a **user-journey model**: 72 **user-facing** cases across 6 phases —
  1 Setup/config (admin) · 2 Customer (portal) · 3 Agent (dashboard) · 4 Email channel · 5 Bot ·
  6 Analytics. Dependencies precede dependents (e.g. connect inbox in phase 1 before email-channel in 4).
- **Pruned** everything a real user wouldn't do: forced API/curl calls, localStorage tampering,
  webhook-signature/SSRF/boot-secret/rate-limit security probes (the old Tier-D), dev setup
  (docker/logs/Prisma Studio), and DB/log assertions. Each case is now `action` (what the user does)
  + `see` (what the user observes) — no internals.
- Runner (`_template/checklist.html`) updated to render `action`/`see`, group under **phase header
  bands**, and filter by phase. Generator (`scripts/new-delivery-report.mjs`) seeds by catalog/journey
  order and supports `--features all`. Docs (catalog README, manual README) updated. `report.json`
  schema: sections now `{key,title,phase,cases:[{id,type,action,see}]}`.

- Built entire monorepo from scratch (CP-01 through CP-29)
- Refactored from multi-tenant to single-tenant (removed orgId from all tables, replaced Org/BrandConfig with AppConfig)
- Fixed all major functional issues: search, checkboxes, email wiring, file upload, guest flow
- Added connector dropdown with brand icons (23 connectors)
- Email threading implemented (Message-ID + In-Reply-To + References)
- UI readability improvements: font sizes, spacing, row height

### 2026-05-17 — Session 5

- GitHub webhook integration: `POST /api/v1/github/webhook` with HMAC-SHA256 signature verification
- `Notification` + `NotificationRead` models added to schema
- `fix-deployed` label on GitHub issue → creates in-app notification for all agents
- `pending-customer-confirmation` label added via "Mark pending" button (only available after agent replies)
- Settings → GitHub completely redesigned: premium step-by-step UI with copy URL, secret generate/reveal/regenerate, live verification status, collapsible setup instructions, configurable label names
- Sidebar: GitHub Octocat icon with red unread badge (polls every 30s)
- Notifications panel: slide-over showing fix-deployed events with "Open ticket" action
- Ticket detail: amber banner when linked issue has fix-deployed label; "Mark pending" button enabled only after agent replies
- Webhook label names are configurable via Settings (no code changes needed)
- `rawBody: true` enabled in NestJS for webhook signature verification

### 2026-05-17 — Session 6

- GitHub OAuth connect button wired — redirects to GitHub, callback page exchanges code, redirects back to settings
- GitHub default repo field: inline confirmation with context-aware message (first-time vs change); info note distinguishing webhook vs repo
- Settings nav GitHub badge driven by live API call (was hardcoded "Connected")
- `NEXT_PUBLIC_*` env var fix: both `next.config.ts` files now load root `.env` via dotenv so variables work without inline shell exports
- Auto-clear `.next` cache on `dev` start for both portal and dashboard (added to package.json scripts)
- Light/dark theme system: `ThemeProvider` context, `data-theme` attribute on `<html>`, Settings → General toggle
- Light theme palette: premium cool-neutral (v2 design tokens) — `#F4F5F7` bg, `#F8F9FB` surface, `#FFFFFF` cards, slate text hierarchy, saturated status pills
- Shimmer animation, internal note band, status pills all have correct light overrides
- Right panel hardcoded `#0D0D0F` background fixed to `var(--d-surface)`
- Internal note text `#FDE68A` (hardcoded amber) fixed to `var(--d-note-text)` so it reads correctly in light mode

### 2026-05-17 — Session 7

- **Branding page fully functional**: color pickers wired to form state, logo upload with preview, save patches all fields to API
- **Portal live theming**: `AppConfigProvider` now injects `--p-accent`, `--p-accent-hv`, `--p-accent-bg` as inline CSS vars on `<html>` when config loads — portal theme responds instantly to brand color changes in settings
- **Brand color extraction — from image**: canvas-based client-side color analysis; user drops logo/image, top 5 dominant non-neutral colors extracted and shown as swatches; click swatch → popover to apply as Primary or Accent
- **Brand color extraction — from website URL**: new `GET /config/extract-brand?url=...` backend endpoint; fetches target URL server-side (avoids CORS), parses `<meta name="theme-color">`, `msapplication-TileColor`, CSS custom properties matching brand patterns, and most-frequent inline colors; returns up to 8 candidates
- Branding page preview panel updated: shows logo, tagline, accent bar for both primary + accent, correct button text contrast via luminance check
- Logo upload: `POST /config/logo` already existed in API; wired to form — logo saved on "Save changes"

### 2026-05-17 — Session 8

- **Analytics page** (`/analytics`) added to dashboard with sidebar nav link
- **`GET /analytics` API endpoint** (new `AnalyticsModule`) — single call returns all metrics:
  - KPIs: total tickets, open, resolved, resolution rate %, avg resolution hours, new this week + WoW% change, unassigned count
  - Volume by day: last 30 days (daily counts, gap-filled) via `$queryRaw` with `DATE_TRUNC`
  - By status, category, priority (Prisma `groupBy`)
  - Top connectors (top 10 by count)
  - Top 10 customers by ticket volume (name, email, total, open, last ticket date)
  - Agent performance (assigned, resolved, open per agent)
- **Frontend charts — no new dependencies** (pure SVG + CSS):
  - Area/line chart for 30-day volume trend (SVG path with gradient fill, Y-axis grid lines, X-axis date labels)
  - Donut chart for status distribution (SVG stroke-dasharray segments with gap)
  - Horizontal progress bars for category, connector, priority breakdown
  - Resolution rate mini-bar per customer and agent
- **High-attention customers table**: "At risk" badge for customers with ≥3 open tickets; avatar color from name hash
- **Insights row**: tickets/customer avg, backlog pressure %, unassigned count — color-coded red/green by threshold
- **Urgent alert**: warning strip appears in Priority card when URGENT tickets exist
- **Analytics layout fix**: removed `maxWidth: 1100` cap; all rows now fill available width edge-to-edge
- Row 2 changed to `3fr 2fr`, Row 3 expanded to 3 columns (category + connectors + priority), Row 5 changed to `2fr 1fr` (agent table + stacked insight tiles)

### 2026-05-17 — Session 9

- **Priority picker on ticket detail**: replaced plain text priority display with interactive custom dropdown
- Color palette: Normal = blue `#60A5FA`, High = orange `#FB923C`, Urgent = rose `#F43F5E` — each with matching tinted background and border
- `PRIORITY_COLOR` / `PRIORITY_BG` constants drive both the trigger pill and the dropdown option rows
- Dropdown uses `document.mousedown` click-outside handler (via `useRef`) — fixed bug where `onMouseLeave` closed the menu before an option could be clicked
- **Bug fix — `ticket.messages` undefined crash**: `updateStatus` and `updatePriority` were calling `setTicket(res.ticket)` with a PATCH response that excludes `messages`; fixed by having `updatePriority` merge the field optimistically (`setTicket(prev => {...prev, priority})`) and `updateStatus` do a full refetch so the new system-event message appears in the thread

### 2026-05-17 — Session 10

- **GitHub OAuth callback fix**: replaced raw `https.request` helpers (no timeout, hung forever) with native `fetch` + `AbortSignal.timeout(10s)`; callback page now has 15s client-side timeout + `cancelled` ref to prevent React Strict Mode double-invocation; `authLoading` added to deps so effect waits for localStorage read before firing; improved error messages from GitHub propagate correctly
- **API error message parsing fixed**: `api.ts` now reads NestJS top-level `message` field (was reading `error.message` which was always undefined, causing all errors to show "Request failed")
- **GitHub settings — repo dropdown**: replaced free-text `owner/repo` input with searchable dropdown; fetches real repos from `GET /github/repos` (new endpoint, paginates up to 500 repos sorted by recently updated); lock icon for private repos, description shown; manual entry footer for org repos with restricted API access; click-outside to close
- **GitHub settings — improved info panel**: "What this repo is used for" header with ✅ (issue creation) and ⚠️ (webhooks are separate, with exact path to configure) rows
- **Ticket detail — GitHub issue panel**: replaced static display with full create/link UI; fetches `GET /github/status` on mount to show saved default repo; amber warning + Settings link if no default repo configured; "Create GitHub issue" button disabled until repo is set; "Link existing" tab accepts `owner/repo#123` or full GitHub URL; "Unlink issue" button calls `DELETE`; linked issue shows external link icon
- **Inbox — Link issue button**: wired to `Link href="/tickets/:id#github"` (navigates to ticket detail scrolled to GitHub section; was a no-op stub)
- **`GET /github/repos`**: new API endpoint fetches authenticated user's repos from GitHub API (owner + collaborator + org member), returns `fullName`, `private`, `description`

### 2026-05-17 — Session 11

- **Recharts migration**: replaced all hand-rolled SVG/div charts in analytics page with Recharts components; `recharts@3` added to `apps/dashboard`
  - SVG `AreaChart` → Recharts `AreaChart` with `Area`, `CartesianGrid`, `XAxis`, `YAxis`, custom `VolumeTooltip`
  - SVG `DonutChart` → Recharts `PieChart` with `Pie` (innerRadius for donut), `Cell` per segment, `Legend`, custom `PieTooltip`
  - Div horizontal bars (category, connectors, priority) → Recharts `BarChart` in vertical layout with `Cell` for per-bar colors, `LabelList` for value labels, custom `BarTooltip`
  - Agent performance → grouped `BarChart` with Assigned/Resolved/Open series, shared `Legend`
  - Table mini resolution bars kept as CSS divs (appropriate for table cell context)
  - All tooltips use `var(--d-*)` CSS variables — light/dark theme works automatically

### 2026-05-17 — Sessions 12–14

**App renamed: `apps/dashboard` → `apps/bridge` (`@tmr/bridge`)**

**Sidebar — two-layer rail redesign:**
- Narrow 48px icon rail (left) + 172px content panel (right) = same 220px total, zero layout changes
- Rail icons: Tickets (navigates → `/inbox`), GitHub (navigates → `/github`), Analytics (navigates → `/analytics`)
- Active section auto-detected from `pathname`; icons darken on active; red dot badge on GitHub when unread
- Tickets panel: search box + Views (Inbox, All Tickets) + Status filters + Label filters
- GitHub panel: connection status dot + "Action needed" nav link (with unread badge) + "Dashboard (Soon)"
- Analytics panel: Dashboard link only (snapshot removed)
- App name + agent name/role pinned at top of panel on all sections
- Rail logo shows `logoUrl` from config (falls back to LifeBuoy icon)
- Live config update: `window.dispatchEvent('app-config-updated')` fired on save; sidebar updates without page reload

**Shared `TicketPreviewPanel` component** (`components/dashboard/TicketPreviewPanel.tsx`):
- Replaces duplicated aside in Inbox and All Tickets pages
- Exports `CategoryPill` (Lucide icons per category), `PriorityBadge` (CSS var colors), shared constants
- Used by Inbox, All Tickets, and GitHub Action Needed page

**Inbox + All Tickets improvements:**
- Category icons: Bug=Bug, Feature=Lightbulb, Question=HelpCircle, Billing=CreditCard, Other=Circle
- Priority dots use `var(--d-danger)` / `var(--d-warning)` — readable in light theme
- `lastMessage` API fix: added `type: 'REPLY'` filter — system events no longer show as last message
- All Tickets page now has click-to-preview (same as Inbox): `selectedId` state, accent bar, preview panel
- Preview panel `PriorityBadge` uses CSS vars — Urgent readable in light theme

**Ticket message differentiation:**
- Agent messages: `rgba(59,130,246,0.12)` blue-tint background, blue border, squared bottom-right corner
- Customer messages: neutral `var(--d-raised)`, squared bottom-left corner

**Settings overhaul:**
- Nav simplified: removed Notifications, Email forwarding, Billing
- General page: App identity section (icon upload + app name, admin-only); Appearance (theme toggle, all roles)
- Logo stored as base64 data URI via `PATCH /config` — no broken MinIO path; `z.string().url()` validation loosened
- Settings → General now defaults on `/settings` navigation
- `next.config.ts`: `devIndicators: false` to suppress Next.js dev indicator

**GitHub Action Needed page (`/github`):**
- Full-page layout: stats bar (Unread / Tickets needing reply / Actioned) + split panel
- Left (300px): compact notification list; click selects + marks read
- Right (flex): two-column panel — Left col: customer, last message, quick reply + resolve; Right col: GitHub issue card, ticket metadata, thread snippet (last 3 messages)
- Auto-selects first unread notification on load
- `next.config.ts` `devIndicators: false` suppresses Next.js badge

**Notifications panel (`NotificationsPanel.tsx`):**
- Background fixed from hardcoded `#0D0D0F` to `var(--d-surface)`
- `fix-deployed` pill uses `var(--d-success)` / `var(--d-success-bg)` — readable in light theme
- Mark-as-read simplified to color differentiation (unread = full opacity + blue border; read = 50% opacity)

**App config live update:**
- `PATCH /config` now saves `logoUrl` (base64) + `appName`
- Settings save dispatches `app-config-updated` custom event → sidebar updates immediately

### 2026-05-20 — Session 15

- **Production-grade inbound email pipeline** replacing broken smtp-server approach
- **`ImapClientService`**: IMAP IDLE long-lived client per inbox; exponential backoff reconnect (1s→60s cap); listens for `email-config-updated` event to reconnect with new creds; 30s polling fallback when IDLE not supported
- **Job queue** (`email.inbound`): originally BullMQ on Redis; replaced by pg-boss on Postgres in Session 16 — same 5x exponential retry semantics
- **`InboundEmailProcessor`** (queue worker): full pipeline — MIME parse, idempotency check (`Message.messageId @unique`), loop-guard, VERP→header→subject→new-ticket routing, identity resolution, body stripping, message persist, IMAP Seen mark
- **`EmailRoutingService`**: priority routing (VERP signed token → In-Reply-To header → References → subject `[TMR-NNN]` tag → new ticket fallback); auto-responder guard (Auto-Submitted, Precedence, noreply@ senders)
- **VERP signing** (`verp.util.ts`): `reply+<emailThreadId>.<hmac8>@<domain>` — HMAC-SHA256 with `verpSecret` stored encrypted in AppConfig
- **AES-256-GCM credential encryption** (`credentials-cipher.ts`): IMAP and SMTP passwords encrypted at rest; never returned on GET; `imapPasswordSet`/`smtpPasswordSet` booleans returned instead
- **`AppConfigService` extended**: IMAP/SMTP fields, `updateInboundLastUid()`, `testEmailConnection()`, `getSafe()` (redacts passwords)
- **`AppEventsModule`** (`@Global()`): singleton `AppEventsService` (Node EventEmitter) — `email-config-updated` propagated from `PATCH /config` → `ImapClientService.reconnect()`
- **Config controller** extended: `POST /config/email/test` (admin) tests IMAP+SMTP without saving; `GET /config/email/inbound-log` (paginated, last 7d); `POST /config/email/inbound-log/:id/replay`
- **`EmailInboundLog` model + `InboundStatus` enum**: full audit trail for every inbound message
- **`User` model** extended: `source` (PORTAL/EMAIL/INVITE), `isVerified`, `emailStatus` fields — email-origin users auto-created
- **`Message` model** extended: `messageId`, `inReplyTo`, `bodyRaw` fields for RFC 5322 threading
- **`AppConfig` model** extended: IMAP/SMTP encrypted config, `inboundEnabled`, `inboundLastUid`, `verpSecret`
- **Bridge Settings → Email page** (`/settings/email`): IMAP + SMTP config cards, test connection button (live result per-protocol), enable/disable toggle, link to log viewer
- **Bridge Settings → Email Log page** (`/settings/email/log`): paginated table with status filter, click-to-detail side panel, replay button for FAILED/DLQ entries
- **`smtp-server` package removed**; replaced with `imapflow`, `bullmq`, `@nestjs/bullmq` (queue stack later swapped to pg-boss in Session 16)
- Prisma schema pushed; client regenerated; API + Bridge type-check passes clean

### 2026-05-21 — Session 16

- **Removed Redis and BullMQ entirely** — replaced with **pg-boss** running against the existing Postgres
  - Motivation: self-hosting story; one fewer service to deploy and back up; same `DATABASE_URL` already in use
  - pg-boss creates its own `pgboss` schema in Postgres on first start (auto-migrating); zero manual setup
- **Pinned pg-boss to v9** — v10+ is ESM-only and breaks our CommonJS Nest build; v9 has the same API surface we use (`send`, `work`, retries, backoff)
- **`QueueService` rewritten**: owns a long-lived `PgBoss` instance, starts it in constructor, exposes `ready()` + `getBoss()` + `enqueueInbound()`; `OnModuleDestroy` calls `boss.stop({ graceful: true })`
- **`InboundEmailProcessor` rewritten**: no longer extends `WorkerHost`; registers via `boss.work(INBOUND_EMAIL_QUEUE, handler)` in `onModuleInit` after awaiting `queue.ready()`
- **`QueueModule` is now `@Global()`** so any module can `inject` `QueueService` without an import in its own `imports` list
- **`app.module.ts`**: removed `BullModule.forRoot` block, added `QueueModule`
- **`email.module.ts`**: removed `BullModule.registerQueue` block; `QueueService` and `InboundEmailProcessor` now declared once in the global queue module
- **`docker-compose.yml`**: Redis service deleted; `REDIS_URL` env var removed from API; `depends_on: redis` removed
- **`.env.example`**: `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT` removed (no Redis vars needed anywhere now)
- **Dependencies** (`apps/api/package.json`): removed `bullmq` + `@nestjs/bullmq`; added `pg-boss@^9`
- Verified end-to-end: API boots → pg-boss starts → worker registers → IMAP connects → real inbound email enqueued and processed by the new worker (loop guard correctly dropped a `Precedence: Bulk` marketing email)

### 2026-05-21 — Chatwoot conversation import

> **Removed 2026-06-23** — the one-shot importer (`packages/db/src/import-chatwoot.ts`) and its
> `import:chatwoot` script were deleted pre-deployment (its `--clean-all` path could wipe all
> tickets/messages). The entry below is kept as a historical record only.

- **`packages/db/src/import-chatwoot.ts`**: one-shot importer for legacy Chatwoot conversation exports
  - Filters to message types 0 (user) + 1 (agent); skips 2 (automation) + 3 (CSAT)
  - Auto-creates `source: EMAIL` users with names humanized from the email local-part
  - Title from first user message (first sentence, ≤80 chars, strips greeting prefix)
  - Category + priority via keyword heuristic; status by age + last-message direction
  - Preserves original timestamps end-to-end so analytics charts get a real shape
  - Wipes prior import via `--force` (scoped to `source: EMAIL` + import date range — does not touch live inbound mail)
  - Imported 465 conversations / 287 customers / 2260 messages in ~3 seconds

### 2026-05-21 — Architecture Atlas

- **New `docs/atlas/`** per-feature reference directory. STATE.md is sequential
  and great for "what changed when" but the wrong shape for "where does X live
  and how does it flow today" — the atlas fills that gap.
- **Format**: Markdown + Mermaid diagrams. Renders in GitHub, VS Code, Cursor
  without any build step.
- **Hand-curated files** for each feature: `email.md` · `tickets.md` ·
  `messages.md` · `github.md` (fully fleshed) and `analytics.md` · `auth.md` ·
  `files.md` · `notifications.md` · `queue.md` · `settings.md` (concise).
  All carry frontmatter (title, stack, status, last-reviewed).
- **`docs/atlas/_generated/`** — auto-generated by `pnpm atlas:gen`:
  - `api-routes.md` — 49 routes across 11 controllers, grouped per controller
  - `erd.md` — Mermaid `erDiagram` from `schema.prisma` + enum cheatsheet (14 models, 10 enums)
  - `module-graph.md` — Mermaid `flowchart` of NestJS module imports (17 modules)
- **Generator**: `scripts/atlas-gen.ts` using `ts-morph` for AST parsing of
  controllers and modules; hand-rolled Prisma-schema parser for the ERD.
- **Root `package.json`** gains `atlas:gen` script. New devDeps: `ts-morph`, `tsx`.
- **STATE.md trimmed**: dropped the "Feature Status" tables and "Key File Map"
  section since the atlas now covers them. Kept Quick Reference, Decisions,
  Known Issues, and this Session Log.
- **CLAUDE.md hardened**: top-of-file documentation rule rewritten as a
  4-step checklist agents run before reporting a task complete. Goal: stop
  needing the user to manually remind "update STATE.md".

### 2026-05-24 — Customer insights dashboard (Phase 1)

- **Schema additions**: `Topic`, `TicketRating`, `AiUsage` models; `sentimentScore`/`sentimentLabel`/`analyzedAt` on `Message`; `topicId`/`reopenedAt`/`reopenCount`/`firstResolvedAt` on `Ticket`; new enums `SentimentLabel`, `AiOperation`, `AiCallStatus`. Applied via `prisma db push`.
- **AI module** (`apps/api/src/modules/ai/`): `GeminiService` with three operations (sentiment, topic, CSAT) behind a single `invoke()` helper that logs every call to `AiUsage` with token counts and computed cost. Model: `gemini-2.0-flash`. Three pg-boss workers registered.
- **Queue additions**: `ai:analyze-message`, `ai:classify-ticket`, `ai:request-csat` queues added to `QueueService`.
- **Write-path hooks**: `MessagesService` enqueues sentiment analysis on customer REPLYs; reopen tracking (count + timestamp) when customer replies on RESOLVED/CLOSED; `TicketsService` enqueues classify+CSAT on RESOLVED, sets `firstResolvedAt` immutably.
- **Public CSAT endpoint**: `GET/POST /rate/:token` (no auth) in `RatingController`. Token lives in `TicketRating.ratingToken`.
- **Backfill script**: `scripts/backfill-ai-analytics.ts` — run manually, supports `--dry-run` and `--limit=N`.
- **Analytics endpoints**: `GET /analytics/customers` (parallel `$transaction` of 14 queries returning full customer intelligence payload); `GET /settings/ai-usage` (admin-only, cost + error metrics).
- **Bridge routing**: existing `/analytics/page.tsx` moved to `/analytics/operations/page.tsx`; redirect added at `/analytics`; new `/analytics/customers/page.tsx` (Customer Insights — 5 bands) and `/settings/ai-usage/page.tsx` (AI cost dashboard).
- **Sidebar**: Analytics panel now has two sub-links: Operations (`Activity` icon) and Customer insights (`Users` icon), with proper active-state highlighting.
- **Settings nav**: new "AI" section added to settings layout with "AI Usage & Cost" link (admin-only page).
- **Type-checks**: both `@tmr/api` and `@tmr/bridge` pass `tsc --noEmit` clean.
- **Docs**: `docs/atlas/analytics.md` rewritten; `docs/atlas/ai.md` created; `docs/atlas/settings.md` updated; `docs/atlas/README.md` updated with AI row.

### 2026-05-24 — Customer insights dashboard (Phase 2: Effort + Signals + Advocacy)

- **Schema additions**: `CustomerSignal` model (type, quote, reason, linked to Message/Ticket/User); `SignalType` enum (`CHURN_RISK | ADVOCACY`); `aiEffortScore Int?` on `TicketRating`; `CHURN_RISK_DETECTED` on `NotificationType`. Applied via `prisma db push`; `pnpm atlas:gen` refreshed (18 models, 14 enums).
- **AI module redesign**: `GeminiService` refactored from 3 separate methods to 2 combined methods:
  - `analyzeMessage()` → sentiment + churn signal + advocacy signal in one Gemini call
  - `classifyAndScoreTicket()` → topic + CSAT + effort score in one Gemini call
  - Prompts updated in `gemini.prompts.ts` (`ANALYZE_MESSAGE_PROMPT`, `CLASSIFY_AND_SCORE_TICKET_PROMPT`)
- **Active churn workflow**: `analyze-message.worker.ts` — when churn detected: inserts `CustomerSignal(CHURN_RISK)`, creates `Notification(CHURN_RISK_DETECTED)`, bumps `Ticket.priority` NORMAL→HIGH, emits `SYSTEM_EVENT` message. Advocacy is passive (insert only, no notification).
- **classify-ticket.worker.ts**: now writes `aiEffortScore` to `TicketRating` from combined call; passes existing topic names to Gemini for clustering consistency.
- **Backfill script**: updated to use new 2-method API; handles `CustomerSignal` insertion for churn + advocacy signals detected during backfill.
- **`/analytics/customers` endpoint extended**: `customers.service.ts` adds `signals` block (churn/advocacy counts + 10 most recent with quote/customer/ticket), `effort` block (avg, distribution, scatter data), `topAdvocates` block (top 10 by ADVOCACY count 90d with best quote). KPIs gain `churnSignalsCount30d`. Health score formula updated: `− (churnSignalCount90d × 25) + (advocacySignalCount90d × 10)`.
- **Customer Insights page** (`/analytics/customers`): 6-card KPI strip; signals strip (3 clickable cards with inline drawers); recent signals two-column feed; Effort×CSAT scatter; at-risk table gains churn badge column; Top Advocates mini-table added.
- **Type-checks**: both `@tmr/api` and `@tmr/bridge` pass `tsc --noEmit` clean.
- **Decision**: effort score piggybacks on the CSAT Gemini call — no separate API call or `AiOperation` enum value. Shows in AI usage page under "CSAT" operation.

### 2026-05-24 — Customer insights chart redesign (Chatbase-style)

- **`InfoTooltip` component**: hover `ⓘ` (`<Info size={13}>` from lucide-react) on every chart title; tooltip positioned above the icon via CSS `position: absolute`; no library added.
- **`ChartTitle` component**: thin wrapper — `<h3>` + inline `InfoTooltip`; replaces bare heading in all customer insights chart sections.
- **`SentimentChart` redesign**: replaced `AreaChart` with Recharts `LineChart`; added Chatbase-style two-panel layout (`grid: 1fr 200px`) — chart on left, stats panel on right (avg score + Positive/Neutral/Negative horizontal bars with percentages). Fixed dot visibility for single isolated data points (`dot={{ r: 3 }}`). Fixed x-axis last-date clipping (`interval="preserveStartEnd"`).
- **`TopicTrendChart` redesign**: new multi-line `LineChart` — one `<Line>` per top-8 topic; colors from `TOPIC_COLORS` constant. Same two-panel layout: chart left, legend right (total count + per-topic color dot + name + count). Topic data keys use topic IDs (not names) to prevent collisions.
- **Backend additions** (`customers.service.ts`): added `sentimentByLabel` (Positive/Neutral/Negative counts via Prisma `groupBy` on `sentimentLabel`), `totalAnalyzed` (sum), `topicTrend` (30-day gap-filled daily counts per top-8 topic via `$queryRaw`), `topicMeta` (id/name/colorIndex map for the legend).
- **`ChartTooltip`** unified: replaced old separate `VoiceTooltip`/`BarTooltip` components with a single `ChartTooltip`.
- **`KpiCard`** accepts `info` prop: renders `InfoTooltip` inline with the card header.
- Type interface updated: `sentimentByLabel`, `totalAnalyzed`, `topicTrend`, `topicMeta` added to `CustomerInsightsData`. Both `@tmr/api` and `@tmr/bridge` pass `tsc --noEmit` clean.
- Docs: `docs/atlas/analytics.md` updated with chart component table, backend response field table, and redesigned chart descriptions.
- **Follow-up UI fixes**: (1) `InfoTooltip` gained `direction` prop (`'up'` | `'down'`); KPI strip and signals strip cards all use `direction="down"` so tooltips render below the icon instead of above the sticky header. (2) Effort card sparkline replaced with NPS-style stacked bar: `Low (1–2) / Med (3) / High (4–5)` proportions shown as a segmented green/yellow/red bar with % labels — more readable than vertical bar mini chart.
- **Layout restructuring**: (1) "Avg conversation depth by category" moved from Product experience → Voice of Customer (conversation depth is a customer effort signal). (2) "Reopen rate by category" chart removed; Product experience section gains a "More coming soon" chip in the header. (3) Everything below the at-risk customers table removed: Top advocates mini-table, Repeat contact distribution chart, and entire CSAT comparison section all deleted. Replaced with a single dashed "More analytics coming soon" card. `Legend` import from recharts removed (was the only consumer of that import).

### 2026-05-24 — AI scoring summary on ticket detail (Bridge only)

- **Schema**: `aiSummary String?` added to `TicketRating`. Applied via `prisma db push`.
- **Prompt**: `CLASSIFY_AND_SCORE_TICKET_PROMPT` extended with a `summary` field — 1-2 sentences briefly explaining why the CSAT and effort scores were given. Explicit instruction to be brief (token-conscious).
- **`ClassifyAndScoreResult`**: `summary: string` added to the type.
- **`classify-ticket.worker.ts`**: `aiSummary` persisted in the `TicketRating` upsert.
- **`tickets.service.ts`**: `findById` now includes `rating: { select: { aiRating, aiEffortScore, aiSummary } }` so the field is available in the ticket detail response.
- **Bridge ticket detail** (`/tickets/[id]/page.tsx`): AI Analysis card rendered at the bottom of the message thread when `ticket.status` is `RESOLVED` or `CLOSED` and `ticket.rating?.aiSummary` is set. Shows CSAT score, effort score (color-coded), and the summary text. Separated from the thread by a labelled divider. Never visible to portal users — it is a UI element reading from `ticket.rating`, which the portal response does not include.
- **Backfill script** (`scripts/backfill-ai-analytics.ts`): Now imports `ANALYZE_MESSAGE_PROMPT` and `CLASSIFY_AND_SCORE_TICKET_PROMPT` directly from `apps/api/src/modules/ai/gemini.prompts.ts` — no duplicate inline prompt strings. `TicketRating` upsert now writes `aiSummary`. Also fixed a pre-existing bug: script imported `decimal.js` which is not installed at monorepo root — replaced both `new Decimal(...)` calls with plain string values (Prisma accepts strings for `Decimal` fields). Script is now runnable with `pnpm tsx scripts/backfill-ai-analytics.ts --dry-run`.

### 2026-05-21 — Bridge typography pass

- **Root cause**: `--font-display` and `--font-body` in `apps/bridge/src/globals.css`
  pointed at `"Geist"` but the font was **never actually loaded** — no
  `next/font` import, no `@font-face`, no link tag, no local file. Browser
  fell through to `ui-sans-serif` → `system-ui`, which renders as Liberation
  Sans / DejaVu on Linux. That's why the app felt generic.
- **Fix**: `apps/bridge/src/app/layout.tsx` now imports `Geist` and
  `Geist_Mono` from `next/font/google`, exposes them as `--font-geist-sans`
  / `--font-geist-mono` on `<html>`. The font-stack vars consume these first.
- **Global typography hardening** in `globals.css`:
  - `text-rendering: optimizeLegibility`, `-moz-osx-font-smoothing: grayscale`
  - `font-feature-settings`: `kern`, `liga`, `calt`, `cv11` (single-story
    `a`), `ss03` (tighter punctuation) for body; `zero` + `ss01` for mono
  - Global `h1/h2/h3/h4` rules: `font-family: var(--font-display)`, negative
    letter-spacing (-0.02 / -0.015 / -0.01em), tighter line-height (1.15–1.25)
  - New `.eyebrow` utility class (10.5px, 600, uppercase, 0.09em tracking)
    for section labels — section labels already had inline tracking, this
    just gives us a clean reusable class for future use
- **Ticket detail h1** bumped from 20/600 to 24/700 with -0.02em tracking
  to bring it in line with Inbox / GitHub page titles.
- Portal app left untouched; same fix can be repeated there next pass.

### 2026-05-21 — Portal typography pass

- Same root cause (Geist referenced but never loaded), same fix:
  - `apps/portal/src/app/layout.tsx` now imports `Geist` + `Geist_Mono` from
    `next/font/google` and exposes `--font-geist-sans` / `--font-geist-mono`
    on `<html>`.
  - `apps/portal/src/globals.css`: font-stack vars point at the loaded vars
    first, then fall back; added `text-rendering: optimizeLegibility`,
    `font-feature-settings` (kern/liga/calt/cv11/ss03), global `h1–h4`
    rules with negative tracking + tighter line-height, and the `.eyebrow`
    utility class (colored with portal's `--p-text-3` instead of bridge's
    `--d-text-4`).
- Both customer-facing and agent-facing apps now share the same typography
  baseline — Geist with feature-tuned defaults.

### 2026-05-21 — Type-size surgical pass

After the Geist load, body text still felt small for a desktop SaaS (audit
showed Bridge had 132×12px / 90×13px / 83×11px occurrences vs only 19×14px).
Peer apps (Stripe, Vercel, GitHub, Notion) sit at 14–15px body. Bumped
reading-heavy text in both apps; left labels / meta / pill text alone so
the small-text scaffolding still does its job.

**Bridge:**
- Ticket-thread message body (regular + internal note): 13 → **15**
- Ticket-detail author/timestamp line above each message: 12 → **13**
- Ticket-detail right-rail customer name: 13 → **14**
- Ticket-detail right-rail metadata values (Created / Updated / Source): 12 → **13**
- All Tickets row title: 13 → **14**
- Sidebar primary nav items (Inbox, All tickets, GitHub Action needed, Analytics Dashboard): 13 → **14**

**Portal:**
- Ticket-thread message body: 14 → **15**
- Ticket-detail author/timestamp lines: 12 → **13**
- Ticket-detail right-rail values: 13 → **14**
- Submit Ticket form labels: 13 → **14**

Untouched on purpose: 10–11px eyebrow labels, 11px table column headers,
11–12px pill text, 12px timestamps in list rows. They're labels, not
content.

### 2026-05-25 — Bridge ticket module UI overhaul (email gate + domain grouping + email-card thread)

**Workstream 1 — Email-connected gate**
- `useEmailConfig(token)` hook (`apps/bridge/src/lib/useEmailConfig.ts`): wraps `GET /config`, returns `{ isConnected, isLoading, refresh }`. Module-level promise cache — single in-flight request shared across pages. `refresh()` busts the cache and re-fetches so the gate clears immediately after save.
- `EmailNotConfiguredGate` component (`apps/bridge/src/components/dashboard/EmailNotConfiguredGate.tsx`): full-page centered card. ADMIN variant has "Connect email" CTA → `/settings/email` plus 3-bullet feature list. Non-ADMIN variant shows "ask your admin" message.
- Gated pages: `/inbox`, `/tickets`, `/tickets/[id]` — render the gate when `!isConnected && !isLoading`. Sidebar not gated (Settings remains reachable).
- `settings/email/page.tsx` calls `refresh()` after successful save and after disconnect, so the gate clears in the same render cycle.

**Workstream 2 — Domain grouping on `/tickets`**
- `buildDomainGroups()` pure helper (`apps/bridge/src/lib/groupTicketsByDomain.ts`): groups `TicketListItem[]` by `user.email` domain, sorts groups by `lastActivity` desc, sorts tickets within groups by `updatedAt` desc.
- `tickets/page.tsx`: collapsed/expanded state per domain persisted to `localStorage` under `bridge.tickets.collapsedDomains`. Group header row: domain name (mono) · ticket count chip · open count chip (blue, only shown if > 0) · last activity · chevron. Ticket rows indented 40px under each group header, reusing the same row JSX.
- Inbox unchanged — flat list with bulk-select stays as-is.

**Workstream 3 — Email-card conversation thread**
- `MessageCard` component (`apps/bridge/src/components/dashboard/MessageCard.tsx`): single component handles all 4 message types via `type`/`isInternal` discriminator. Full-width cards with 4px colored left border: blue (`--d-accent`) for customer REPLY, green (`--d-success`) for agent REPLY, amber (`--d-note-line`) for INTERNAL_NOTE, centered pill for SYSTEM_EVENT. Card header: avatar + name + `<email>` + "to …" + timestamp.
- Old chat-bubble inline JSX in `tickets/[id]/page.tsx` fully deleted and replaced with `<MessageCard>` calls. Deleted helpers: `parseEvent()` (moved into `MessageCard`). Removed `Lock`, `Plus` from lucide-react imports.
- Composer restyled: faux `From: / To:` readonly header above the formatting toolbar on the Reply tab (reads the support address from `GET /config`). All keyboard shortcuts, tabs, and send behavior unchanged.
- `supportEmail` state fetched from `GET /config` on mount; used in `MessageCard` "to …" metadata and the composer hint.

**Portal untouched** — `git diff apps/portal/` returns empty. Customer view keeps chat bubbles.

**Docs**: `docs/atlas/tickets.md` and `docs/atlas/email.md` updated with new UI sections and component table.

### 2026-05-26 — Bridge ticket UI polish (continued)

- **`/tickets` page relabelled "Inbox"** — page heading changed from "All Tickets" to "Inbox". Route and URL unchanged.
- **Sidebar collapses to rail-only on tickets section** — `DashboardSidebar` now renders only the 48 px icon rail when `activeSection === 'tickets'` (aside `width: 48px`, content panel not rendered). Search, status filter, and category filter all live in the page header. The sidebar search input + debounce logic was removed from `Sidebar.tsx` and added to `tickets/page.tsx` (300 ms debounce, Esc clears, `?search=` URL param). GitHub and Analytics sections still show the full 220 px sidebar with their panel content.
- **Code button removed from compose toolbar** — the inline-code format button was removed from the reply/note compose box. Remaining toolbar: Bold (⌘B), Italic (⌘I), Link, List, Paperclip (disabled).

### 2026-05-26 — Bridge ticket UI polish (5 fixes)

- **Sidebar — views/labels removed**: Status and Labels filter sections removed from the sidebar tickets panel. Only a single "All Tickets" view remains (Inbox is accessible from the rail icon; domain navigation is via the group cards). Status + category filter dropdowns moved to the tickets page header.
- **Tickets page header filters**: now shows "All Tickets" title (static) + two dropdowns (All statuses / All categories) + a "Clear" button when any filter is active. All filters are preserved across each other so combining status + category works correctly.
- **Resolved/Closed ticket action**: the "Resolve ticket" button in the right sidebar Actions section is replaced by a static "✓ Resolved" indicator (dimmed, not clickable) when ticket status is RESOLVED or CLOSED.
- **Format toolbar wired up (WYSIWYG)**: Replaced the `<textarea>` with a `contentEditable` div. Bold/Italic use `document.execCommand`; Code wraps selection in a `<code>` node; Link prompts for URL and uses `createLink`; List uses `insertUnorderedList`. ⌘B/⌘I keyboard shortcuts wired to the editor's `onKeyDown`. Body state holds `innerHTML` sent as HTML to the API. `MessageCard` renders HTML bodies via `dangerouslySetInnerHTML` with a simple sanitizer that strips `<script>`, event attributes, and unsafe elements. CollapsedRow snippet strips HTML tags before displaying. Resolved the "Known gap: Markdown toolbar is cosmetic" issue.
- **Category pill in ticket detail header**: replaced plain `{CAT_LABEL[ticket.category]}` text with `<CategoryPill>` — now shows the Lucide icon (Bug / Lightbulb / HelpCircle / CreditCard / Circle) and the colour-coded background that was already used on list rows.
- **Priority colors adapted for light theme**: `PRIORITY_COLOR` and `PRIORITY_BG` in `[id]/page.tsx` changed from hardcoded dark-mode hex values (`#60A5FA`, `#FB923C`, `#F43F5E`) to CSS variables (`var(--d-accent)`, `var(--d-warning)`, `var(--d-danger)` / `*-bg`). These variables already carry correct high-contrast values for light mode (`#2563EB`, `#B45309`, `#B91C1C`). Border changed from `${color}50` (hex alpha — invalid with CSS vars) to `var(--d-border)`. Box-shadow glow changed from `${color}80` to plain `${color}` (CSS var in box-shadow is valid).

### 2026-05-27 — Backfill threading + performance fix

- **Root cause of "emails not grouped"**: `teamSize: 5` caused 5 backfill jobs to run in parallel. A reply email processed concurrently with its parent would fail the `In-Reply-To` DB lookup (parent message not committed yet) and create a new ticket instead of threading — so one email thread produced many separate tickets, breaking domain grouping.
- **Root cause of slow backfill**: each pg-boss job did a fresh `appConfigService.get()` DB call per message, plus the backfill service was double-tracking `backfillProcessed` (once per batch in BackfillService, once per message in InboundEmailProcessor), and MIME blobs were serialised into pg-boss for every message.
- **Fix**: `BackfillService.runBackfill()` now calls `InboundEmailProcessor.processMessage()` directly and inline (no queue), processing each message in strict sequential order. `freshCfg` is fetched once per backfill run and reused for all messages. Progress is tracked per batch. The pg-boss worker remains for live mail only (teamSize: 5, concurrent).
- `InboundEmailProcessor.handle()` renamed to public `processMessage(data, preloadedCfg?)` — accepts an optional pre-fetched AppConfig to skip the per-message DB query when called from BackfillService.
- Both apps pass `tsc --noEmit` clean.

### 2026-05-27 — OAuth/backfill bug fixes

- **`useEmailConfig` OAuth blindspot fixed**: `isConnected` now checks `emailAuthMethod === 'OAUTH' && oauthConnected` in addition to the password check. Previously, OAuth-connected users always saw the "Email not connected" gate on `/inbox`, `/tickets`, and `/tickets/[id]`.
- **Auto-trigger backfill on OAuth connect**: Settings → Email now fires `POST /config/email/backfill/run` (180 days) when landing with `?connected=1` from the OAuth callback. Previously the backfill was only auto-triggered via the password save path.
- **`useBackfillStatus` slow-poll added**: Hook now polls every 30s when IDLE/DONE/FAILED (was stopping entirely). This ensures the Sidebar's backfill dot lights up if a backfill starts while the hook is already mounted (e.g. after clicking "Sign in with Google" on the settings page).
- Both apps pass `tsc --noEmit` clean.

### 2026-05-26 — Email OAuth + historical backfill

- **Schema additions**: `emailAuthMethod` (PASSWORD/OAUTH), `oauthProvider` (GOOGLE/MICROSOFT), `oauthEmail`, `oauthAccessTokenEnc`, `oauthRefreshTokenEnc`, `oauthTokenExpiresAt`, `oauthScopes`, `backfillStatus` (IDLE/RUNNING/DONE/FAILED), `backfillTotal`, `backfillProcessed`, `backfillStartedAt`, `backfillFinishedAt`, `backfillSinceUid` added to `AppConfig`. Three new enums. Applied via `prisma db push`.
- **`EmailOAuthModule`** (`apps/api/src/modules/email-oauth/`): `EmailOAuthService` (getAuthUrl, exchangeCode, disconnectOAuth — Google + Microsoft), `EmailOAuthController` (`GET /config/email/oauth/:provider/start`, `GET /config/email/oauth/:provider/callback` with `@Redirect`, `DELETE /config/email/oauth/disconnect`), `TokenRefresher` (auto-refreshes OAuth access tokens 5 min before expiry, persists to DB).
- **XOAUTH2 in `ImapClientService`**: branches on `emailAuthMethod`: OAUTH → `TokenRefresher.getValidAccessToken()` → `auth: { user, accessToken }`; PASSWORD → existing `auth: { user, pass }`.
- **XOAUTH2 in `EmailService`**: `getTransporter()` is now lazy — for OAuth connections fetches a fresh access token per send via `TokenRefresher`; for PASSWORD returns the static `this.transporter`. All `sendMail` calls updated to use `getTransporter()`.
- **`BackfillService`** (`apps/api/src/modules/email/backfill.service.ts`): opens a dedicated IMAP client (separate from IDLE supervisor), searches by date range, batches 50 UIDs at a time, enqueues at `priority: 0` via new `QueueService.enqueueBackfillInbound()`.
- **`BackfillController`** (`apps/api/src/modules/email/backfill.controller.ts`): `POST /config/email/backfill/run`, `GET /config/email/backfill-status`, `POST /config/email/backfill/run-ai`.
- **`InboundEmailProcessor` updated**: registers worker with `teamSize: 5, teamConcurrency: 1`; detects `source: 'backfill'` and skips `markSeen`, AI enqueue, notifications; increments `backfillProcessed` counter in DB.
- **`QueueService`**: `enqueueInbound` now sets `priority: 10`; new `enqueueBackfillInbound` sets `priority: 0`.
- **`AppConfigService.getSafe()`**: now omits `oauthAccessTokenEnc` + `oauthRefreshTokenEnc`, adds `oauthConnected: boolean`. `disconnectEmail()` also clears all OAuth fields + resets backfill state.
- **Bridge Settings → Email** redesigned: method picker (Google/Microsoft/app password cards) when not connected; connected state shows provider + email + disconnect; password mode has test + save; `BackfillStatusCard` shows progress bar (RUNNING), done state with "Pull full archive" + "Run AI" buttons, and failed state.
- **`MethodPicker`** component: three styled cards with brand logos (Google SVG, Microsoft squares, lock icon for password).
- **`BackfillStatusCard`** component: RUNNING = progress bar + live pct; DONE = success + action buttons; FAILED = retry.
- **`useBackfillStatus`** hook: polls every 5s while RUNNING, stops automatically when done.
- **Sidebar backfill chip**: pulsing blue dot on the Inbox rail icon when `backfillStatus === 'RUNNING'`.
- **OAuth callback**: NestJS API handles the redirect from Google/Microsoft, exchanges code, stores tokens, redirects browser to `{BRIDGE_URL}/settings/email?connected=1`.
- Both `@tmr/api` and `@tmr/bridge` pass `tsc --noEmit` clean.

### 2026-05-27 — IMAP → REST migration (Gmail + Graph) + SSE real-time push

**Full replacement of IMAP-based email with Gmail REST + Microsoft Graph REST.**

**Deleted files:**
- `apps/api/src/modules/email/imap-client.service.ts`
- `apps/api/src/modules/email/inbound.processor.ts`
- `apps/api/src/modules/email/routing.service.ts`
- `apps/api/src/modules/email/verp.util.ts`
- `apps/api/src/modules/email/backfill.service.ts` (IMAP era)
- `apps/api/src/modules/email/backfill.controller.ts` (IMAP era)

**New modules / files added:**
- `apps/api/src/modules/email-sync/` — full REST sync module:
  - `providers/mail-provider.interface.ts` — `IMailProvider` interface
  - `providers/gmail.provider.ts` — Gmail REST adapter (`history.list`, `threads.get`, `settings/sendAs`)
  - `providers/graph.provider.ts` — Microsoft Graph adapter (`messages/delta`, `conversationId` grouping)
  - `providers/provider-factory.ts` — `for(cfg)` factory
  - `thread-ingestion.service.ts` — provider-agnostic ingestion pipeline (upsert User/Ticket/Messages, SSE broadcast)
  - `customer-resolver.service.ts` — picks non-alias sender; agent address never becomes User
  - `email-sync-backfill.service.ts` — foreground 180d + unbounded background archive; resumes on bootstrap
  - `live-poller.service.ts` — `@Cron('*/30 * * * * *')`, gated by `EMAIL_SYNC_LIVE_POLL=1`
  - `email-sync.controller.ts` — `/sync/backfill/run`, `/sync/status`, `/sync/archive/cancel`, `/sync/resync`
  - `util/with-retry.ts` — exponential backoff for 429 errors
  - `util/strip-subject.ts` — strips Re:/Fwd: prefixes
- `apps/api/src/modules/events/` — SSE module:
  - `sse.service.ts` — RxJS Subject broadcast service
  - `sse.controller.ts` — `GET /api/v1/events?token=...` (@Sse, JWT via query param)
  - `events.module.ts` — `@Global()`, exports SseService
  - `event.types.ts` — `SseEvent` discriminated union

**Modified files:**
- `apps/api/src/modules/email/email.service.ts` — removed SMTP-password path; OAuth-only; `getFromAddress/getDomain` now use `oauthEmail`; added `sendViaGraph()` for Microsoft
- `apps/api/src/modules/email-oauth/email-oauth.service.ts` — removed `emailAuthMethod` field (dropped from schema); emits `OAUTH_CONNECTED` via AppEventsService after token storage
- `apps/api/src/modules/email-oauth/token-refresher.ts` — added `refreshLocks` Map to dedupe concurrent refreshes; Microsoft scope updated to `Mail.ReadWrite Mail.Send`
- `apps/api/src/modules/config/config.service.ts` — removed IMAP/SMTP fields from `getSafe()`; added `findActiveOauth()`, `resumingArchive()`, `setCheckpoint()`
- `apps/api/src/modules/queue/queue.service.ts` — removed `enqueueInbound()` + `enqueueBackfillInbound()`
- `apps/api/src/common/events/app-events.service.ts` — added `OAUTH_CONNECTED` event + `emitOAuthConnected()` / `onOAuthConnected()`
- `apps/api/src/app.module.ts` — added `EmailSyncModule`, `EventsModule`
- `packages/db/prisma/schema.prisma` — removed all IMAP/SMTP/backfill fields and `EmailAuthMethod`/`BackfillStatus` enums; added `oauthAliases`, `gmailHistoryId`, `graphDeltaLink`, `archivePageToken`, `archiveStatus` (ArchiveStatus enum), `archiveTotalSeen`, `externalThreadId @unique`, `externalProvider`, `externalMessageId @unique`

**Bridge:**
- `apps/bridge/src/lib/sseEventBus.ts` — new in-process pub/sub bus
- `apps/bridge/src/lib/useSseEvents.ts` — opens single EventSource; exponential backoff reconnect
- `apps/bridge/src/components/SseProvider.tsx` — client component; mounts hook once per session
- `apps/bridge/src/app/layout.tsx` — `<SseProvider>` added inside `<AuthProvider>`
- `apps/bridge/src/app/inbox/page.tsx` — subscribes to `ticket-created` + `ticket-updated`
- `apps/bridge/src/app/tickets/[id]/page.tsx` — subscribes to `message-created` (for current ticket)
- `apps/bridge/src/lib/useBackfillStatus.ts` — now hits `/api/v1/sync/status`; subscribes to `archive-progress` SSE
- `apps/bridge/src/lib/useEmailConfig.ts` — simplified; `isConnected = oauthConnected`
- `apps/bridge/src/app/settings/email/page.tsx` — removed IMAP/SMTP config forms; OAuth-only method picker
- `apps/bridge/src/components/settings/email/MethodPicker.tsx` — removed password option
- `apps/bridge/src/components/settings/email/BackfillStatusCard.tsx` — uses `archiveStatus` + `archiveTotalSeen`

**Schema migration:** `npx prisma db push --accept-data-loss` (dropped IMAP/SMTP/backfill columns + enums).

Both `@tmr/api` and `@tmr/bridge` pass `tsc --noEmit` clean.

**Docs:** `docs/atlas/email.md` rewritten; `docs/atlas/realtime.md` created; `STATE.md` decisions table updated.

### 2026-05-25 — Bridge ticket UI — domain group cards, per-domain page, Gmail thread, inline compose

**Workstream 1 — Domain group card redesign (`/tickets`)**
- Default state changed to **all collapsed**. Tracking logic inverted: `expandedDomains: Set<string>` (empty = all collapsed) stored in `localStorage` under `bridge.tickets.expandedDomains`. Previous key `bridge.tickets.collapsedDomains` is superseded.
- Added `flexShrink: 0` to every domain card `<div>` — this was the root cause of cards "shrinking in half" when neighbouring groups were expanded. Flex column containers don't overflow until every child has `flexShrink: 0`.
- **Two-zone group header**: left zone (Google favicon + domain name + ticket/open count chips) navigates to `/tickets/domain/[domain]`; right zone is a standalone `<button>` (border + hover background) that toggles expand/collapse. No `e.stopPropagation()` needed — no shared parent click handler.
- `DomainFavicon` component: tries Google favicon service, falls back to 2-letter abbr on `onError`.

**Workstream 2 — Per-domain page (`/tickets/domain/[domain]`)**
- New Next.js dynamic route. Requires dev server restart on first creation (Next.js App Router does not hot-add new `[param]` segments).
- Data: `GET /tickets?limit=100&search=@{domain}` (server pre-filter by email substring) + client-side exact-domain check `email.split('@')[1].toLowerCase() === domain` for precision.
- Hero header: 48 px `DomainFavicon`, 22 px/700 domain name, ticket count + open count, "← All Tickets" back button, status filter `<select>` with chevron overlay.
- Flat ticket list with column headers and 52 px rows. No preview panel — row click → `/tickets/[id]`.

**Workstream 3 — TicketPreviewPanel removal**
- Panel component deleted from `TicketPreviewPanel.tsx`; utility exports (`CategoryPill`, `STATUS_CLS`, `STATUS_LABEL`, etc.) retained in the same file — still imported by Inbox, All Tickets, domain page, GitHub page.
- All ticket-row `onClick` handlers updated from `setSelectedId(id)` → `router.push('/tickets/${id}')` across Inbox, All Tickets, domain page.
- TypeScript errors fixed post-removal: two stray `}` left after removing the `{sel && <span>}` JSX fragments, and one `useMemo` declared before its `domainFilter` dependency.

**Workstream 4 — Gmail-style conversation thread**
- `MessageCard` redesigned: avatar (36 px circle) sits **outside** the card in a flex row; card uses full border-radius + `boxShadow` instead of a left color bar. `collapsed` state managed internally — clicking the card header collapses to a slim single-row (avatar + name + snippet + timestamp); clicking the row expands. `CollapsedRow` sub-component handles the slim state with hover background.
- `splitQuoted()` helper: detects `On … wrote:` quoted headers, `>`-prefixed line blocks, and `--` signature delimiters. Quoted content hidden by default behind a `···` expand button (`QuoteToggle` component).
- `ReplyActions` sub-component: "↩ Reply" and "🔒 Note" buttons rendered as a footer row inside the last message card (passed via `isLast`, `onReply`, `onNote` props). Hidden while compose is open (`isLast={i === lastIdx && !showCompose}`).
- **Inline compose** replaces the persistent bottom composer: renders as a message-card-shaped `<div>` directly below the last message in the scroll container. Agent avatar on left (green); header shows `↩ AgentName <support@…> to customer@…` for replies, amber lock icon for notes; "Switch to reply/note" link + × close. `autoFocus` on textarea; `useLayoutEffect` + `scrollIntoView` ensures the compose area is visible when opened. Escape closes; ⌘↵/Ctrl↵ sends (via `useCallback` on `sendMessage`).
- **Send CTA simplified**: formatting toolbar on left; "Send & Resolve" ghost button (conditional on body content) + plain blue "Send" button (always rendered, `opacity: 0.35` when empty). Removed the split-button chevron — reduces visual noise.
- **AI Analysis moved to right sidebar**: removed from the message scroll area; added as a new sidebar section between "Ticket" metadata and "GitHub". Shows CSAT + Effort score tiles side by side, then summary text.

**Docs**: `docs/atlas/tickets.md` updated — new sections for domain group cards, per-domain page, Gmail thread design, TicketPreviewPanel removal, inline compose, and five new Notable Decisions entries.

### 2026-05-27 — Inbox routing consolidation + backfill counter fixes

**Routing: single Inbox page**
- Old flat `/inbox` page (bulk-select flat list) deleted.
- Domain-grouped `/tickets` page moved to `/inbox` — this is now the one and only Inbox.
- `/tickets/[id]` (ticket detail) and `/tickets/domain/[domain]` (per-domain drill-down) remain at their URLs.
- All navigation updated: sidebar rail → `/inbox`; domain page back button → "← Inbox"; root redirect, auth redirect, ticket detail "back" link all already pointed at `/inbox`.
- Sidebar: the wrongly-added "Inbox / All Tickets" panel (added in a prior session) was reverted; tickets section remains rail-only (48 px, no panel).

**Bug: P2002 concurrent upsert (`ThreadIngestionService`)**
- `user.upsert()` outside the transaction still races when `processBatch` runs 5 concurrent threads inserting the same customer email.
- Fix: catch `P2002` (`PrismaClientKnownRequestError`) and fall back to `findUnique` — the winning thread already inserted the row.

**Bug: archiveTotalSeen stuck at 0**
- Root cause 1: foreground `processBatch` used fire-and-forget `void db.update()` in the chunk callback — SSE broadcast could fire before the DB write committed. Next 5s poll hit `/sync/status` and returned `archiveTotalSeen: 0` from the DB, overwriting the SSE count.
- Root cause 2: `useBackfillStatus.setStatus(s)` replaced the whole state including a higher SSE-updated count with a lower stale poll value.
- Fix 1: callback changed to `async`; `await db.update()` before broadcasting SSE so DB is always ahead of the client.
- Fix 2: poll `setStatus` now uses `Math.max(polled.archiveTotalSeen, prev.archiveTotalSeen)` — stale polls can never roll the counter back.

**Feature: `X / Y emails retrieved` progress display**
- `archiveTotalEstimate Int?` added to `AppConfig` schema (`prisma db push`).
- Persisted immediately before the foreground `processBatch` starts — first poll already returns the denominator.
- SSE `archive-progress` event extended with optional `total` field; `sseEventBus` type updated.
- `useBackfillStatus` carries `archiveTotalEstimate`; SSE keeps it in sync via `ev.total ?? prev`.
- `ArchiveProgressCard` refactored to use `useBackfillStatus` (SSE-reactive, no separate polling).
- Shows "**5 / 247 emails retrieved**" during foreground (proportional fill bar). Background archive shows "**1,234 emails retrieved**" with indeterminate animated bar (total unknown).
- `GET /sync/status` now returns `archiveTotalEstimate`.

### 2026-05-27 — Email sync hardening + file logging (session 3)

**Unlimited archive**
- Removed the 300-thread foreground cap. Archive is now a single phase: fetch `threadsTotal` from Gmail profile → set `archiveTotalEstimate` → run full `listAllThreadIds` loop. `fetchTotalThreadCount()` and `fetchCurrentHistoryId()` added to `GmailProvider`. `setInitialCheckpoint` moved to archive start AND kept at archive end.

**Ticket timestamps from email dates**
- New tickets get `createdAt = firstMessage.sentAt`, `updatedAt = lastMessage.sentAt`. Updates to existing tickets bump `updatedAt` to the latest new message's sentAt. Fixes inbox sort order — portal tickets always float above old archived emails.

**Cancel / Resume archive**
- New `POST /sync/archive/resume` + `EmailSyncBackfillService.resumeArchive()` — sets status `RUNNING` without resetting `archivePageToken` or `archiveTotalSeen`. At most 100 threads re-processed on resume. Old "Resume" button was calling `startForeground()` which reset everything.

**Disconnect / Reconnect**
- Both disconnect and OAuth connect callback now clear `archiveTotalEstimate`. No data loss — existing tickets/messages preserved. Re-connect triggers full archive; dedup guards prevent duplicates.

**Portal ticket reply matching (3-level lookup)**
- Portal tickets have `externalThreadId = null`. Fixed with fallback lookup chain: (1) `externalThreadId` fast path, (2) `inReplyTo` → stored agent `messageId` on Message records, (3) `<ticket-{emailThreadId}@domain>` synthetic ID → `ticket.emailThreadId` lookup. All match paths stamp `externalThreadId` for future fast-path hits.

**Live poller fixes**
- `messagesAdded[].message` checked before `messages[]` in Gmail History API — more reliable for new inbound detection.
- Per-thread try/catch: a failing thread no longer aborts the poll or blocks checkpoint advancement.
- RFC `messageId` dedup: pre-create `findUnique({ where: { messageId } })` skips Sent-copy duplicates before hitting the `@unique` constraint.

**File logging**
- `FileLogger` (`apps/api/src/common/logger/file-logger.ts`) extends `ConsoleLogger`. JSON lines → `apps/api/logs/app-YYYY-MM-DD.log` (daily rotation). Wired as NestJS app logger in `main.ts`. `apps/api/logs/` gitignored.
- Tail: `tail -f apps/api/logs/app-$(date +%Y-%m-%d).log | jq -r '"\(.ts) [\(.level)] \(.context): \(.msg)"'`

**Manual poll endpoint**
- `POST /api/v1/sync/poll/now` — triggers immediate poll cycle without waiting for 30s cron. Used for debugging.

### 2026-05-28 — Portal auth page: configurable layouts + Google OAuth wiring

**Schema**
- `AuthLayout` enum (`MINIMAL` | `BRANDED`) + 4 new `AppConfig` fields: `portalAuthLayout`, `portalHeroHeadline`, `portalHeroSubheadline`, `portalFeatures`. Applied via `prisma db push`.

**Portal auth page rewrite** (`apps/portal/src/app/auth/page.tsx`)
- Deleted hardcoded `CHECKLIST` constant and fake Mia Chen/Northwind testimonial block entirely.
- Now reads `portalAuthLayout` from `useAppConfig()` and branches:
  - `MINIMAL` (default): single-column, logo + appName above a centered form card, subtle primary-color radial gradient background.
  - `BRANDED`: split 55/45 dark-left panel with operator's headline, subheadline, and feature checklist; form on the right.
- Form JSX extracted into shared `AuthForm` component (`apps/portal/src/components/auth/AuthForm.tsx`) used by both layouts.
- `useSearchParams` wrapped in `<Suspense>` to avoid Next.js static-rendering error.

**Portal Google OAuth**
- `apps/portal/src/lib/googleOAuth.ts`: `redirectToGoogle()` builds consent URL with CSRF nonce stored in `sessionStorage`; `verifyAndConsumeState()` verifies and consumes it on callback.
- `apps/portal/src/app/auth/google/callback/page.tsx`: verifies state, POSTs `{code, redirectUri}` to `POST /auth/google`, calls `signIn`, redirects to `/tickets`. Mirrors Bridge GitHub OAuth callback pattern (15 s timeout, `cancelled` ref for Strict Mode).
- Error paths: `access_denied` → `/auth?error=google_cancelled`; state mismatch → `/auth?error=invalid_state`; API failure → inline error message.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` added to root `.env.example`.

**Bridge branding page** (`apps/bridge/src/app/settings/branding/page.tsx`)
- "Portal auth page" card added in left column (after Email card): layout radio (Minimal/Branded), headline input, subheadline textarea, feature list (add/remove, max 5).
- Save button disabled with tooltip when BRANDED layout selected without headline + ≥1 feature.
- BRANDED fields persist across layout toggles (form state is kept, not cleared on switch to MINIMAL).
- `AuthPagePreview` component added to right column — pure client-side render of both layouts using live unsaved form state. No API call.

**New files**
- `apps/portal/src/components/auth/AuthForm.tsx`
- `apps/portal/src/lib/googleOAuth.ts`
- `apps/portal/src/app/auth/google/callback/page.tsx`
- `apps/bridge/src/components/settings/branding/AuthPagePreview.tsx`

**Type-checks**: `@tmr/api`, `@tmr/bridge`, `@tmr/portal` all pass `tsc --noEmit` clean.

### 2026-05-28 — Google OAuth bug fixes + Portal nav polish

**Google OAuth fixes**

- **Root cause 1 — missing env vars**: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` were blank in `.env`. API's `googleAuth()` received an error response from Google's token endpoint (e.g. `{"error":"invalid_client"}`), which was silently cast to `GoogleTokenResponse`. `tokenData.access_token` was `undefined`, the userinfo call returned an error object, and Prisma crashed with `findUnique({ where: { googleId: undefined } })`.
  - Fix: `auth.service.ts` now validates `tokenData.access_token` immediately after parsing the token response and throws `InternalServerErrorException` with Google's error description if absent. Same guard added to `agentGoogleAuth`. `GoogleTokenResponse` type extended with `error?`/`error_description?` fields.

- **Root cause 2 — React Strict Mode double-invoke**: In development, React 18 Strict Mode mounts → unmounts → remounts effects. The callback's first run consumed the `sessionStorage` nonce and set `cancelled = true` (via cleanup). The second run found an empty sessionStorage, `verifyAndConsumeState()` returned false, and the page redirected to `/auth?error=invalid_state`.
  - Fix: `handledRef = useRef(false)` added to `apps/portal/src/app/auth/google/callback/page.tsx`. Effect returns early on the second mount. Identical to the pattern in Bridge's GitHub OAuth callback.

- **Database baseline**: initial migration `20260517060918_init` was unapplied. Ran `prisma migrate resolve --applied` to baseline it; `prisma db push` confirmed schema is in sync.

**Portal nav polish** (`apps/portal/src/components/portal/PortalNav.tsx`)

- "Support" label restored as a small all-caps badge pill (`SUPPORT`) right of the app name — uses border + muted text so it reads as metadata, not as part of the brand name.
- "My Tickets" and "Submit a Ticket" nav links removed — redundant alongside the "New ticket" button and the page heading.
- Sign-out button now shows `<LogOut size={13} /> Sign out` text label with border. Hover: fills with surface background, darkens border, shifts text to full body color (CSS transition 150 ms).

### 2026-05-28 — Portal UI redesign + attachment backend fix (session 5)

**Phase A — Attachment backend (all silent data bugs, no schema changes)**

- `MessagesService.create()` — `dto.attachmentIds` was accepted but discarded. Now runs `tx.attachment.updateMany({ where: { id: { in: dto.attachmentIds }, ticketId, messageId: null } })` inside the existing transaction, then re-fetches the message with `include: { attachments: true }` so the response always contains the populated array. Two safety guards: `ticketId` (cross-ticket prevention) + `messageId: null` (re-link prevention).
- `mail-provider.interface.ts` — added `ParsedAttachment` interface and optional `attachments?: ParsedAttachment[]` to `ParsedMessage`.
- `gmail.provider.ts` — `parseGmailMessage()` now walks `payload.parts` recursively via `collectAttachmentParts()`. Each part with a `filename` + `body.attachmentId` becomes a `ParsedAttachment`. New public method `fetchAttachmentBytes(gmailMessageId, gmailAttachmentId)` fetches attachment bytes from the Gmail Attachments API and decodes base64url. Microsoft Graph (`GraphProvider`) does not yet implement attachment extraction.
- `files.service.ts` — extracted a new public `storeBuffer(buffer, opts)` method (MinIO PUT + presigned URL + `prisma.attachment.create()`). Refactored `uploadFile()` to call it. `storeBuffer` accepts optional `messageId` so the Attachment row can be linked in one step.
- `thread-ingestion.service.ts` — injected `FilesService`. After each `tx.message.create()`, pushes `{ messageId, ticketId, attachments }` to a `pendingAttachments` array. After the transaction commits, iterates the array, fetches bytes via duck-typed `fetchAttachmentBytes` (only present on `GmailProvider`), calls `storeBuffer`. Skips attachments > 25 MB (warn log); catches per-attachment errors (error log + continue) — a bad attachment never fails the whole ingest.
- `email-sync.module.ts` — added `FilesModule` import so `FilesService` can be injected.

**Phase B — Portal ticket detail redesign** (`apps/portal/src/app/tickets/[id]/page.tsx`)

- Container: `maxWidth: 960 → 1180`, `padding: '32px 24px 80px' → '32px 32px 96px'`.
- Page header: title row (H1 30px/700/-0.02em, ellipsis overflow) + right-side "Copy link" ghost button + mono displayId copy button (moved out of sidebar); meta row below (status pill · category pill · Opened date · Last activity); 1px divider anchors the header.
- Thread: fully replaced asymmetric blue-bubble / left-border-agent system with **Zendesk-style uniform threaded cards** (plan B4). Every message: 36px circle avatar (customer = accent fill, agent = #3F3F46), name row, optional Support badge (agents only), timestamp right-aligned, body at `paddingLeft: 48px`, attachments row. `1px solid var(--p-border-2)` divider between messages; no border on the last.
- System events: borderless centered text in `11px var(--p-text-4)`, flanked by short rule lines. No pill background.
- Attachment chips: single uniform chip (white bg, border, Paperclip icon, filename, size) used for all messages. Old divergent translucent-white and bordered variants removed.
- Reply composer: "Reply" / "Markdown supported" labels moved above the card as a caption row. Card uses `borderRadius: var(--r-lg)` + soft shadow. `minHeight: 120`. Paperclip icon added to toolbar.
- Sidebar: `width: 240 → 300`, `position: sticky; top: 24; alignSelf: flex-start`. Status card: tinted band removed, single padded card with `STATUS` eyebrow, dot + label in status color, assignee row below divider. Details card: no inner header divider, Ticket row moved to page header. GitHub card: `LINKED ISSUE` eyebrow, hover background via CSS `.linked-issue-card:hover`, title 2-line clamp.
- Responsive: `<style>` block with `@media (max-width: 1024px)` — sidebar stacks below thread, cards in 2-column grid; below 640px single column.
- Loading skeleton updated to match new proportions (1180px, 300px sidebar, 36px avatars).

**Phase C — Tickets list polish** (`apps/portal/src/app/tickets/page.tsx`)

- Container: `maxWidth: 860 → 1180`, `padding: '48px 24px 80px' → '48px 32px 80px'`.
- Row redesign via `.ticket-row` CSS class: `margin: 0 -12px; padding: 16px 12px; border-radius: 6px; transition: background 120ms ease`. Hover: `background: var(--p-surface)`.
- ChevronRight: `.row-chevron` class, `opacity: 0 → 1` on row hover. Removed always-visible indicator.
- Unread dot moved to leftmost slot (12px reserved column, always present for alignment).
- Avatar column: 32px circle with ticket-title initials (no API change required; `lastMessage` has no author).
- Last message preview: `ticket.lastMessage.body` in `12.5px var(--p-text-3)` single-line ellipsis below the title. Row padding increased to 16px to fit.
- Status badge column: 130px → 120px.

**Docs updated**: `docs/atlas/messages.md` (attachmentIds now works), `docs/atlas/email.md` (inbound attachment ingestion section), `docs/atlas/portal-ticket-view.md` (new file). `pnpm atlas:gen` run to refresh `_generated/`.
- `usePathname` import removed (no longer needed after link removal).

**Tickets page hover** (`apps/portal/src/app/tickets/page.tsx`)

- "New ticket" button: hover darkens 15% via `color-mix`, adds soft shadow; active press scales to 0.98. Uses CSS class + scoped `<style>` tag — works with any accent color set in branding.

### 2026-05-29 — Attachment pipeline root-cause audit + portal reply upload + nav polish

**Root-cause audit (all 4 bugs, all confirmed with live API calls)**

After the Phase A–E implementation was complete but attachments were still invisible, a DB check revealed zero `Attachment` rows — no uploads had ever succeeded. Four independent bugs were found and fixed:

1. **`ZodValidationPipe` on `@Body` blocked all file uploads** (`files.controller.ts`). NestJS pipes execute before the method body. Multer parses a multipart request body as `{}`. `ZodValidationPipe(uploadLinkSchema.optional())` validated `{}` against the `linkUrl`-required schema and threw `BadRequestException` — before the method ever checked the `@UploadedFile()`. Fix: removed the pipe from `@Body`; moved validation inline only for the link-upload path. **This was the root cause of zero attachment rows in the DB.**

2. **`MessagesService.create()` ignored `attachmentIds`** — `dto.attachmentIds` was received but the service never called `updateMany` to link them to the message. Fixed in Phase A (previous session); already in place.

3. **`TicketsService.create()` only set `ticketId`, not `messageId`** on attachments linked during ticket creation. Fixed in Phase A (previous session); already in place.

4. **`attachment.updateMany` guard too strict for reply uploads** (`messages.service.ts`). Freshly-uploaded files have `ticketId: null` — they haven't been pre-scoped to a ticket. The guard `where: { ticketId }` (exact match required) meant the `updateMany` matched zero rows and attachments were never linked to reply messages. Fix: changed to `OR: [{ ticketId }, { ticketId: null }]`; also writes `ticketId` into `data` so the attachment gets scoped at link time.

**Verification (end-to-end curl test)**
- `POST /files/upload` → MinIO object created, `Attachment` row in DB with correct UUID filename.
- Presigned URL serves the file bytes directly from MinIO.
- `POST /tickets/:id/messages { attachmentIds: [id] }` → response includes `message.attachments` array with the linked row; DB confirms `ticketId` + `messageId` both set.

**Portal reply composer — file upload wired** (`apps/portal/src/app/tickets/[id]/page.tsx`)
- Hidden `<input type="file" ref={fileInputRef}>` added above the composer card.
- Paperclip toolbar button calls `fileInputRef.current.click()` (was a no-op before).
- `handleFileSelect`: uploads the file to `/api/v1/files/upload?ticketId=…` with `Authorization: Bearer {token}`, appends the returned `Attachment` to `replyAttachments` state.
- Pending attachments show as removable chips between the textarea and the toolbar (Paperclip icon + filename + × button).
- `sendReply`: includes `attachmentIds: replyAttachments.map(a => a.id)` in the POST body; clears `replyAttachments` on success.
- Paperclip button shows accent color while uploading (`isUploading` state), cursor switches to `wait`.

**Portal nav — "My tickets" link** (`apps/portal/src/components/portal/PortalNav.tsx`)
- Added a `Link href="/tickets"` in the signed-in nav row, left of the user avatar.
- Uses `.portal-nav-link` CSS class with hover surface background, matching the sign-out button style.
- Visible only when `user` is defined (signed-in state); not shown to guests.

### 2026-05-29 — Testing framework foundation

**Plan**: `~/.claude/plans/hi-i-am-flickering-whale.md` — four-layer test framework (unit / integration / contract / E2E) plus security, migration, concurrency, parsing, external-service edge cases. Backed by a regression catalogue tying every named STATE decision to a named test.

**Atlas drift fixes** (committed in same PR):
- `docs/atlas/README.md` — system diagram + Email row updated from IMAP IDLE to Gmail REST + Graph
- `docs/atlas/email.md` — already accurate, stack confirmed
- `docs/atlas/queue.md` — rewritten: real queues are AI (`ai:analyze-message`, `ai:classify-ticket`, `ai:request-csat`); the old `email.inbound` queue never existed in current code
- `docs/atlas/messages.md` — customer-reply flowchart, key files, decisions, gap text all updated to reference `email-sync/thread-ingestion.service.ts` (not the dead `inbound.processor.ts`); portal upload `?ticketId=...` query param removed
- `docs/atlas/tickets.md` — creation paths flowchart now shows ThreadIngestionService funnel separately from TicketsService.create
- `docs/atlas/settings.md` — live-update sequence references `OAUTH_CONNECTED` → backfill listener instead of removed `ImapClientService.reconnect()`
- `docs/atlas/ai.md` — per-queue retry table added (`analyze-message` 3×10s exp, `classify-ticket` 3×30s exp, `request-csat` 2 retries with 30 min `startAfter`)

**Test infrastructure delivered**:
- `tests/vitest.unit.config.ts` / `.contract.config.ts` / `.security.config.ts` — Vitest configs per layer
- `tests/jest.integration.config.js` — Jest config for the integration suite (Vitest+Nest ESM/CJS friction made Jest the pragmatic choice for backend tests)
- `tests/playwright.config.ts` — three projects (portal, bridge, cross-app), webServers boot api/portal/bridge against the test DB
- `tests/integration/global-setup.ts` — boots Postgres + MinIO Testcontainers once per run, applies schema via `prisma db push`
- `tests/integration/setup.ts` — per-file Nest boot + TRUNCATE between tests
- `tests/integration/harness.ts` — typed harness exposing `harness.request()` (supertest), `harness.prisma`, `harness.get<T>(token)` (Nest provider lookup)
- `tests/integration/factories/index.ts` — typed builders for User / Agent / Ticket / Message + JWT signer matching `AuthService.issueToken()`
- `tests/integration/msw/` — MSW handlers split by provider (gmail, graph, gemini, github, google-oauth, microsoft-oauth) — lazy-loaded by tests that need them so the smoke suite stays MSW-free
- `tests/e2e/global-setup.ts` + `tests/e2e/flows/F1.spec.ts` — Playwright scaffold for the headline portal→bridge SSE flow
- `tests/contract/routes-snapshot.spec.ts` + `tests/contract/sse-coverage.spec.ts` — atlas drift guard
- `tests/unit/api/strip-subject.spec.ts` — sample unit test
- `tests/regression-catalogue.md` — 60+ named-bug catalogue tying STATE decisions to named tests
- `tests/README.md` — author-facing framework guide
- `.github/workflows/test.yml` — 9 CI jobs (lint, unit, contract, integration, security, e2e, atlas-drift, migration-safety, coverage-gate)

**Status (as of session end)**:
- Unit suite: 9 tests passing (1 file)
- Contract suite: 5 tests passing (2 files)
- Integration suite: **7 tests passing** (2 files) — including R21 `TransformResponseInterceptor` wraps once, R32 soft-delete exclusion, R35 ticket number monotonicity, R37 internal-note visibility filter for users
- E2E suite: F1 scaffold written; not yet runnable end-to-end (webServers need warm-start)

**Bugs discovered while writing tests** (recorded in `tests/regression-catalogue.md` "Discovered edge cases" section):
1. `stripSubjectPrefixes("  Re: hello  ")` returns `"Re: hello"` — regex anchors at `^` without trimming leading whitespace first. Test asserts current (buggy) behavior; fix tracked.
2. `TicketsController.list()` response is double-wrapped: `TicketsService.list` returns `{ data: [...], meta }`, then `TransformResponseInterceptor` wraps again to `{ data: { data, meta } }`. Either rename the service shape to `{ items, meta }` or teach the interceptor to detect already-wrapped responses.

**CLAUDE.md item 5 added**: "Touched any service method, controller route, or schema field? → add or update the matching test." Tests now travel with code the same way docs already do.

**Tooling additions** (root devDependencies): jest, ts-jest, @types/jest, vitest, @vitest/coverage-v8, @playwright/test, testcontainers, @testcontainers/postgresql, msw, supertest, @types/supertest, axe-core, @axe-core/playwright, unplugin-swc, @swc/core, jest-environment-node. Per-app additions: @testing-library/{react,jest-dom,user-event,dom}, jsdom, @vitejs/plugin-react.

**Decision** added below: Jest for integration / Vitest for unit + contract — backend uses Nest's native test runner, frontend uses the modern ESM-friendly one.

---

### 2026-05-30 — Session 31 (Athena AI First Responder)

**Implemented**: Full Athena AI First Responder bot per plan `hi-i-am-flickering-whale.md`.

**Data model** (migration `20260530000000_athena_bot`):
- `AgentRole` enum: `AGENT` renamed to `PRIMARY_AGENT`, added `SECONDARY_AGENT`
- New models: `Shift`, `KnowledgeSource`, `KnowledgeChunk` (pgvector 768-d + HNSW + pg_trgm GIN), `BotInteraction`
- `AppConfig` gains: `botEnabled`, `botProvider`, `botApiKeyEnc`, `botModelChat`, `botModelEmbedding`, `botRetrievalThreshold`, `botConfidenceThreshold`, `botFallbackAgentId`, `botName`, `botAvatarUrl`, `kbRootUrl`, `kbCrawlStatus`, `kbCrawlPagesSeen`, `kbCrawlPagesIndexed`, `kbCrawlError`, `kbLastRecrawledAt`, `timezone`
- `Message` gains: `authorBotName` (nullable; set when bot generates the reply)
- `AiUsage` gains: `userId` (nullable; null for crawl/index ops that have no user context)
- `AiOperation` enum: `ATHENA_EMBED`, `ATHENA_GENERATE`, `KB_CONTEXTUAL_SUMMARY` added
- pgvector + pg_trgm extensions installed in Postgres container

**Backend modules**:
- `BotModule` (`apps/api/src/modules/bot/`): `BotService`, `RetrievalService` (RRF hybrid), `GeneratorService` (Gemini embed+generate), `ShiftResolverService`, `RespondToNewTicketWorker`
- `KnowledgeBaseModule` (`apps/api/src/modules/knowledge-base/`): `CrawlerService` (sitemap→BFS), `ChunkerService` (heading-aware markdown), `ContextBuilderService` (contextual retrieval), `EmbeddingService`, `IndexerService`, `KnowledgeBaseController`, `CrawlAndIndexWorker`
- `ShiftsModule` (`apps/api/src/modules/shifts/`): CRUD for Shift rows (used by bridge settings page)
- `QueueService` gains: `enqueueBotRespond`, `enqueueKbCrawl`, `enqueueKbIndexPage`
- `TicketsService.create()` now enqueues bot respond job after ticket creation

**Frontend**:
- `apps/bridge/src/app/settings/ai-assistant/page.tsx` — 3-card settings page (provider, KB, bot behavior)
- `apps/bridge/src/app/settings/shifts/page.tsx` — shift management with toggle/create/delete
- `DashboardSidebar` — Bot icon (`/settings/ai-assistant`) and Calendar icon (`/settings/shifts`) added to rail
- `MessageCard` (bridge) — bot messages render with gradient Sparkles avatar + "AI" badge
- Portal ticket thread — `authorBotName` messages render with ✨ avatar + "AI assistant" badge

**Tests**:
- Unit: `tests/unit/api/shift-resolver.spec.ts` (14 tests), `tests/unit/api/chunker.spec.ts` (14 tests), `tests/unit/api/rrf-fusion.spec.ts` (10 tests) — all passing
- Integration: `tests/integration/bot.respond.spec.ts` (R61–R65 + idempotency), `tests/integration/shift-routing.spec.ts` (R66–R68), `tests/integration/ai-usage.per-user.spec.ts` (R69–R70)
- Regression catalogue: R61–R70 added

**Docs**:
- `docs/atlas/bot.md` created — full pipeline, stack, decisions, key files
- `docs/atlas/README.md` — Bot row added to feature table
- `pnpm atlas:gen` run → 74 routes / 25 modules / 22 models now reflected in `_generated/`

**Key decisions (added to Decisions table above)**:
| Decision | Why |
|---|---|
| pgvector in existing Postgres | Zero new infra; help-center corpus is small |
| pg-boss queue for bot (async) | Ticket creation stays fast; bot runs in ~3-8s background window |
| Hybrid dense+sparse retrieval (RRF) | Pure vector misses exact product names / error codes |
| Contextual retrieval (Anthropic 2024) | Doc-level summary prepended to every chunk; +35-50% recall at trivial cost |
| Safety overrides in worker | belt-and-suspenders: empty citations → escalate; external citation → escalate |
| `AgentRole.AGENT` → `PRIMARY_AGENT` | Semantically correct; all existing agents remain assignable as first responders |
| `botApiKeyEnc` excluded from getSafe() | Follows same pattern as oauthAccessTokenEnc; never exposed via API |

---

## Session — 2026-05-30 (AI Settings UI cleanup)

**Changes**:
- Removed the standalone Bot (AI Assistant) icon from the main sidebar rail
- Added "AI Assistant" entry to the Settings nav (under AI section) — it now lives alongside AI Usage & Cost
- Removed from AI Assistant page: embedding model field (hardcoded as `text-embedding-004`), Test connection button, entire Bot Behavior card (retrieval threshold, confidence threshold, bot name, enabled toggle)
- Moved "Fallback agent" setting to Settings → Agents page (new AI First-Responder card at the bottom)
- Fixed `sources` crash: `setSources(res.data ?? [])` to guard against undefined API response
- Fixed `EmbeddingService` and `ContextBuilderService` to resolve the Gemini API key from `AppConfig.botApiKeyEnc` (DB) at runtime when `GEMINI_API_KEY` env var is not set
- Fixed crawler to interleave crawl+index (previously crawled all 71 pages then indexed — progress counter stayed at 0/0 during the entire crawl phase); now each page is indexed as it's discovered and `kbCrawlPagesSeen`/`kbCrawlPagesIndexed` update in real time
- Root cause of 0 pages indexed: `text-embedding-004` 404 from Gemini API (model not accessible for the configured API key)

**Docs**: `docs/atlas/ai.md` and `docs/atlas/settings.md` updated

---

## Session — 2026-05-31 (Bot behavior backend cleanup)

**Changes**:
- Removed `POST /config/test-bot` endpoint; removed unused `GoogleGenerativeAI`, `ConfigService`, `ServiceUnavailableException`, and `PrismaService` imports from `ConfigController`
- Hardcoded bot behavior in `BotService` as static class constants: `RETRIEVAL_THRESHOLD = 0.5`, `CONFIDENCE_THRESHOLD = 0.7`, `BOT_NAME = "Athena"`; removed `botEnabled` DB guard (bot is now always active)
- Removed 5 fields from `updateAppConfigSchema` Zod validation: `botEnabled`, `botModelEmbedding`, `botRetrievalThreshold`, `botConfidenceThreshold`, `botName`, `botAvatarUrl` (no longer patchable via API)
- Migration `20260531000000_remove_bot_behavior_fields`: dropped 6 columns from `AppConfig` — `botEnabled`, `botModelEmbedding`, `botRetrievalThreshold`, `botConfidenceThreshold`, `botName`, `botAvatarUrl`
- Patched `20260530000000_athena_bot` migration to add `IF NOT EXISTS` guards for `AiOperation`, `AiCallStatus` enums and `AiUsage` table — these were created directly in the DB without migrations, causing shadow DB failures on `prisma migrate dev`
- Regenerated Prisma client; all TypeScript checks pass

**Docs**: `docs/atlas/bot.md`, `docs/atlas/ai.md` updated; `pnpm atlas:gen` run (74 routes / 25 modules / 22 models)

---

## Session — 2026-05-31 (RAG fix, two-phase KB ingestion, admin UI, botModelChat removal)

**Problem statement**: RAG completely broken — every embed call returned 404 because Google retired `text-embedding-004`. Chat model (`gemini-2.0-flash`) worked independently. Settings UI was developer-oriented (raw status enums, "Crawl now", "Re-index"). No cost gate before embedding.

**Changes**:

**Item 1 — Fix embedding model**:
- Created `apps/api/src/modules/ai/embedding.constants.ts`: `EMBEDDING_MODEL = 'gemini-embedding-001'`, `EMBEDDING_DIMENSIONS = 768`, `EMBED_PRICE_PER_MILLION = 0.15`, `l2normalize()` (required at <3072 dims per Gemini spec)
- Updated `EmbeddingService`: uses new model + `outputDimensionality: 768` + `l2normalize()` on each returned vector
- Consolidated embed path: `GeneratorService.embed()` now delegates to `EmbeddingService` (removed duplicate embed implementation); `KnowledgeBaseModule` exports `EmbeddingService`; `BotModule` imports `KnowledgeBaseModule`

**Item 4 — Remove botModelChat**:
- Dropped `botModelChat String?` from schema.prisma and migration; chat model hardcoded as `gemini-2.0-flash` in `GeneratorService`
- Removed from `updateAppConfigSchema` (Zod) and from the AI Assistant settings UI

**Item 3 — Two-phase scan → confirm → embed**:
- New schema: `SourceStatus.SCANNED`, `KbPhase` enum (`IDLE|SCANNING|AWAITING_CONFIRM|EMBEDDING|DONE|FAILED|CANCELLED`), 8 new `AppConfig` fields: `kbPhase`, `kbScanPagesSeen`, `kbScanChunkCount`, `kbScanTokenEstimate`, `kbScanCostUsd`, `kbEmbedChunksDone`, `kbEmbedChunksTotal`, `kbError`
- `IndexerService` now has three methods: `scanPage()` (fetch+chunk+persist with `embedding=NULL`, no Gemini), `embedSource()` (embed un-embedded chunks for one source), `estimatePendingCost()` (SUM tokenCount → cost estimate); legacy `indexPage()` preserved for reindex-single-source path
- New queues: `KB_SCAN_QUEUE` (`kb:scan`), `KB_EMBED_QUEUE` (`kb:embed`) added to queue module + service
- `CrawlAndIndexWorker` now also registers scan worker (crawls → `scanPage()` per page → sets `kbPhase=AWAITING_CONFIRM` with cost estimate) and embed worker (iterates `SCANNED` sources → `embedSource()` → `kbPhase=DONE`)
- New controller endpoints: `POST /kb/scan/start`, `POST /kb/scan/cancel`, `POST /kb/embed/confirm`; `GET /kb/status` extended with all new fields; `POST /kb/sources/manual` now scans into pending set instead of immediate embed
- Migration `20260531000001_kb_two_phase_and_remove_botModelChat`: applied via `db push` + `migrate resolve`

**Item 2 — Admin-friendly UI**:
- AI Assistant page fully rewritten: two cards (AI Assistant, Help Center Knowledge), phase-aware `KbPhasePanel` component shows scan progress bar → cost-confirmation panel → embed progress bar → completion/error states
- All developer terms replaced: Crawl now → Scan documents, Resync → Check for updates, Clear index → Remove all documents, Chunks → Sections, Last indexed → Last updated, raw status enums → Ready/Scanned/Failed/Skipped/Processing

**Key decisions**:
| Decision | Why |
|---|---|
| `gemini-embedding-001` at 768 dims | `text-embedding-004` retired by Google; 768-dim column already exists → no vector migration |
| L2-normalize all embed vectors | Required by Gemini at sub-max dimensions for cosine-equivalent dot-product similarity in pgvector |
| Two-phase scan+confirm before embed | Embedding costs real money; admin must see estimate and confirm before any Gemini embed calls are made |
| Manual add also goes to pending set | Consistent UX: single page or full crawl both require explicit confirm before costing anything |
| `db push` + `migrate resolve` for migration | Shadow DB couldn't replay older migrations; `db push` + manual SQL file + `migrate resolve --applied` achieves same result |

**Docs**: `docs/atlas/ai.md` updated (embedding model section, two-phase flow section, new endpoint table, term mapping); `pnpm atlas:gen` run (77 routes / 25 modules / 22 models)

---

## Session — 2026-05-31 (Bug fix: RETRIEVAL_THRESHOLD miscalibrated for RRF)

**Bug**: Bot always escalated with "Retrieval score too low" even when the KB had a direct answer. Logged score was `0.0328` against threshold `0.5`.

**Root cause**: `BotService.RETRIEVAL_THRESHOLD = 0.5` was written for cosine similarity (range 0–1), but `RetrievalService` returns RRF scores bounded by `2/(k+1) ≈ 0.033` (k=60). The threshold could never be reached — every ticket escalated regardless of retrieval quality.

**Fix**: Lowered `RETRIEVAL_THRESHOLD` to `0.01` (≈ rank-40 in a single retrieval list). The LLM `CONFIDENCE_THRESHOLD = 0.7` remains the quality gate — Athena won't answer if the generated confidence is low even when retrieval finds something.

**Decision added to table**:
| Decision | Why |
|---|---|
| `RETRIEVAL_THRESHOLD = 0.01` (not 0.5) | RRF scores max out at ~0.033; 0.5 was copied from cosine-similarity context and caused 100% escalation rate; LLM confidence (0.7) is the real quality filter |

**Docs**: `docs/atlas/bot.md` updated — Gate 1 threshold corrected to 0.01; removed-fields note updated with correct embedding model name and threshold value.

---

## Session — 2026-05-31 (Ticket/Email flow fixes + Bot UX)

**Problem statement**: Post-RAG audit surfaced 5 broken scenarios (2, 4, 6, 7, 9 in the flow matrix). Athena replies were invisible in Bridge (BUG A), displayed as raw markdown in both apps (BUG B), and answers were verbose. Inbound-email new tickets got no bot response and no confirmation email. Agent reply emails were fire-and-forget (silent SMTP failures). Customers who replied after a bot answer were silently queued as IN_PROGRESS with no human assigned.

**BUG A — Athena reply invisible in bridge**:
- Root cause: `Message` interface in `apps/bridge/src/app/tickets/[id]/page.tsx` lacked `authorBotName` and `bodyHtml`; both were never passed to `<MessageCard />`.
- Fix: added both fields to the interface and to the `<MessageCard ... />` mapping in the render loop.

**BUG B — Raw markdown in Bridge and Portal**:
- New `MarkdownService` (`apps/api/src/modules/ai/markdown.service.ts`): converts a subset of Markdown (bold, italic, inline code, links, bullet lists, headings) to HTML using only built-in string operations — avoids ESM-only unified/rehype packages incompatible with the API's CommonJS target.
- `BotService.respondTo()`: now sets `bodyHtml = this.markdown.render(generated.answer)` alongside `body` when creating the bot `Message` row.
- `MessageCard.tsx` bot branch: prefers `bodyHtml` via `dangerouslySetInnerHTML` (with existing `sanitizeHtml`) over `isHtmlBody(main)` / pre-wrap fallback.
- Portal ticket page: added `bodyHtml?: string | null` to its `Message` interface; renders `<div dangerouslySetInnerHTML>` when present, else falls back to `<p whiteSpace: pre-wrap>`.

**Item 3 — Answer brevity (`BOT_GENERATION_PROMPT`)**:
- Rewrote prompt: one direct sentence, up to 3 short bullets (optional), single `Learn more:` link. ≤ 80 words before the link. No inline scattered links, no "Related articles" dump.

**Item 4+7 — escalateToHuman() + customer notification**:
- `BotService.escalate()` refactored into public `escalateToHuman(ticketId, ticket, reason, { notifyCustomer? })`. Sets ticket `status='OPEN'`, assigns on-duty agent, writes `escalated:` SYSTEM_EVENT. Guard: no-op if already assigned.
- `EmailService.sendEscalationNotification()`: new method sending "a specialist will follow up" email to the customer, threaded into the ticket.
- `parseEvent()` in `MessageCard.tsx`: recognises `escalated:` and `email_delivery_failed:` SYSTEM_EVENT bodies.

**Scenario 9 — auto-escalate when customer replies after bot answer**:
- `MessagesService.create()`: before the transaction, checks for `BotInteraction.didAnswer=true` when customer replies on a WAITING ticket. If found, skips the normal WAITING→IN_PROGRESS transition and calls `escalateToHuman(…, { notifyCustomer: true })` after the transaction.
- `ThreadIngestionService`: same check after the transaction for inbound email replies.

**Scenario 2 — inbound email new tickets get bot + confirmation**:
- `ThreadIngestionService`: when `wasCreated && !isBackfill`, sends `EmailService.sendTicketConfirmation()` (fire-and-forget) and enqueues `bot:respond-to-ticket`.

**Scenario 4 — retried reply email (no more silent drops)**:
- New `email:send-reply` pg-boss queue (`EMAIL_SEND_REPLY_QUEUE`).
- `QueueService.enqueueEmailSendReply()`: sends with `retryLimit: 3`, `retryDelay: 30`, `retryBackoff: true`.
- `SendReplyWorker` (`apps/api/src/modules/email/workers/send-reply.worker.ts`): loads ticket/message/appConfig, calls `EmailService.sendAgentReply()`, stores returned Message-ID. On final failure writes `email_delivery_failed:` SYSTEM_EVENT so agents see it in the thread.
- `MessagesService.create()`: replaced `this.emailService.sendAgentReply(…).catch()` fire-and-forget with `this.queueService.enqueueEmailSendReply({ticketId, messageId})`.
- `EmailModule` now imports `DatabaseModule`; `SendReplyWorker` registered as provider.
- `EmailSyncModule` now imports `EmailModule` (needed by `ThreadIngestionService`).

**Decisions added**:
| Decision | Why |
|---|---|
| `MarkdownService` uses simple regex, no unified/rehype | unified v11+ is ESM-only; API uses `moduleResolution: node` (CommonJS). A targeted regex converter is simpler and sufficient for Athena's answer format. |
| `bodyHtml` pre-rendered at write time (not at read time) | Consistent rendering across Bridge + Portal without adding frontend markdown deps; also stored for future email rendering. |
| `email:send-reply` queue replaces fire-and-forget | Silent SMTP failures were undetectable. Retried queue + failure SYSTEM_EVENT gives visibility and resilience. |
| `escalateToHuman()` is public on `BotService` | Reused by `MessagesService` (portal) and `ThreadIngestionService` (email) without duplicating logic. Guard against double-escalation (`assigneeId` check). |
| Scenario 2 confirmation email is fire-and-forget | Not retried because `sendTicketConfirmation` already logs errors; the ticket was created successfully and the bot will respond — confirmation is best-effort. |

**Docs**: `docs/atlas/messages.md`, `docs/atlas/email.md`, `docs/atlas/ai.md` updated.

---

## Session — 2026-06-01 (RAG quality + scan speed + Bridge instant update)

**Context**: Three problems remained after the two-phase scan→confirm→embed flow shipped.

**Part 1 — Retrieval quality**

- **1a. FTS sparse arm** (`retrieval.service.ts`): replaced `pg_trgm similarity()` with Postgres full-text search (`ts_rank_cd + websearch_to_tsquery`). Added migration `20260601000000_kb_fts_tsv_column` adding a `tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED` column + GIN index on `KnowledgeChunk`. Direct root cause of the connector-page pollution fix.
- **1b. Embedding taskType** (`embedding.service.ts`, `generator.service.ts`, `indexer.service.ts`): `embedChunks(texts, taskType)` now takes an optional `TaskType` argument. Documents use `RETRIEVAL_DOCUMENT`; query embeddings use `RETRIEVAL_QUERY`. Asymmetric task types improve retrieval accuracy.
- **1c. Finer chunking** (`chunker.service.ts`): `MAX_TOKENS` 800→350, `MIN_TOKENS` 200→100. Finer chunks make plan-level facts their own discrete vector.
- **1d. Dense cosine gate** (`bot.service.ts`, `retrieval.service.ts`): `retrieve()` now returns `{ chunks, maxDenseScore }`. Gate in `BotService` checks `maxDenseScore ≥ 0.55` (was opaque RRF score ≥ 0.01). `BotInteraction.retrievalTopScore` now stores the dense cosine for observability.
- **1e. Context header cleanup** (`context-builder.service.ts`): strips `<style>/<script>/<head>/<nav>/<footer>/<aside>` before summarising, so the model sees article body text not CSS boilerplate.

**Part 2 — Faster scan**

- **2a. Context header deferred to Phase B** (`indexer.service.ts`): `scanPage()` makes zero Gemini calls — stores raw chunk text with `contextHeader = NULL`. `embedSource()` now builds the context header (one Flash call per source), prepends `[CONTEXT: …]`, updates the stored text, then embeds. `estimatePendingCost()` updated to include summary call cost; single total shown on confirm screen.
- **2b. Parallel crawl** (`crawler.service.ts`): replaced sequential `for + delay(1000)` with `fetchConcurrent()` — bounded concurrency pool (CONCURRENCY=6). Wall-clock: `pages × (fetch + 1s)` → `ceil(pages/6) × fetch`.
- **2c. Crawler robustness** (`crawler.service.ts`): robots.txt sitemap discovery, true incremental mode (`<lastmod>` vs `source.fetchedAt`), retry/backoff (3 attempts, 500ms × attempt), gzip sitemap support, BFS batch parallelised. `PrismaService` injected into `CrawlerService` for incremental DB lookups.

**Part 3 — Bridge instant update**

- `BotModule` imports `EventsModule`; `SseService` injected into `BotService`.
- `BotService.respondTo()`: broadcasts `message-created` SSE after bot reply; broadcasts `ticket-updated` SSE after escalation.
- `BotService.escalateToHuman()`: broadcasts `message-created` for the SYSTEM_EVENT row inside the transaction (same pattern as `MessagesService`).
- Bridge already listens for `message-created` → refreshes thread. Reply now appears within ~1s instead of up to 10s.

**Re-index required**: Changes 1b, 1c, 1e alter stored vectors/text. Run Remove all → Scan → confirm → Embed in the UI after deploying.

**Docs updated**: `docs/atlas/ai.md` (retrieval: FTS + taskType + dense gate; embedding: asymmetric taskType + chunk tuning; scan: deferred context header + parallel crawl; crawler: all robustness improvements).

---

### 2026-05-31 — Inbound email triage (no auto-flow for unsolicited mail)

**Problem**: Inbound email auto-ran the full customer-facing flow (confirmation email + Athena bot reply) for every email, including newsletters and no-reply senders. System was auto-replying to promo mail.

**Changes**:

**Schema** (`packages/db/prisma/schema.prisma`):
- New enum `TriageState { LIVE, PENDING, FILTERED }` + `Ticket.triageState TriageState @default(LIVE)` + index. Applied via `db push`.

**Bulk detection** (`apps/api/src/modules/email-sync/util/is-bulk-sender.ts`):
- Shared helper detecting automated mail via: `Auto-Submitted ≠ no`, `Precedence ∈ {bulk,list,junk}`, `List-Unsubscribe`, `List-Id`, `X-Auto-Response-Suppress`, sender local-part (`no-reply`, `donotreply`, `mailer-daemon`, `postmaster`).
- `ParsedMessage.isBulk?: boolean` added to `mail-provider.interface.ts`.
- Both `GmailProvider` and `GraphProvider` now compute `isBulk` and set it on returned `ParsedMessage`.

**Thread ingestion** (`thread-ingestion.service.ts`):
- New email tickets set `triageState = PENDING` (normal) or `FILTERED` (bulk signals detected).
- Removed the scenario-2 auto-flow (confirmation + bot) for email-originated tickets. Sentiment analysis stays.
- Scenario 9 (customer reply to existing ticket → bot escalation) unaffected.

**Tickets service** (`tickets.service.ts`):
- `activateTicket(ticketId)` — single private method that sends confirmation email + enqueues bot. Called from: `create()` (portal) and `convert()` (triage agent action).
- `list()` default filter now includes `triageState: 'LIVE'`. Accepts `triageState` query param to fetch triage queues.
- `stats()` counts only LIVE tickets for inbox counts; also returns `pendingCount`/`filteredCount` for triage badge.
- `convert(ticketId)` — sets `triageState = LIVE`, calls `activateTicket`. Idempotent.
- `discard(ticketId)` — sets `status = CLOSED`, keeps `triageState = FILTERED`. No customer email.

**Controller** (`tickets.controller.ts`):
- `POST /tickets/:id/convert` (agent-only)
- `POST /tickets/:id/discard` (agent-only)

**DTO** (`tickets.dto.ts`):
- `triageState` query param added to `listTicketsSchema`.

**Bridge UI**:
- New page `apps/bridge/src/app/triage/page.tsx` — Pending / Filtered tabs, sender+subject+snippet rows, Convert + Discard action buttons.
- `DashboardSidebar` — Filter icon added to rail between Inbox and GitHub; shows red badge when `pendingCount > 0`. Triage section uses rail-only mode (no content panel). `Section` type extended with `'triage'`.

**Key decisions**:
| Decision | Why |
|---|---|
| `triageState` separate from `status` | Avoids widening TicketStatus; SLA/assignment queries stay clean |
| `activateTicket` single source of truth | Confirmation + bot side-effects centralized; any future source (bulk convert) gets them automatically |
| Bulk detection in shared util | Both Gmail and Graph providers use the same rules; no provider-specific branches |
| Discard does not hard-delete | Ticket remains accessible via `/tickets/:id` for audit; `CLOSED` + `FILTERED` is effectively a spam bin |

**Docs**: `docs/atlas/email.md` (triage section, bulk detection signals), `docs/atlas/tickets.md` (triageState table, mermaid creation flow, activateTicket docs, triage file list, Notable decisions, Known gaps). `pnpm atlas:gen` run (79 routes, 25 modules, 23 enums).

---

### 2026-06-01 — Triage → NEW/DISMISSED status merge (two-tab Inbox / Tickets)

**Problem**: The `triageState` axis (LIVE/PENDING/FILTERED) plus a separate `/triage` page created a confusing dual-axis model. The inbound triage queue was nearly empty in practice, making the extra page feel heavyweight.

**Changes**:

**Schema** (`packages/db/prisma/schema.prisma`):
- `TicketStatus` enum extended: `NEW` (was `PENDING`) + `DISMISSED` (was `FILTERED`).
- `Ticket.triageState` column removed.
- `TriageState` enum removed.
- `isBulk Boolean @default(false)` added (denormalized from first-message bulk signal).
- `dismissedAt DateTime?`, `dismissedById String?`, `dismissedBy Agent? @relation("TicketDismissedBy")` added.
- `Agent.dismissedTickets` inverse relation added.
- Migration: `20260601000001_merge_triage_into_status` — applied via direct SQL + `migrate resolve --applied`. Data backfill: PENDING → NEW, FILTERED → DISMISSED.

**Backend** (`apps/api/src/modules/tickets/`):
- `tickets.dto.ts`: removed `TriageState` enum + `triageState` param; added `view: z.enum(['inbox','tickets']).optional()`; extended status enum with `NEW`/`DISMISSED`; `updateTicketSchema` restricted to 5 lifecycle statuses only.
- `tickets.service.ts`: `stats()` uses `status ∉ {NEW,DISMISSED}` base filter, returns `newCount` (was `pendingCount`/`filteredCount`). `list()` routes on `view` param — inbox: all `source=EMAIL`; tickets (default): excludes NEW/DISMISSED; portal: always excludes both. `create()`: removed `triageState: 'LIVE'`. `convert()`: guards on `status` (was `triageState`); sets `status=OPEN`, clears dismissal. `discard()`: accepts `agentId`, sets `status=DISMISSED + dismissedAt + dismissedById`; only NEW tickets can be dismissed.
- `tickets.controller.ts`: passes `agent.id` to `discard()`.
- `thread-ingestion.service.ts`: sets `status: 'NEW'` and `isBulk: firstMsg?.isBulk ?? false`; removed `triageState` computation.

**Bridge UI**:
- `Sidebar.tsx`: removed triage rail button + `'triage'` section + pathname branch; `newCount` badge on Inbox rail; simplified rail-only width condition.
- `inbox/page.tsx` rewritten: **Inbox | Tickets tab strip** (via `?view=`); NEW rows get inline Convert/Dismiss buttons; DISMISSED rows show "Dismissed by {name}" (or "Auto-filtered") + time + strikethrough title; `isBulk` rows show a **Promotional** amber pill; TicketListItem extended with `isBulk`, `dismissedAt`, `dismissedBy`.
- `TicketPreviewPanel.tsx`: `NEW` → `d-new` / "New"; `DISMISSED` → `d-res` / "Dismissed" added to STATUS_CLS/STATUS_LABEL.
- `tickets/[id]/page.tsx`: type + STATUS_LABEL/STATUS_CLS/STATUS_OPTS updated (dropdown stays 5 lifecycle statuses).
- `tickets/domain/[domain]/page.tsx`: type updated.
- **Deleted**: `apps/bridge/src/app/triage/` directory.

**Portal UI**: defensive type-map additions to `tickets/page.tsx` + `tickets/[id]/page.tsx` — backend excludes NEW/DISMISSED from portal responses so they never render.

**Key decisions**:
| Decision | Why |
|---|---|
| **Triage folded into `status`** | The two-axis model (triageState + status) was confusing and underused. Inbox/Tickets tabs replace the `/triage` page. Reversal of the 2026-05-31 decision. |
| **`isBulk` denormalized on `Ticket`** | Promotional pill shown in Inbox list without joining Message rows |
| **`dismissedById = null` = system/legacy** | Backfill-set FILTERED rows have no agent; shown as "Auto-filtered" |
| **Dismiss guard: only `NEW` allowed** | Prevents accidental dismissal of active conversations |
| **Deleted stale `.claude/` specs** (`stack.md`, `data-model.md`, `api-contracts.md`, `architecture.md`) | Superseded by `docs/atlas/` + `_generated/` (CI-gated); were ~30–45% accurate and actively misleading (multi-tenant `orgId`, Redis/BullMQ, SMTP listener). Kept only `conventions.md` + `design-system.md`; architecture overview rehomed to `docs/atlas/architecture.md`. |
| **Removed `design/` reference folder** | Initial-frontend scaffolding (screens + tokens.css); zero code imports — live design tokens are each app's `src/globals.css`. |

**Docs**: `docs/atlas/tickets.md` (lifecycle diagram, status model table, creation flow, list/filter section, Bridge UI section, notable decisions, known gaps), `docs/atlas/email.md` (triage flow → NEW status flow section). `pnpm atlas:gen` run.

---

### 2026-06-01 — Post-migration Inbox UX fixes (flash, pagination, pill, resurface)

Four issues found and fixed after the triage→status migration shipped.

**Fix 1 — Silent 15s background refresh (no flash)**
- `loadTickets` now accepts `{ background?, append? }`. Background calls skip `setIsLoading(true)` entirely; instead they merge the response into the existing `tickets` array by id (upsert changed, prepend new), re-sorted by `updatedAt` desc. No skeleton shimmer, no scroll reset.

**Fix 2 — Infinite scroll (all 890+ emails reachable)**
- Added `offsetRef` tracking loaded count. Each page appends 100 rows to `tickets`. An `IntersectionObserver` on a 1 px sentinel div at the bottom fires `loadTickets({ append: true })` automatically while `tickets.length < total`. "Showing X of Y" footer shows progress.
- On initial Inbox load (`view=inbox`), any domain with `newCount > 0` is auto-expanded (plus the top domain), so new mail is immediately visible without clicking.
- `buildDomainGroups()` now returns `newCount` alongside `openCount` on each group. Domain header shows red "N new" chip.

**Fix 3 — `.d-new` pill style**
- Added `.d-new { color: #FCA5A5; background: rgba(239,68,68,0.14); }` (dark) and `html[data-theme="light"] .d-new { color: #B91C1C; background: #FEF2F2; }` (light) to `globals.css`. `STATUS_CLS` already mapped `NEW → d-new`; the rule was just missing.

**Fix 4 — Resurface DISMISSED threads on customer reply**
- `ThreadIngestionService` (`!wasCreated` update block, ~line 229): if the ticket's current status is `DISMISSED` and the inbound message is from a customer (`newMessageId` set), flips `status = 'NEW'` in the same `ticket.update()` call. No customer email sent (still pre-activation). Missed follow-ups return to the Inbox for re-triage.

**Key decisions**:
| Decision | Why |
|---|---|
| Background refresh merges first page only | Keeps it simple — new mail always arrives in the most-recent page; a full re-fetch with offset would require a separate "sync all pages" loop |
| Auto-expand adds to existing set, not replaces | User manual collapses are preserved across background refreshes; only first load injects the auto-expand |
| DISMISSED resurface = default behavior | A customer reply to a dismissed thread is a genuine follow-up; hiding it would create missed-ticket risk |

**Docs**: `docs/atlas/tickets.md` (domain group cards section rewritten, infinite scroll + silent refresh documented), `docs/atlas/email.md` (DISMISSED→NEW resurface notable decision added). No new endpoints or Prisma models — `pnpm atlas:gen` not needed.

### 2026-06-01 — Athena bot outage fix (missing `tsv` column + retired Gemini model)

The bot escalated **every** ticket with "Bot encountered an unexpected error." Two independent root causes:

1. **`tsv` FTS column missing.** Migration `20260601000000_kb_fts_tsv_column` was recorded in `_prisma_migrations` as applied but with `applied_steps_count = 0` — its SQL never ran (the later triage migration's "apply inline" comment had no SQL body). So the `KnowledgeChunk.tsv` generated column + `KnowledgeChunk_tsv_gin` index never existed. `RetrievalService.retrieve()`'s lexical arm (`WHERE tsv @@ websearch_to_tsquery(...)`) threw Postgres `42703 column "tsv" does not exist`, failing `respondTo` before generation. The code comment claimed an on-the-fly `to_tsvector` fallback that did not exist.
2. **`gemini-2.0-flash` retired by Google (404).** Hit non-fatally in `ContextBuilderService` (chunks indexed during the window lost their context headers) and fatally in `GeneratorService` (bot answers).

**Fixes**:
- Restored the `tsv` column + GIN index (idempotent SQL; back-filled all 396 chunks).
- `RetrievalService implements OnModuleInit` — re-runs the idempotent `ADD COLUMN IF NOT EXISTS … GENERATED … STORED` + `CREATE INDEX IF NOT EXISTS` on every boot, so the column self-heals after any `migrate reset`.
- Wrapped the FTS query in try/catch → degrades to **dense-only** retrieval instead of throwing, so a future FTS fault can't take the whole bot down.
- Bumped the generative model to **`gemini-2.5-flash-lite`** in `generator.service.ts`, `context-builder.service.ts`, `gemini.service.ts` (+ cost constants → 0.10/0.40 per 1M, flagged to verify). Embedding model `gemini-embedding-001` unchanged (unaffected).

**Key decisions**:
| Decision | Why |
|---|---|
| Generated FTS column asserted at boot (`RetrievalService.onModuleInit`), not just via migration | Generated columns aren't in the Prisma schema, so `migrate reset` / a 0-step migration can silently drop them; a boot-time idempotent guard is the only reliable defense |
| FTS failure → dense-only, never throw | A KB-infra fault must not escalate every customer ticket; dense retrieval alone is still useful |

**Tests**: `R71` added — asserts `KnowledgeChunk.tsv` column + GIN index exist and retrieval degrades gracefully when FTS fails. **Docs**: `docs/atlas/ai.md` (model name → `gemini-2.5-flash-lite`; boot-time `tsv` ensure + dense-only fallback noted). No new endpoints/models — `pnpm atlas:gen` not needed.

---

### 2026-06-02 — Email + Ticket integration test catalogue (plan: okay-the-current-application-partitioned-wirth)

Executed the agreed test-catalogue plan. All 10 scenarios (S1–S10) are now covered by named integration tests and regression-catalogue rows (R74–R86).

**What was written / changed:**

- **`tests/integration/email-ticket-flow.spec.ts`** (new) — 13 integration tests across S1–S10. Uses `harness.get<ThreadIngestionService>()`, `BotService`, `EmailService`, `MailCaptureService` directly where needed; HTTP endpoint tests for status-transition flows.
- **`tests/integration/setup.ts`** — added MSW server bootstrap (`setupServer`, `listen`, `resetHandlers`, `close`). Exported `mswServer` so per-test overrides work (was referenced but never initialized — existing `bot.respond.spec.ts` was broken without it).
- **`tests/e2e/flows/F2.spec.ts`** (new) — Playwright scaffold for inbound email → Bridge Inbox → Convert UI → Portal visibility flow. Depends on `/__test/ingest-email` test helper (to be added to `TestController`).
- **`tests/regression-catalogue.md`** — R74–R86 rows added.
- **Atlas doc drift fixes** (3 items, all one-line):
  - `docs/atlas/tickets.md:39` — `RESOLVED --> OPEN` corrected to `RESOLVED --> IN_PROGRESS`
  - `docs/atlas/bot.md:21` — `Gemini 2.0 Flash` corrected to `gemini-2.5-flash-lite`
  - `docs/atlas/bot.md:72` — `maxScore < 0.01` corrected to `maxScore < 0.55 (DENSE_THRESHOLD)`
  - `docs/atlas/email.md:301` — stale "attachments not extracted" gap updated to reflect implemented extraction (Graph provider remains the gap)

**Key decisions:**

| Decision | Why |
|---|---|
| MSW initialized in `setup.ts` (exported as `mswServer`) | It was referenced by `bot.respond.spec.ts` but never created; the setup file is the right place since it runs for every test file |
| S9 escalation test uses a short `setTimeout(50ms)` after `flushPromises()` | `escalateToHuman` is fired with `.catch()` inside MessagesService; `flushPromises()` alone drains the Promise queue but the bot service calls async DB writes that need a tick |
| F2 E2E depends on a `/__test/ingest-email` helper endpoint | TestController needs a new route to accept a canned thread payload and call ThreadIngestionService — not yet added; F2 spec is a scaffold that will fail until that endpoint exists |
| S7 tested at DB contract level (SYSTEM_EVENT schema) rather than worker retry | The SendReplyWorker handler is an anonymous arrow function inside pg-boss `work()`, not extractable for direct testing; the contract test covers what agents see (the failure event + surviving message row) |

---

### 2026-06-01 — Inbox UX micro-fixes (ticket click + convert transition)

Three small fixes to the Inbox row interactions:

- **NEW rows now clickable** — removed `!isNew` guard from the `onClick` handler on ticket rows. Agents can now click into a NEW email's conversation thread before deciding to convert or dismiss. Only DISMISSED rows remain non-navigable.
- **Smooth convert transition (optimistic update)** — `handleConvert` no longer calls `setTickets(prev => prev.filter(...))` + `loadTickets()` (which caused a jarring remove/re-add flash). It now flips the ticket's status to `OPEN` in local state immediately; the row transforms in place (Convert/Dismiss buttons disappear, becomes a normal clickable ticket). Reverts to `NEW` on API error.
- **Convert button label** — changed from "✓ Convert" to "✓ Convert to Ticket" for clarity.

No docs/tests needed — all three are one-line UI-only changes with no backend or data-flow impact.

### 2026-06-01 — Athena "Learn more:" KB source link restored

After the `gemini-2.5-flash-lite` migration the bot replies lost their `Learn more:` source link (seen in TMR-9414: answer + bullets, no link). Root cause: the link was never rendered in code — `BotService` posted `body: generated.answer` and relied entirely on the LLM to type the link into the answer field. Under structured-JSON output the smaller flash-lite model "satisfies" the citation requirement by filling the `citations[]` array and drops the inline link from the prose; `gemini-2.0-flash` used to comply with the prompt's formatting instruction.

- **`BotService.appendSource()`** ([bot.service.ts](apps/api/src/modules/bot/bot.service.ts)) — strips any stray model-generated `Learn more:` line, then appends a single link built from `citations[0]`, matched back to a retrieved chunk so the label is the chunk's `headingPath` breadcrumb (fallback `Read the full article`). The combined markdown is stored as `body` and rendered into `bodyHtml`, so the portal/bridge thread shows a real anchor and the outbound email (`sendAgentReply` uses `message.body` as plain text) carries the link inline too. Reached only after all gates pass, where a valid same-origin citation is guaranteed.
- **Prompt simplified** ([bot.prompts.ts](apps/api/src/modules/bot/bot.prompts.ts)) — the LLM is now told to write **no links** in the answer and to set `citations` to the single most relevant passage URL. Less for flash-lite to get wrong; the link is fully code-owned.
- **Tests** — added R72 (link appended when the model omits it) and R73 (model-emitted `Learn more:` line stripped, not duplicated) to `tests/integration/bot.respond.spec.ts` + regression-catalogue rows. NOTE: the local integration harness boots `postgres:16-alpine` (no `vector` extension), so the integration suite can't run locally — schema push fails before any bot test; `appendSource` logic was verified standalone. CI must run on a pgvector-capable Postgres image.
- **Docs** — updated `docs/atlas/ai.md` (bot answer format + run loop step 8) and `docs/atlas/bot.md` (RAG generate step), plus a Decisions row above.

---

### 2026-06-03 — Email flow redesign: ref, isTicket, user categories, unified inbox, Customers page

Plan: `~/.claude/plans/we-are-going-to-eager-quiche.md` — email-flow redesign. Executed fully.

**Schema** (`packages/db/prisma/schema.prisma` + migration `20260603000000_email_flow_redesign`):
- `Ticket.number Int @unique @default(autoincrement())` **removed** → replaced by `Ticket.ref String @unique` (7-char Crockford base32, never null).
- `Ticket.isTicket Boolean @default(false)` **added**. Invariant: `isTicket=false ⇔ status ∈ {NEW, DISMISSED}`. Real ticket = `isTicket=true`.
- `UserCategory { CUSTOMER MARKETING PROMOTIONAL }` enum added; `User.category UserCategory @default(CUSTOMER)` added.
- `@@index([isTicket])` added on Ticket.

**Migration**: ordered SQL — create `UserCategory`, add `User.category`, add `Ticket.isTicket + ref (nullable)`, backfill `isTicket=true` for non-NEW/DISMISSED rows, PL/pgSQL loop to backfill `ref` for every row with uniqueness retry, `SET NOT NULL`, unique + index creation, drop `number` + sequence.

**New utility**: `apps/api/src/modules/tickets/util/generate-ref.ts` — `generateRefCandidate()` (crypto.randomBytes → Crockford) + `generateUniqueRef(exists)` with P2002 retry loop (≤5 attempts).

**Backend changes**:
- `tickets.service.ts`: all `TMR-${t.number}` → `t.ref`; `displayId = t.ref`; `create()`: portal tickets set `isTicket=true` + assign `ref`; `convert()`: idempotency guard switches to `if (ticket.isTicket) return …`, sets `isTicket=true`; `list()` default returns all non-DISMISSED (conversations + tickets) for agents; portal sees own `isTicket=true` only; `stats()` `newCount` = `isTicket=false, status=NEW`; `findById()` returns 404 for portal users on `isTicket=false` rows. `view` param removed from DTO.
- `tickets.dto.ts`: `view` removed, `isTicket` optional boolean filter added.
- `thread-ingestion.service.ts`: `isTicket=false` set on new inbound rows; `ref` generated on create; `User.category` set on first upsert (PROMOTIONAL if isBulk, CUSTOMER otherwise, never overwritten).
- `users.service.ts + users.controller.ts + users.dto.ts`: new `GET /users` (`listCustomers`) with aggregates via `$queryRawUnsafe`; new `PATCH /users/:id` (`updateCategory`); `findById` now uses `t.ref` for displayId; agent-only guard.
- `email.service.ts`: all `TMR-${ticket.number}` → `ticket.ref` in 3 places.
- `ai/workers/request-csat.worker.ts`, `ai/workers/analyze-message.worker.ts`, `github/github.service.ts`, `analytics/customers.service.ts`, `analytics/rating.controller.ts`, `notifications/notifications.service.ts`: all `.number` → `.ref` references updated.

**Frontend changes**:
- `groupTicketsByDomain.ts`: `buildDomainUserGroups()` added (3-level: domain → user → conversations); `buildDomainGroups` kept (domain detail page).
- `inbox/page.tsx`: fully rewritten — unified inbox, 3-level grouping (Domain → User → rows), no tab strip, Convert/Dismiss moved to detail sidebar, `UserCategoryBadge` on user rows, per-conversation code slot hidden for `!isTicket`.
- `tickets/[id]/page.tsx`: `isTicket` added; breadcrumb shows "Conversation" when `!isTicket`; Actions sidebar shows Convert/Dismiss block when `!isTicket`, normal actions when `isTicket`.
- `TicketPreviewPanel.tsx`: `UserCategoryBadge` + `UserCategoryControl` components added (exported).
- NEW `customers/page.tsx`: Customers page with grid table, domain favicon, inline `UserCategoryControl`, open-count amber highlight, `CustomerProfilePanel` slide-over.
- `CustomerProfilePanel.tsx`: `category` added to `UserProfile`; `UserCategoryControl` in header.
- `Sidebar.tsx`: `customers` section added; Customers `RailBtn` added; aside width check extended for `customers`.
- `github/page.tsx`, `NotificationsPanel.tsx`: `ticket.number` → `ticket.ref`.

**Tests**:
- NEW `tests/unit/api/generate-ref.spec.ts` — alphabet/length/uniqueness/retry/throw-after-5 (R35 pattern).
- `tests/integration/email-ticket-flow.spec.ts` — confirmation subject regex updated (`[A-Z0-9]{7}` base32); `isTicket=false` + `ref` assertions on S2/S8; bulk → `PROMOTIONAL` category assertion; raw ticket.create calls in S4/S10 updated with `ref` + `isTicket`.
- `tests/integration/tickets.create.spec.ts` — R35 test replaced: now asserts `isTicket=true` + valid `ref` + uniqueness.
- NEW `tests/integration/users.customers.spec.ts` — R87/R88/R89.
- `tests/integration/factories/index.ts` — `makeTicket` updated with `ref` + `isTicket` fields.
- `tests/regression-catalogue.md` — R87, R88, R89, R35-retired, R90, R91 added.

**Decisions**:
| Decision | Why |
|---|---|
| `ref` replaces `number` | `number` exposed sequential DB counts to external parties; `ref` is opaque and URL-safe. Standard Linear/Jira/GitHub split: internal `id` (cuid, FK PK, URLs) + external `ref` (short display code). |
| 7-char Crockford base32 | 32⁷ ≈ 34.4B combinations; with `@unique` + P2002 retry loop the collision window is negligible at hundreds of thousands of rows. Crockford avoids ambiguous chars (I/L/O/U). |
| `ref` non-null on every row including conversations | Pre-compute at ingest time; no nullable gaps; any future export or cross-reference always has a code. Display gate is pure frontend (`if (!isTicket)` hides it). |
| `isTicket` flag over status check | Clean invariant; status can change (NEW→DISMISSED→NEW via resurface) but `isTicket` is one-way (false→true only on convert, never reversed). |
| `User.category` set once on first email only | Categorizing on every email would misclassify real customers who got one automated email in a thread. First-email signal is highest-fidelity. |
| Two-key rationale (`id` + `ref`) | `id` stays the PK (FKs, URLs, SSE event payloads); `ref` is a separate human-facing display code. Standard pattern; code can be reformatted without touching any FK relationship. |
| Convert/Dismiss moved to detail sidebar | Inline Inbox buttons required triage without seeing the conversation; detail page gives full context before acting. |
| Unified inbox (no `view` param) | Split tab was friction. Single `GET /tickets` call; agent default excludes DISMISSED; portal scope adds `isTicket=true`. |

**Docs**: `docs/atlas/email.md` (inbound flow → conversation vs ticket section), `docs/atlas/tickets.md` (ref/isTicket table, status model, list/filter, key files, Customers endpoint, Bridge UI sections, decisions updated).

---

### 2026-06-03 — Inbox row layout: drop sender clustering for clean two-line blocks

The unified-inbox rewrite rendered conversation rows **clustered by consecutive sender** (a sender header, then indented subject lines with bullet dots). In practice this read as noisy — newsletter domains stacked a sender header + bullet-list of `[Other]` subjects + repeated promo badges per domain card.

**Change** ([apps/bridge/src/app/inbox/page.tsx](apps/bridge/src/app/inbox/page.tsx)): removed the `showSender`/`prev.user.id` consecutive-clustering logic. Every conversation is now its own self-contained **two-line block** — sender name + email (+ category badge) on top, subject + category pill + `ref` (tickets only) below, with an avatar per block and a `border-top` separator between blocks. No behavior/data/endpoint change; pure presentation. Domain → conversation grouping (`buildDomainGroups`) is unchanged.

No tests/atlas regen needed (presentational only).

**Follow-up tweaks (same session):** subject (second line) is now always regular weight (`400`) — sender name is the only bold element per block; unread is signalled by the dot + brighter color, not weight. Sender line reordered to `name → email → category badge`.

---

### 2026-06-03 — Customer profile shows conversations + tickets, rows clickable

Clicking a user (Customers page, or the profile slide-over) previously listed only **real tickets** — inbound email conversations (`isTicket=false`) were filtered out, and rows weren't clickable.

- **Backend** ([users.service.ts](apps/api/src/modules/users/users.service.ts) `findById`): `recentTickets` query dropped `isTicket: true`, now returns all of the user's rows with `status != DISMISSED` (conversations + tickets), newest first, `take: 50`. `isTicket`/`status` flow through the existing spread mapping.
- **Frontend** ([CustomerProfilePanel.tsx](apps/bridge/src/components/dashboard/CustomerProfilePanel.tsx)): section relabelled "Ticket History" → "Conversations & Tickets"; rows are clickable → `router.push('/tickets/:id')` with hover highlight; `ref` shown only when `isTicket`; reused shared `STATUS_CLS`/`STATUS_LABEL` (include `NEW`) and removed the local partial maps.
- **Decision:** kept the slide-over panel (not a full-page user view) per user preference.

No tests added (UI + query-filter change); `GET /users/:id` contract documented in [docs/atlas/tickets.md](docs/atlas/tickets.md).

---

### 2026-06-04 — Regression-safety test pass: Email + Ticketing (R92–R109)

Executed plan `hey-i-have-completed-zippy-cat`. Added 35 new net-passing tests across unit + integration layers.

**New tests added:**

- **`tests/unit/api/is-bulk-sender.spec.ts`** (R109) — 15 unit tests covering each of the 6 `isBulkSender()` signals individually + clean human email → false.
- **`tests/integration/tickets.update.spec.ts`** (R92–R101) — 15 integration tests: same-status no-op (R92), status change SYSTEM_EVENT (R93), assignee assign/unassign/same-agent (R94), `firstResolvedAt` immutability (R95), `stats()` exclusions (R96), `convert()` idempotency (R97), `list()` filters status/category/assignee/search (R98), pagination (R99), agent/portal visibility (R100), soft-delete GET bug characterization (R101 🟡).
- **`tests/integration/email-ticket-flow.spec.ts`** (R102–R107 appended as S11–S15) — agent RFC Message-ID fallback match (R102), unmatched In-Reply-To creates new ticket (R103), agent-alias `authorAgentId` stamped (R105), attachment fetch failure non-fatal (R106), `createdAt` from `sentAt` not wall-clock (R107). R104 noted as covered by existing RFC dedup test.

**Infrastructure fixes (enabled local integration test runs for first time):**

- `tests/integration/global-setup.ts`: upgraded Postgres Testcontainer from `postgres:16-alpine` to `pgvector/pgvector:pg16` and added `CREATE EXTENSION IF NOT EXISTS vector` step before schema push.
- `tests/integration/polyfills.js` + `tests/jest.integration.config.js`: Node 18 polyfills for `File` (from `buffer`) and `crypto` (from `node:crypto`) + fixed `@open-draft[^/]*` transform pattern for pnpm-encoded ESM packages.

**Pre-existing bugs found and fixed (unblocked by now-runnable harness):**

- `apps/api/src/modules/users/users.service.ts`: `listCustomers` count query used `$3` for search param but only passed `$1` — PostgreSQL error `42P18`. Fixed with `whereBaseForCount` using `$1`.
- `tests/integration/bot.respond.spec.ts`: removed stale `botEnabled`/`botRetrievalThreshold`/`botConfidenceThreshold` AppConfig fields; updated embedding URL to `gemini-embedding-001`; fixed 768-dim vector mock; updated R62/R65 to current escalation format.
- `tests/integration/shift-routing.spec.ts`: `ShiftResolverService` resolved via class token (not string); R68 endMinute `0→1440` to produce a valid 24-hour window.
- `tests/integration/email-ticket-flow.spec.ts`: fixed unescaped apostrophes (TS1005); `BotService` resolved via class token; fixed `text-embedding-004→gemini-embedding-001` URL and 3-dim→768-dim mock; updated `R75/R76/R62` escalation assertions.

**Deferred (R108, R110, R111):** P2002 race (non-deterministic), `parseGmailMessage`/`parseGraphMessage` not exported (require extraction refactor).

**Known bug locked in:** R101 🟡 — `GET /tickets/:id` returns 200 after soft-delete (no `deletedAt` check in `findById`).

**Test counts after session:** 68 unit (✅) · 69 integration (✅). All green.

---

### 2026-06-04 — Documentation reconciliation & cleanup

Docs-only session; no feature behavior changed. No tests needed.

- **CLAUDE.md** reframed to a maintenance doc: corrected single-tenant / `apps/bridge` / Phase-2-shipped facts; added §4 Commands section; de-duplicated content; fixed the "not a CI gate" line — atlas-drift + coverage-gate *are* CI-enforced; removed the build-era checkpoint list (lives in PROGRESS.md).
- **`design/` reference folder deleted** (initial-frontend scaffolding — screens + `tokens.css`; zero code imports; live tokens are each app's `src/globals.css`). References cleaned in CLAUDE.md + both `SPECS.md`.
- **Stale `.claude/` specs deleted** (`stack.md`, `data-model.md`, `api-contracts.md`, `architecture.md` — 30–45% accurate, actively misleading). Only `conventions.md` + `design-system.md` remain.
- **`docs/atlas/architecture.md` created** — current hand-written system overview: services diagram, create-ticket / inbound-email / agent-reply flows, module structure notes, package table, Docker Compose summary, feature reference links.
- **Quick Navigation index added to `docs/atlas/README.md`** — one table mapping every feature to atlas doc, API module(s), frontend page(s), and guarding tests. "Start here: architecture.md" pointer added near top.
- **STATE.md Quick Reference fixed** — `# 4. Dashboard` / `@tmr/dashboard` corrected to `# 4. Bridge` / `@tmr/bridge`.
- **Decisions table updated** with two new rows (deleted `.claude/` specs + removed `design/` folder).

### 2026-06-05 — Live-poller resilience tests (Group D, R112–R118)

Closed the last major testing gap from the email regression pass: `LivePollerService` (the `@Cron` email poller) had zero tests. Seven new integration tests guard every orchestration guarantee.

**New file: `tests/integration/email-poller.spec.ts`** — 7 tests, all green.

| ID | What it guards |
|---|---|
| R112 | `EMAIL_SYNC_LIVE_POLL !== '1'` gate — `pollAll()` is a complete no-op |
| R113 | Happy path: `pollOne()` ingests one thread and advances `gmailHistoryId` |
| R114 | `archiveStatus=RUNNING` config skipped by `pollAll()` |
| R115 | No checkpoint (null `gmailHistoryId` + `graphDeltaLink`) → warn + return, no throw |
| R116 | Per-thread try/catch isolation: first `fetchAndUpsertThread` throws, second thread ingested, checkpoint advanced |
| R117 | Stale checkpoint error → `recoverFromStaleCheckpoint({sinceDays:7})` called; recovery checkpoint persisted |
| R118 | Duplicate thread IDs in `pollChanges` result → dedup to one call per unique ID |

**Approach:** `jest.spyOn(providerFactory, 'for')` returns an in-memory `IMailProvider` stub per test. Real `ThreadIngestionService` + real DB run for R113/R116/R118 so assertions cover actual DB side-effects (ticket row, `gmailHistoryId`). `jest.restoreAllMocks()` in each `afterEach` prevents spy leakage.

**Key finding (R116):** `fetchAndUpsertThread` already catches `fetchThread` errors internally (returns `{created:false}`), so the per-thread try/catch in `pollOne` guards post-fetch failures (DB writes, downstream errors). R116 verifies this by making `fetchAndUpsertThread` itself reject via `mockRejectedValueOnce`, not by throwing from the stub's `fetchThread`.

All 7 bite-checks passed (temporarily broke each guard, confirmed matching test goes red, reverted). Full integration layer still green (76/76 tests across 11 suites).

**Docs:** regression-catalogue.md rows R112–R118 added (all ✅).

---

### Session — 2026-06-05 — Integration test coverage: Groups E–M (R119–R181)

Executed plan `hey-i-have-completed-zippy-cat.md` in full: wrote 8 new integration spec files covering all remaining untested modules.

**New files created:**
- `tests/integration/messages.spec.ts` — R119–R125 (7 tests)
- `tests/integration/auth.spec.ts` — R126–R132 (8 tests)
- `tests/integration/config.spec.ts` — R133–R138 (8 tests)
- `tests/integration/notifications.spec.ts` — R139–R144 (6 tests)
- `tests/integration/agents-shifts.spec.ts` — R145–R151 (7 tests)
- `tests/integration/analytics-rating.spec.ts` — R152–R158 (8 tests)
- `tests/integration/github.spec.ts` — R159–R165 (9 tests)
- `tests/integration/files-sync.spec.ts` — R166–R172 (8 tests)
- `tests/integration/ai-kb.spec.ts` — R173–R181 (10 tests)

**Total: 71 new tests; full integration suite 151/151 green; unit suite 68/68 green.**

**Key findings from writing tests (correcting plan assumptions):**
- `AgentRole` enum is `ADMIN|PRIMARY_AGENT|SECONDARY_AGENT` but `agents.dto.ts` only accepts `'ADMIN'|'AGENT'` — passing `'AGENT'` causes a DB error (Prisma validation). `'AGENT'` is not a valid `AgentRole`. Logged as known gap.
- `agents.remove()` is a hard delete, not a soft deactivate (plan assumed deactivatedAt).
- Factory `hashPassword` uses a 16-byte Buffer as scrypt salt; `AuthService.hashPassword` uses `randomBytes(16).toString('hex')` (hex string). These produce different hashes — auth signin tests need passwords created via the API or `hashForService` helper.
- MSW default Gemini response is SENTIMENT-format. `classifyAndScoreTicket` (CSAT operation) requires a different response shape; overrode per-test in R174.
- KB controller has no auth guard (TODO comment in code); R181 asserts current open-access behavior.
- `NotificationType` has only `GITHUB_FIX_DEPLOYED|CHURN_RISK_DETECTED` (not `TICKET_ASSIGNED`).
- `KnowledgeSource` has no `chunkCount` column — it's computed via `_count.chunks` join in the list endpoint.

**Mutation checks performed (Groups E, F, G verified by breaking production guards and confirming only the matching test goes red).**

**Docs:** regression-catalogue.md rows R119–R181 added (all ✅).

---

### Session — 2026-06-07 — Remediation T1.1: auth-guard KB + Shifts controllers

Executed the first task of plan `you-are-a-senior-wiggly-piglet.md` (Tier 1 security remediation).

**Problem:** `KnowledgeBaseController` (`/kb/*`) and `ShiftsController` (`/shifts/*`) had no
`@UseGuards` at all — KB even carried a literal `// TODO: Add auth guard` on line 1. Anyone
unauthenticated could crawl/delete the knowledge base, trigger `manualIndex` (an SSRF surface —
fetches an arbitrary user-supplied URL), wipe the index, or CRUD on-call shifts.

**Fix:**
- Added `@Controller(...) @UseGuards(AuthGuard, AgentGuard)` to both controllers (matches
  `AgentsController`/`ConfigController` pattern).
- Added `if (agent.role !== 'ADMIN') throw new ForbiddenException(...)` to every mutating
  endpoint: KB — `crawl/start`, `crawl/cancel`, `scan/start`, `scan/cancel`, `embed/confirm`,
  `sources/manual`, `sources/:id/reindex`, `sources/:id` (DELETE), `index` (DELETE); Shifts —
  `create`, `update`, `delete`. Read-only `GET` routes (`kb/status`, `kb/sources`, `shifts`)
  require a valid agent token but not ADMIN.
- Removed the `// TODO: Add auth guard` comment from `knowledge-base.controller.ts:1`.

**Tests:** updated `tests/integration/agents-shifts.spec.ts` (R150/R151 now sign in as ADMIN; new
R182 asserts 401 unauthenticated / 403 non-admin) and `tests/integration/ai-kb.spec.ts` (R177–R180
now attach an ADMIN bearer token; R181 rewritten from "asserts open access" to "asserts guarded" —
401 without a token, 403 for a non-admin on `sources/manual`).

**Docs:** regression-catalogue.md — R181 description updated to reflect the fix, R182 added for
Shifts. Architecture Decisions table updated (see row above).

---

### Session — 2026-06-07 — Remediation T1.2: shared SSRF guard for server-side fetches

Continued plan `you-are-a-senior-wiggly-piglet.md`, executed the second Tier-1 task.

**Problem:** `config.service.extractBrand` (admin-supplied URL), the KB `manualIndex` path, and
`crawler.service.fetchPage`/`fetchRobotsSitemaps`/`fetchSitemapUrlsWithLastmod` each called
`fetch()` directly on a config/admin-supplied or remotely-discovered URL (sitemap `Sitemap:`
directives and `<loc>` entries are attacker-controlled once an admin points the crawler at a
malicious site) with no protection against SSRF — internal IPs (`127.0.0.1`, `169.254.169.254`
cloud metadata, `10/172.16/192.168.x`, `localhost`, `::1`), non-`http(s)` schemes (`file://`),
oversized response bodies, or open redirects to internal targets.

**Fix:** added `apps/api/src/common/net/assert-public-url.ts`:
- `assertPublicUrl(raw)` — parses the URL, requires `https:` (or `http:` only when
  `NODE_ENV !== 'production'`), DNS-resolves the hostname (so DNS-rebinding is caught at
  call time, not just for IP literals), and rejects loopback/link-local/private/CGNAT ranges
  for both IPv4 and IPv6 (incl. IPv4-mapped `::ffff:a.b.c.d` and `localhost`).
- `fetchPublic(raw, init)` — wraps `fetch` with `redirect: 'manual'`, re-validates every
  redirect target with `assertPublicUrl` (capped at 3 hops), and rejects responses whose
  `content-length` exceeds 5 MB.
- `readBodyCapped(res, maxBytes)` — streams the body with a hard byte cap, throwing
  `UnsafeUrlError` if exceeded (protects against bodies that lie about `content-length`).

Wired `fetchPublic`/`readBodyCapped` into all 4 call sites (`config.service.ts:extractBrand`,
`crawler.service.ts:fetchPage`/`fetchRobotsSitemaps`/`fetchSitemapUrlsWithLastmod` — the last
two weren't in the plan's named list but fetch attacker-influenced URLs from `robots.txt`/sitemap
content, so they're in scope for the same SSRF class).

**Tests:** new `tests/unit/api/assert-public-url.spec.ts` (8 cases) — rejects cloud-metadata IP,
`localhost`, loopback IPv6, `file:`, private 10.x, and DNS-rebinding to a private address;
accepts a normal public https URL and a public IP literal. `node:dns/promises` mocked via
`vi.mock` so the suite has no network dependency. Full unit suite green (76/76).

**Docs:** regression-catalogue.md row R183 added; Architecture Decisions table updated (row above).

---

### Session — 2026-06-07 (continuation: T2.4 wrap-up → Tier 3 complete)

**All code fixes from the remediation plan are now complete.** Tests, regression-catalogue rows, and
docs-atlas updates were intentionally deferred per user directive ("complete all tasks, save tests for
later") — the next session should write those.

**T2.5 — Transaction races fixed:**
- `github.service.ts`: wrapped `$transaction` (post-API DB write) in try/catch with `logger.error`
  logging the full orphan-issue URL/number/repo/ticketId on failure — the orphan is un-preventable
  without distributed 2PC (GitHub has no rollback API) but is now at least discoverable in logs.
- `bot.service.ts:escalateToHuman`: fixed TOCTOU race — replaced stale `ticket.assigneeId` early-guard
  + unconditional `tx.ticket.update` with a single `tx.ticket.updateMany({ where: { assigneeId: null } })`
  that checks and acts atomically, preventing double-escalation from two near-simultaneous replies.

**T2.6 — LLM output validation:**
- `gemini.service.ts`: added `analyzeMessageResultSchema` and `classifyAndScoreResultSchema` (Zod),
  changed `invoke<T>` to take `schema: z.ZodType<T>` and parse (not just cast) the raw JSON.
- `analyzeMessage()` now derives `sentimentLabel` locally from the validated `score` using the prompt's
  own thresholds — eliminates Prisma enum-constraint crash risk from a bad model label.
- `generator.service.ts`: added `generatedAnswerSchema` (confidence ∈ [0,1]) replacing the `as T` cast.

**Tier 3 — all items:**
- **Rate limiting**: in-memory `RateLimitGuard` + `@RateLimit` decorator (`common/guards/rate-limit.guard.ts`);
  applied 10/min to 6 auth endpoints, 20/min to 2 rating endpoints.
- **fetch refactor**: `auth.service.ts` hand-rolled `https.request` helpers replaced with `oauthPost`/
  `oauthGet` using `fetch` + 10s timeout + `res.ok` check + 1 MB body cap.
- **timingSafeEqual**: `auth.guard.ts` JWT signature + `github.service.ts` HMAC-SHA256 webhook signature.
- **N+1 fixes**: `indexer.service.ts` batched per-chunk UPDATE → single `VALUES` list query;
  `customers.service.ts` topic aggregation → `$queryRaw` with `AVG(sentimentScore)`;
  `users.service.ts` pagination → 2-query (page then targeted aggregate).
- **Frontend**: portal search debounced 350ms; localStorage `JSON.parse` guards in both `auth.tsx` files.
- **Cast cleanup**: `users.service.ts` `as any` removed; `email.service.ts` nodemailer `AddrLike` type;
  `thread-ingestion.service.ts` `isAttachmentFetcher` type guard.
- **Misc**: `githubFetch` now throws on non-OK HTTP; `queue.service.ts` swallowed shutdown errors now
  logged at debug; SSE 25s heartbeat merged into stream; `AdminGuard` created and wired into
  6 controllers (22 inline role checks replaced).

**Decisions recorded:** (no new architectural decisions — all changes are within the existing design;
key judgment calls noted in plan file's task annotations)

---

### Session — 2026-06-07 (deferred test pass: R184–R194)

**Purpose:** write all tests deferred from earlier sessions per user directive. Code was already done;
this session was test-only.

**Tests written (R184–R194):**
- **R184** (`email-poller.spec`): T2.1 — all-threads-succeed → checkpoint advances to `newCheckpoint`;
  any-thread-fails → checkpoint stays at old value. Also updated R116 assertion (was asserting old
  broken behavior where checkpoint advanced despite failure).
- **R185** (`tests/unit/api/validate-env.spec.ts`, 6 cases): T1.3 — `validateEnv` throws on missing,
  too-short, non-string `BETTER_AUTH_SECRET`; accepts at minimum length and longer.
- **R186** (`tests/unit/portal/sanitize-html.spec.ts`, 10 cases): T1.4 — `sanitizeHtml` strips
  `<script>`, `<iframe>`, `on*` event attrs, `javascript:` in href/src/action; preserves safe content.
- **R187** (`auth.spec`, 4 cases): T1.6 — signup/signin/agentSignin/guest responses contain no
  `password` field.
- **R188** (`auth.spec`, 3 cases): T1.7 — guest POST returns 409 for real-account email; 201 for new;
  idempotent re-use of existing guest row.
- **R189** (`config.spec`, 2 cases): T1.6 — `PATCH /config botApiKeyEnc` stores AES-256-GCM ciphertext
  (not plaintext); null clears and sets `botKeySet=false`.
- **R190** (`config.spec`, 3 cases): T2.4 — `POST /config/logo` stores file in MinIO, persists URL;
  400 without file; 403 for non-admin.
- **R191** (`ai-kb.spec`, 3 cases): T2.6 — out-of-range model output (score:99, rating:37) throws via
  Zod and records AiUsage ERROR; valid data creates OK row.
- **R192** (`tests/unit/api/worker-guards.spec.ts`, 4 cases): T2.2 — SendReplyWorker refuses
  INTERNAL_NOTE, SYSTEM_EVENT, and isInternal=true messages.
- **R193** (`worker-guards.spec`, 2 cases): T2.3 — RequestCsatWorker skips when `csat_requested`
  marker exists; writes marker after first successful send.
- **R194** (`worker-guards.spec`, 2 cases): T2.3 — ClassifyTicketWorker only touches topicCount on
  topic change; re-classifying to same topic is a no-op.

**Bug fixed during test pass:** `bot.respond.spec.ts` R61/R72/R73/idempotency were failing because
T1.6's `decrypt(botApiKeyEnc)` call in `GeneratorService.getApiKey()` threw on the raw `'test-api-key'`
stub seeded directly in the DB (not a valid AES-256-GCM blob). Fixed: `beforeEach` now calls
`encrypt('test-api-key')` before upserting so the stored value is properly encrypted. Uses the same
`EMAIL_CREDS_KEY = '0'.repeat(64)` that `global-setup.ts` sets for integration tests.

**Infrastructure notes:**
- Worker handler testing uses the lambda-capture pattern: mock `getBoss().work(queue, handler)` to
  capture the second argument, then invoke it with a synthetic job object — no pg-boss or Docker needed.
- Unit tests in `tests/unit/api/` run without a DOM; jsdom is only applied to `portal/` and `bridge/`
  subdirs per `vitest.unit.config.ts`. `setup.ts` wraps `require('@testing-library/jest-dom/vitest')`
  in try/catch since the package only exists in portal/bridge workspaces.

**Still deferred (not written this session):**
- T1.5 IDOR tests (attachment ownership, note scoping)
- T2.5 transaction/race tests (escalation atomicity, GitHub orphan logging)
- Tier 3 opportunistic tests (rate-limit guard, AdminGuard, etc.)

**Decisions recorded:** (none — all test code follows existing patterns)

---

### Session — 2026-06-08 — Plan effervescent-leaping-nova: 5 bug fixes + configurable dropdowns

**Purpose:** Execute plan `effervescent-leaping-nova`. Five pilot bug fixes (A1–A5) and configurable portal dropdowns feature (B1–B6).

**Changes shipped:**

**A1 — GitHub settings hardcoded colors:**
- `apps/bridge/src/app/settings/github/page.tsx`: replaced all hardcoded hex/rgba literals with CSS token vars (`var(--d-surface)`, `var(--d-border)`, `var(--d-success)`, `var(--d-warning)`, `var(--d-danger)`, etc.). Page now adapts correctly to theme changes.

**A2 — GitHub repo-save desync:**
- Same file: added `loadStatus()` call after `PATCH /github/config` succeeds so the displayed status reflects what the server actually returned, not local state.

**A3 — Email badge not updating on disconnect:**
- `apps/bridge/src/lib/useEmailConfig.ts`: replaced isolated per-instance re-fetch with a module-level `listeners` Set. Any call to `invalidateEmailConfigCache()` now propagates to all mounted instances. `settings/layout.tsx` switched from manual `GET /config` fetch to `useEmailConfig()` hook; badge updates automatically when the email settings page disconnects.

**A4 — Guest session blocked for existing accounts:**
- `apps/api/src/modules/auth/auth.service.ts`: removed `ConflictException` for existing real-account emails. Guest token now bound to existing user ID; `user.isGuest` is NOT changed.
- New file: `apps/api/src/common/guards/no-guests.guard.ts` — `NoGuestsGuard` + `@NoGuests()` decorator. Applied to `GET /tickets` so guest tokens cannot browse account ticket history.
- `apps/api/src/modules/tickets/tickets.module.ts`: `NoGuestsGuard` added to providers.

**A5 — Portal signup password strength:**
- `apps/portal/src/components/auth/AuthForm.tsx`: Zod schema adds `min(8)` + `/[0-9]/` + `/[^A-Za-z0-9]/` rules; `mode: 'onChange'` for live validation; inline strength checklist UI under password field.
- `apps/api/src/modules/auth/auth.dto.ts`: backend `signupSchema` updated with matching rules.
- Integration test passwords updated to meet new strength requirements.

**B1 — Rename `product`/`connector` → `field1`/`field2`:**
- `packages/db/prisma/schema.prisma`: columns renamed (via `db:push`).
- Propagated through: `tickets.dto.ts`, `tickets.service.ts`, `packages/types/src/ticket.ts`, analytics services, all Bridge/portal pages that referenced the old field names.

**B2+B3 — AppConfig dropdown fields:**
- Schema: added `field1Label`, `field1Options`, `field2Label`, `field2Options` to `AppConfig`.
- `config.service.ts`: added `dropdownOptionSchema`, 4 fields to `UPDATABLE_FIELDS` and `updateAppConfigSchema`.

**B4 — Portal submit page configurable dropdowns:**
- `apps/portal/src/lib/brand.tsx`: added `DropdownOption` interface + 4 fields to `AppConfig`.
- `apps/portal/src/components/portal/ConnectorSelect.tsx`: rewritten as generic `OptionSelect`.
- `apps/portal/src/app/submit/page.tsx`: dropdowns now driven by `appConfig.field1Options`/`field2Options`.

**B5 — Bridge branding settings dropdown config UI:**
- `apps/bridge/src/app/settings/branding/page.tsx`: added `DropdownOption` interface, 4 fields to `AppConfig` and `form` state; loads from and saves to `PATCH /config`. New "Ticket Dropdowns" card with label input + add/remove option rows (value, label, optional icon) for each dropdown.

**B6 — Analytics field rename:**
- `analytics.service.ts`: new `byField1` and `byField2` breakdown replaces `byConnector`.
- `customers.service.ts`: `frictionByField2` replaces `frictionByConnector`.
- Bridge analytics pages updated to match new response shape.

**Seed:**
- `packages/db/src/seed.ts`: `field1`/`field2` replaces `product`/`connector` in ticket seeds; AppConfig seeded with `field1Label: 'Product'`, `field2Label: 'Connector'`, and representative options arrays.

**Tests:**
- `auth.spec.ts` (R188): updated to reflect A4 behavior change (201 instead of 409 for real-account emails); added R195 (NoGuestsGuard blocks `GET /tickets`).
- `config.spec.ts` (R196): new tests for dropdown fields round-trip + invalid option shape rejection.
- Integration test passwords updated throughout auth.spec.ts to meet new strength rules (A5).

**Docs:**
- `docs/atlas/auth.md`: updated guest flow decision note with NoGuestsGuard detail.
- `docs/atlas/tickets.md`: `connector` → `field2` in search description.
- `docs/atlas/settings.md`: branding page key files updated; new "Configurable portal dropdowns" section documenting AppConfig fields, option shape, and portal integration.
- `docs/atlas/_generated/`: regenerated via `pnpm atlas:gen` (ERD, api-routes, module-graph reflect renamed fields).

**Decisions recorded:** See Decisions table rows added for A3, A4, B1 (field rename + value-key pattern).

---

## Session Log — 2026-06-09 (Plan okay-can-you-check-binary-nova)

### Part 1 — Convert/status-update crash fix

**Bug:** Clicking *Convert to Ticket* in Bridge crashed with `Cannot read properties of undefined (reading 'reduce')` because `TicketsService.convert()` returned a partial payload (no `messages`, `attachments`, `githubIssue`, `rating`) and `setTicket(res.ticket)` replaced the fully-loaded page state.

**Fix:**
- Added `TICKET_DETAIL_INCLUDE` constant in `tickets.service.ts` — agent-visibility shape (messages where `deletedAt: null`, all relations).
- `convert()` refactored: both the NEW→OPEN path and the idempotent already-real-ticket branch now re-fetch with `TICKET_DETAIL_INCLUDE` before returning.
- `update()` refactored: dropped the partial include from `tx.ticket.update`; after the transaction commits a full `findUnique(TICKET_DETAIL_INCLUDE)` re-fetch is returned, ensuring the SYSTEM_EVENT message created inside the transaction is included.
- `findById()` updated to spread `TICKET_DETAIL_INCLUDE` as base (still adds `isInternal: false` filter for portal callers).
- Belt-and-suspenders guard: `(ticket.messages ?? []).reduce(…)` at Bridge `page.tsx:539`.

**Tests added (R197, R198):** `tickets.update.spec.ts` + assertion in `email-ticket-flow.spec.ts`.

### Part 2 — Portal rich-text editor: WYSIWYG, drop Code/Link + "Markdown supported"

**Bug:** Formatting toolbar buttons in Portal submit form and reply box had no `onClick` — formatting did nothing. "Markdown supported" label was misleading (Portal never processed markdown for user input).

**Fix (frontend only, no backend change):**
- **Submit form** (`apps/portal/src/app/submit/page.tsx`): replaced `<textarea>` with `contentEditable` div + `descEditorRef`; added `applyFormat(bold|italic|list)` using `document.execCommand`; toolbar now only Bold/Italic/List (Code and Link removed); "Markdown supported" removed; `onSubmit` reads `innerHTML` directly from ref.
- **Reply box** (`apps/portal/src/app/tickets/[id]/page.tsx`): same pattern with `replyEditorRef`; replaced `replyBody` state with `hasContent` boolean; removed Code/Link buttons and "Markdown supported" label.
- **Message display** (same file): added `isHtmlBody()` detection branch so Portal-submitted HTML renders correctly instead of showing raw tags.
- **`packages/ui/src/sanitize.ts`**: extracted `isHtmlBody()` helper and re-exported from `packages/ui/src/index.ts` for shared use across Portal and Bridge.

**No route/model/module change → `pnpm atlas:gen` not needed.**

**Editor behavior verified manually** (contentEditable + execCommand resist jsdom unit testing; existing E2E flows cover the happy path).

### Docs/tests
- `tests/regression-catalogue.md`: R197, R198 added.
- `STATE.md`: this entry.
- No atlas changes needed (no new endpoints or module wiring).

## Session — 2026-06-10 (Atlas doc audit + Gmail email body rendering fix — plan `when-a-email-received-soft-abelson`)

### Part 0 — Atlas docs audited against the working tree; drift fixed

Full audit of `docs/atlas/` (hand-written + `_generated/`). Accurate already: tickets, messages, bot, analytics, settings, portal-ticket-view, README, architecture, api-routes, module-graph. Fixed:

- **Generator bug (`scripts/atlas-gen.ts`)** — enum-typed Prisma fields were classified as relations and skipped by the ERD emitter, so every enum column (`Ticket.status/priority/category/source`, `CustomerSignal.type`, `Message.type/sentVia`, …) was missing from `_generated/erd.md`. Enum names are now pre-scanned (`enumNames` set) and excluded; `pnpm atlas:gen` re-run. Guard test: `atlas-erd-enum-fields.spec.ts` (R202).
- **queue.md** — claimed "exactly three queues"; documented all 9 (`ai:*` ×3, `bot:respond-to-ticket`, `kb:*` ×4, `email:send-reply`) with producers, workers, retry config; removed stale "outbound email is inline fire-and-forget" gap.
- **realtime.md** — SSE auth is now two-phase (`POST /events/ticket` exchanges JWT for short-lived single-use ticket → `GET /events?ticket=…`); corrected the claim that the inbox subscribes to SSE (it polls every 15 s; `ticket-created`/`ticket-updated` currently have no Bridge subscriber).
- **auth.md** — removed the deleted `POST /auth/magic-link` endpoint (flowchart, key-files, known-gaps now says "no forgot-password flow at all").
- **files.md** — server **does** enforce the 10 MB upload limit (`FileInterceptor` `limits`); inbound email attachments **are** ingested (25 MB cap) — both stale gap rows removed/corrected.
- **notifications.md** — documented the second kind, `CHURN_RISK_DETECTED` (created by `AnalyzeMessageWorker`).
- **ai.md** — pricing/model updated: `gemini-2.5-flash-lite` at $0.10/$0.40 per 1M (was Flash 2.0 $0.075/$0.30). (email.md had no stale pricing — audit-agent false positive.)
- **github.md** — documented `DELETE /tickets/:id/github/link` (unlink) + `POST …/pending`.
- `docs/atlas/architecture.md` is still **untracked** — include it in the next commit.

### Part 1 — Gmail-ingested email bodies rendered flattened/mangled in Bridge

**Bug:** an inbound Gmail email ("Sakthi is Batman" + HTML signature) displayed as one flattened line. Root cause (verified against DB row `cmq7seaw20007r5tbp0625gyd`): ingestion was fine (`body` + `bodyHtml` both stored correctly), but (1) Bridge's `MessageCard` never rendered `bodyHtml` for customer/agent replies, and (2) `isHtmlBody()`'s `/<[a-z][\s\S]*>/` regex matched Gmail's plain-text autolink `<https://twominutereports.com/>`, so the plain text went through `dangerouslySetInnerHTML` — newlines collapsed, the `<https://…>` token parsed as a bogus tag and vanished.

**Fix:**
- `packages/ui/src/sanitize.ts` — `isHtmlBody()` now matches a known-HTML-tag allowlist; new `splitQuotedHtml()` detaches `div.gmail_quote` / `blockquote[type=cite]` (keeps quote-only bodies intact; skips nested quotes).
- `apps/bridge/.../MessageCard.tsx` — new shared `MessageBody` block: prefers sanitized `bodyHtml` (quoted history behind the `···` toggle, now HTML-capable `QuoteToggle`), plain-text fallback unchanged; deleted the local duplicate `isHtmlBody`; bot + customer/agent branches unified.
- `apps/api/.../email-sync/util/html-to-text.ts` (new) — structure-preserving HTML→text (block tags → newlines, entity decode, horizontal-whitespace-only collapse); `GraphProvider` now uses it for `bodyPlain` instead of the naive tag-strip.
- No re-ingestion/migration needed — existing messages already have `bodyHtml` stored; fix is render-side (+ Graph ingestion quality going forward).

### Docs/tests
- Tests: `sanitize-html.spec.ts` extended (R199 ×4, R200 ×5), new `html-to-text.spec.ts` (R201 ×6), new `atlas-erd-enum-fields.spec.ts` (R202). All passing.
- `tests/regression-catalogue.md`: R199–R202 added.
- Atlas: `messages.md` (rendering decisions), plus all Part-0 pages; `_generated/` regenerated.
- STATE.md: 3 new Decisions rows + this entry.

---

## Session Log — 2026-06-10 (Plan when-a-email-received-soft-abelson: G1–G7 ticket lifecycle gaps)

### Overview

Executed the full `when-a-email-received-soft-abelson` plan: 7 lifecycle gaps (G1–G7) plus a new `docs/atlas/ticket-lifecycle.md` reference document.

### G3 — Shared `applyReplyTransition()` utility

Extracted inline status-machine code from `MessagesService` and `ThreadIngestionService` into a single shared utility (`apps/api/src/modules/tickets/util/apply-reply-transition.ts`). Handles: agent OPEN→IN_PROGRESS, agent IN_PROGRESS→WAITING, customer WAITING→IN_PROGRESS, customer RESOLVED/CLOSED→IN_PROGRESS (+reopenCount++). Each transition writes a `status_changed:` SYSTEM_EVENT atomically in the same transaction. Both portal and email paths now produce identical status-machine behavior. **Tests:** R108–R111 in `email-ticket-flow.spec.ts`.

### G2 — Reliable confirmation email via queue

Moved `sendTicketConfirmation()` out of `activateTicket()` (direct synchronous SMTP call) into a `email:send-confirmation` pg-boss queue. `SendConfirmationWorker` processes jobs with 3× retry + 30s exponential backoff. Idempotency: checks for `confirmation_sent:` SYSTEM_EVENT before sending; writes it on success; writes `email_delivery_failed:Confirmation…` on permanent failure. `TicketsModule` no longer imports `EmailModule`. **Schema:** no change (email itself unchanged). **Tests:** R112.

### G1 — Portal reply email mirror

Customer portal REPLY messages now enqueue a second `email:send-reply` job with `kind: 'portal-copy'`. `SendReplyWorker` branches on this field, calls `EmailService.sendPortalReplyCopy()` (From/To=support, Reply-To=customer, body prefixed with `[Portal reply from ...]`), and stores the returned Message-ID on the portal `Message` row for RFC dedup. Gated by `AppConfig.mirrorPortalRepliesToEmail Boolean @default(true)` (new field, schema pushed via `db:push`). `ConfigService` updated to include `mirrorPortalRepliesToEmail` in `UPDATABLE_FIELDS`.

### G5 — Microsoft Graph attachment extraction

`GraphProvider` now extracts attachments when `hasAttachments = true` per message: fetches attachment list, calls `fetchAttachmentBytes()` to decode `contentBytes` base64. Graph message/attachment IDs stored in `ParsedAttachment.gmailMessageId`/`gmailAttachmentId` fields (provider-opaque). `ThreadIngestionService` duck-types `'fetchAttachmentBytes' in provider` — works for both Gmail and Graph without branching.

### G4 — Bounce detection

Pre-ingest check in `fetchAndUpsertThread`: BOUNCE_PATTERN `/^(mailer-daemon|postmaster)(@|$)/i` on first message `fromEmail`. On match: skip user upsert, try to match bounce to a known ticket (RFC Message-ID lookup, then synthetic `ticket-{emailThreadId}@` pattern with regex `[a-z0-9][a-z0-9-]*` to support hyphenated IDs). On match: write `email_delivery_failed:bounce` SYSTEM_EVENT + set `User.emailStatus = BOUNCING`. Bridge sidebar shows "email bouncing" chip. **Tests:** R114–R115.

### G6 — Inbox SSE real-time updates

`apps/bridge/src/app/inbox/page.tsx` now subscribes to `ticket-created`, `ticket-updated`, `message-created` SSE events via `sseEventBus.on()`. Debounced trigger (300ms) calls `refetch()`. `visibilitychange` also triggers refetch on tab re-focus. Poll interval stretched from 15s → 60s (fallback only for SSE connection loss).

### G7 — Bridge reply composer file attachment

`apps/bridge/src/app/tickets/[id]/page.tsx` wired: hidden `<input type="file">` opened by Paperclip button click; files uploaded to `POST /api/v1/files/upload?ticketId={id}`; attachment chips appear above toolbar with `×` remove button; `attachmentIds` included in `POST /tickets/:id/messages` payload. Mirrors the portal composer pattern. Also added bounce status chip in ticket sidebar (`emailStatus !== 'ACTIVE'` → red chip).

### Lifecycle doc

`docs/atlas/ticket-lifecycle.md` — new 13-case comprehensive reference covering all paths: portal create, email ingest, backfill, convert, dismiss, portal reply, agent reply, inbound reply, CSAT, escalation, reopen, bounce, GitHub fix-deployed. Linked from `docs/atlas/README.md`.

### Test fixes

- **TS1128 at line 1111**: extra `})` from heredoc append removed.
- **S1/S2 confirmation tests**: updated to directly invoke `emailService.sendTicketConfirmation()` (pattern matching existing agent-reply tests) — queue path tested separately by R112.
- **R112**: pg-boss `newJobCheckInterval: 100` in `NODE_ENV=test`; 800ms wait now reliable.
- **R114 bounce regex**: `[a-z0-9]+` → `[a-z0-9][a-z0-9-]*` to match hyphenated `emailThreadId` values.

### Docs updated

- `docs/atlas/ticket-lifecycle.md` (new)
- `docs/atlas/email.md` — G1/G2/G4/G5 sections, bounce detection, Graph attachments, data model fields, notable decisions
- `docs/atlas/messages.md` — G1/G3/G7, shared utility, status table updated (RESOLVED/CLOSED reopen), known gaps trimmed
- `docs/atlas/queue.md` — `email:send-confirmation` added, send-reply updated (kind: portal-copy)
- `docs/atlas/realtime.md` — inbox SSE subscription row, polling note updated
- `docs/atlas/_generated/` regenerated via `pnpm atlas:gen`
- `tests/regression-catalogue.md` — R108–R112, R114–R115 added
- STATE.md — 8 new Decisions rows + this session entry

---

## Session Log — 2026-06-10 (Plan when-a-email-received-soft-abelson: E2E test suite)

### Overview

Executed the E2E portion of the `when-a-email-received-soft-abelson` plan: wired up the two core email ticketing flows (F1 portal-to-bridge round-trip, F2 inbound email triage) as real Playwright tests. All infra was already scaffolded; this session made the tests runnable.

### New API endpoint: `POST /__test/ingest-email` (test-only)

Added to `TestController` / `TestUtilsModule` (loaded only when `NODE_ENV=test`). Accepts `{ from, fromName?, subject, body, threadId?, messageId?, inReplyTo?, headers? }`, builds a `ParsedThread` + minimal fake `IMailProvider`, and calls the production `ThreadIngestionService.fetchAndUpsertThread()`. All downstream logic is production code. `TestUtilsModule` now imports `EmailSyncModule` to resolve `ThreadIngestionService`.

### Bot disabled in E2E

No `GEMINI_API_KEY` in the playwright webServer env + no `botApiKeyEnc` in seed. `BotService.respondTo()` catches embedding errors gracefully (logs, writes `BotInteraction.didAnswer=false`, does NOT throw or leave a retrying pg-boss job).

### Stable selectors (`data-testid`)

Added to every E2E touchpoint (render-only, no logic change):
- Bridge inbox: `inbox-row`, `ticket-ref`, `status-pill`
- Bridge ticket detail: `reply-editor`, `reply-send`, `convert-ticket`, `dismiss-ticket`
- Bridge `MessageCard` body div: `message-body`
- Portal submit form: `submit-title`, `submit-description`, `submit-send`
- Portal ticket detail: `reply-editor`, `reply-send`, message container `message-body`

### E2E fixtures (`tests/e2e/fixtures/`)

- `auth.ts` — `agentApiLogin`, `customerApiLogin`, `plantAgentToken`, `plantCustomerToken`
- `mail.ts` — `getCapturedMail`, `resetCapturedMail`, `expectMailDelivered` (wraps `expect.poll` for G2 queue latency)
- `ingest.ts` — `ingestEmail` (wraps `POST /__test/ingest-email`)

### F1 spec rewritten

`tests/e2e/flows/F1.spec.ts` — portal ticket submit (real UI login), G2 confirmation email poll, SSE-driven inbox row, agent reply via `reply-editor`/`reply-send`, customer portal shows reply, customer reply triggers G1 portal-copy email. Unique subject per run for data isolation.

### F2 spec rewritten

`tests/e2e/flows/F2.spec.ts` — ingest from unique stranger email, SSE inbox row (no status-pill/ticket-ref until convert), convert button, confirmation email, agent reply, follow-up ingest (same threadId, new messageId, inReplyTo agent message-id) → G3 status transition. Portal-side skipped (stranger has no password).

### Plumbing fixes

- `global-setup.ts` line 62: removed `|| true` from seed step — failures now surface loudly.
- `.gitignore`: added `.playwright-state.json`, `test-results/`.

### Docs updated

- `tests/README.md` — E2E row updated (2 files, 2 tests, run instructions)
- `tests/regression-catalogue.md` — R116 (F1), R117 (F2) added
- STATE.md — 2 new Decisions rows + this session entry

## Session — 2026-06-11 (E2E suite first-ever green: F1 + F2 — and a real SSE production bug found)

### E2E infrastructure restructure (root cause: Playwright boots webServers BEFORE globalSetup)

The scaffolded design (globalSetup boots Testcontainers and hands DATABASE_URL to webServers via
process.env) can never work — verified in the Playwright 1.60 runner source, plugin setup precedes
globalSetups. The API booted first and silently fell back to `.env` (the dev DB). Restructure:

- **`tests/e2e/infra.ts` (new)** — owns container lifecycle (`up`/`down`): pgvector Postgres
  (extension created via in-container psql) + MinIO, `db push`, seed, marks AppConfig email
  "connected" with dummy tokens (`support@e2e.test`; safe — test-mode EmailService short-circuits
  to MailCapture before touching OAuth), writes `tests/e2e/.env.e2e`. Ryuk disabled; containers
  reused across runs for warm `--ui` iteration.
- **playwright.config.ts** — reads `.env.e2e` at load time, injects into the API webServer env;
  `reuseExistingServer: false` everywhere (a reused dev server on :3001 caused silent 401s);
  `GEMINI_API_KEY: ''` (bot disabled in E2E → escalation path, by user decision).
- **global-setup** → fast guard only (asserts :3001 is a test-mode API); teardown → no-op.
- **Scripts**: `test:e2e` (up → test → down), `test:e2e:ui`, `test:e2e:infra(:down)`.
- **E2E removed from CI and from the aggregate `pnpm test`** — manual-only by user decision.
- Seed fixed (predated ref/isTicket redesign): generates Crockford `ref`, sets `isTicket: true`,
  logs `ticket.ref` (the `Ticket.number` field no longer exists).

### 🔴 Production bug found by E2E: SSE was dead app-wide

`TransformResponseInterceptor` wrapped **every** observable emission in `{data}` — including each
`@Sse` frame. Wire format became `data: {"data":"{\"type\":…}"}`, Bridge parsed
`event.type=undefined` and silently dropped every event (inbox, ticket detail, backfill progress —
all masked by polling fallbacks). Fix: skip wrapping when the handler carries Nest's `__sse__`
metadata. Test: `transform-response-interceptor.spec › R203`.

### Spec fixes (first-contact bugs)

- mail fixture unwraps the global `{data}` envelope (R-: poll compared against undefined).
- F1/F2: `locator.isVisible()` does not auto-wait — conditional Reply-button clicks raced page
  load; replaced with auto-waiting `click()`.
- F1 must fill the description (no description → no customer REPLY row → no message card → no
  Reply button).
- F1's G1 mirror assertion targets `support@e2e.test` (AppConfig.oauthEmail in E2E).

**Result: `pnpm test:e2e` → 2 passed** (F1 portal round-trip incl. confirmation + reply email +
G1 mirror; F2 ingest → convert → confirmation → reply email → customer email reply threading +
G3 transition). Gemini ERROR log lines during runs are expected (bot disabled → escalation path).
Unit suite 120 passing incl. new R203.

### Docs
- tests/README.md §2 E2E row updated (manual-only, infra lifecycle, --ui workflow).
- tests/regression-catalogue.md: R203.
- CI workflow: e2e job replaced with a comment pointing at `pnpm test:e2e`.

---

## Session — 2026-06-14 — Maintenance Mode feature

### What changed

Added a **Maintenance Mode** section to Bridge → Settings → General. One master toggle with five individual feature-flag toggles — all backed by a single shared helper and guarded at every automated-action call site.

**Schema**: Added 6 boolean fields to `AppConfig`:
- `maintenanceMode` (master, default `false`)
- `featConfirmationEmail`, `featBotReply`, `featAiAnalysis`, `featCsatSurvey`, `featGithubIssueCreation` (all default `true`)

Migration: `20260614000000_add_maintenance_mode` (manual SQL, applied via `prisma migrate resolve --applied`).

**Backend helper**: `apps/api/src/modules/config/feature-flags.ts` — pure `isFeatureSuppressed(config, feature)` function. Guard rule: master ON suppresses all; master OFF respects individual flags.

**Guard points added**:
- `send-confirmation.worker.ts` — confirmation email silent skip
- `bot.service.ts` `respondTo()` — bot silent skip (no BotInteraction, no note)
- `analyze-message.worker.ts`, `classify-ticket.worker.ts` — AI analysis silent skip
- `request-csat.worker.ts` — CSAT survey email silent skip
- `github.service.ts` `createIssue()` — throws `BadRequestException(400)` to surface to agent UI

**Config API**: `UPDATABLE_FIELDS` + Zod schema extended with the 6 new booleans. No controller change needed — `getSafe()` returns all `AppConfig` columns.

**Frontend**: `apps/bridge/src/app/settings/general/page.tsx` — new Maintenance Mode section with a master toggle (requires confirm modal), five individual toggle rows (disabled + dimmed when master is ON). Inline `Switch` helper component built from the shifts page pattern.

### Tests

- `tests/unit/api/feature-flags.spec.ts` — full truth table for `isFeatureSuppressed` (17 assertions). All 137 unit tests passing.
- Fixed `worker-guards.spec.ts` (`makeClassifyWorker` mock was missing `appConfig.findFirst`).
- `tests/regression-catalogue.md` — R118 added.

### Docs

- `docs/atlas/settings.md` — new Maintenance Mode section with guard-point table.
- `docs/atlas/_generated/` — regenerated via `pnpm atlas:gen` (ERD now includes the 6 new fields).
- `STATE.md` — 3 new Decisions rows + this Session Log entry.

## Session Log — 2026-06-14 (Plan in-bridge-when-i-luminous-perlis: Bridge skeleton loading states)

### Overview

UI polish pass: replaced blank screens and plain "Loading…" text across the Bridge agent dashboard with layout-matching shimmer skeletons using the existing `.shimmer` CSS class.

### Changes

- **New:** `apps/bridge/src/components/Skeleton.tsx` — shared `Skeleton` and `SkeletonText` primitives built on `.shimmer`, no new CSS or library.
- **Analytics — Operations:** deleted local `Skeleton` helper (was duplicated inline), imported shared component. Added skeleton placeholder cards for the `field1`/`field2` bar charts during loading so the 3-column grid doesn't collapse while data loads.
- **Analytics — Customer Insights:** replaced centered "Loading…" text with a full-page layout-matching skeleton: 6-card KPI strip, 3-card signals strip, two pairs of chart cards — mirrors the real grid templates so no layout jump on data arrival.
- **Settings — General:** added `loading` state; page previously rendered an empty form silently. Now shows form-field skeletons (icon box, name field, appearance card, feature-flag rows) while the `GET /config` call completes.
- **Settings — Email:** replaced `if (!cfg) return <div>Loading…</div>` with a card-shaped skeleton matching the real page structure.
- **Settings — Shifts:** replaced `<Loader2>` spinner with a table-row skeleton (header row + 3 shimmer rows) that matches the real table's column layout.
- **Settings — GitHub:** added `!status ? skeleton : ...` guard in the GitHub connection card body so the status block shimmers while the initial `GET /github/status` resolves.

### Tests

No tests required — presentation-only changes with no behavioral logic, endpoint, schema, or data-flow change.

### Docs

No atlas regen required — no new endpoint, module, or schema change. This Session Log is the only doc update needed.

### 2026-06-14 — Operations analytics rework (plan in-bridge-we-have-wiggly-stream)

**Problem fixed:** the Operations tab was counting the wrong population (conversations and dismissed
rows mixed with real tickets), using a broken resolution-time metric (message body text scan + mean
mislabeled "median"), and missing all front-line responsiveness signals.

**What changed:**

- **Schema** — `Ticket.convertedAt DateTime?` added (set in `convert()`); `AppConfig.slaFirstResponseHours Int @default(4)` added. Migration `20260614000001_ops_analytics_fields`.
- **`tickets.service.ts`** — `convert()` now stamps `convertedAt: new Date()` when flipping `isTicket → true`.
- **`analytics.service.ts`** — full rewrite: `REAL = { deletedAt: null, isTicket: true }` base filter applied to every count/groupBy; resolution time uses `firstResolvedAt` (P50+P90 via `percentile()` helper); Agent FRT P50/P90 computed via raw SQL with per-ticket bot-escalation clock-start; SLA compliance %; triage backlog + oldest age + time-to-triage median; bot deflection rate + escalation count; reopen rate; Created vs Resolved 30d dual-series. Removed `topCustomers`. `AppConfigService` injected to read `slaFirstResponseHours` and `featBotReply`.
- **`analytics.module.ts`** — `AppConfigModule` added to imports.
- **`operations/page.tsx`** — complete rewrite: new `AnalyticsData` shape; Responsiveness KPI row (5 cards); Triage & Automation row (3–4 cards, bot card conditional); Created vs Resolved dual-series area chart (replaces single-series volume); section labels; staggered framer-motion entrance; count-up on integers; card hover-lift; `InfoTooltip` on every widget. Removed High-attention customers table and tickets-per-customer insight.
- **`InfoTooltip`** — promoted from local function in `customers/page.tsx` to shared `apps/bridge/src/components/InfoTooltip.tsx`; `customers/page.tsx` now imports it.
- **`docs/atlas/analytics.md`** — updated Operations section with full metric definitions, FRT clock rule, schema additions, premium UX section, and component table.
- **`docs/atlas/_generated/`** — regenerated via `pnpm atlas:gen`.
- **STATE.md Decisions** — 5 new rows documenting real-ticket scoping, FRT clock rule, convertedAt semantics, slaFirstResponseHours, resolution-time fix.

## Session Log — 2026-06-14 (Plan in-bridge-we-have-wiggly-stream: Operations analytics premium polish)

Premium polish and layout-gap pass on the Operations analytics dashboard. No new API surface; no atlas regen needed (metric semantics unchanged).

### Changes

- **`apps/bridge/src/globals.css`** — strengthened `--d-shadow-card` in light mode (`0 1px 3px/0 4px 12px rgba(16,24,40,...)`) and `--d-shadow-lg`; added subtle dark-mode resting shadow to `:root` (`--d-shadow-card: 0 1px 2px/0 1px 3px rgba(0,0,0,0.35/0.25)`) and `--d-shadow-lg`; extended card elevation CSS rule to both `html:not([data-theme="light"])` and light mode so cards read as raised in both themes.
- **`operations/page.tsx`**:
  - **Hover shadow fix** — `onMouseLeave` in `KpiCard`, `Card`, and `InsightCard` now restores `var(--d-shadow-card)` (was `''`, which left dark-mode cards flat after hover).
  - `KpiCard` hover shadow now uses `var(--d-shadow-lg)` token instead of hardcoded rgba.
  - `InsightCard` — added hover lift + shadow handlers and `transition`; was completely flat previously.
  - **Grid gap fix** — Category/field1/field2/Priority row now uses `repeat(${breakdownCols}, 1fr)` computed dynamically: 2 columns when field1+field2 have no data, up to 4 when both have data. Eliminates the dead empty column when optional fields are absent.
  - **Status pie** — centred (`cx="50%"`), legend moved to horizontal bottom, donut-hole total label added via recharts `<Label content={...}>`.
  - **minHeight** — `KpiCard` gets `minHeight: 112`, `InsightCard` gets `minHeight: 90` so Responsiveness and Triage rows are vertically even.
  - **Created-vs-Resolved** — graceful empty state ("No ticket data yet") mirroring the pie's `No data` handling.
- **`packages/db/src/seed.ts`** — enriched with 55 new idempotent tickets spread over 30 days: 23 RESOLVED, 8 CLOSED, 8 OPEN, 4 IN_PROGRESS, 3 WAITING, 3 DISMISSED email conversations, 5 NEW triage-backlog rows. Includes 4 additional customers (`alex`, `mary`, `tom`, `lisa`), reopenCount > 0 on 3 tickets, 12 BotInteraction rows (mix of `didAnswer` true/false), and first-agent-reply messages so FRT metrics populate.

## Session Log — 2026-06-14 (Plan in-portal-signup-flow-enumerated-clarke: Email verification + forgot/reset password)

Added two new Portal auth flows on top of the existing `MagicToken` model and pg-boss queue
pattern: a soft email-verification gate, and a forgot/reset-password round trip. Both are core
auth flows — **no feature flags, no `maintenanceMode` gating**.

### Schema

- **`MagicToken.type: MagicTokenType`** (`EMAIL_VERIFICATION` | `PASSWORD_RESET`, new enum) +
  `@@index([userId, type])`. Migration `20260614000002_magic_token_type` (hand-written + applied
  via the documented shadow-DB workaround — `prisma migrate dev` still can't replay
  `20260530000000_athena_bot` against a fresh shadow DB).

### API (`apps/api`)

- **`auth.dto.ts`** — `verifyEmailSchema`, `forgotPasswordSchema`, `resetPasswordSchema`.
- **`auth.service.ts`** — `createMagicToken`/`consumeMagicToken` helpers; `signup()` now issues an
  `EMAIL_VERIFICATION` token + enqueues `email:send-verification`; `googleAuth()` sets
  `isVerified: true` for both new and linked users; new public methods `verifyEmail`,
  `resendVerification` (from `@CurrentUser()`), `requestPasswordReset` (always succeeds, no
  enumeration), `resetPassword` (also sets `isVerified: true`).
- **`auth.controller.ts`** — `POST /auth/verify-email`, `POST /auth/resend-verification` (authed),
  `POST /auth/forgot-password`, `POST /auth/reset-password`, all rate-limited.
- **`queue.module.ts` / `queue.service.ts`** — `EMAIL_SEND_VERIFICATION_QUEUE` and
  `EMAIL_SEND_PASSWORD_RESET_QUEUE` + `enqueueEmailVerification`/`enqueueEmailPasswordReset`.
- **`email.service.ts`** — `sendEmailVerification` / `sendPasswordReset` (same
  `getTransporter()` + try/catch + logger pattern as existing send methods; no Graph branching,
  consistent with sibling methods).
- **New workers** `send-verification.worker.ts` / `send-password-reset.worker.ts` (registered in
  `email.module.ts`) — skip if `AppConfig` missing or (verification only) user already verified;
  build `${PORTAL_URL}/verify-email?token=…` / `${PORTAL_URL}/reset-password?token=…`. No
  suppression branch — these always run.

### Portal (`apps/portal`)

- New pages: `/verify-email` (consumes `?token=`, loading/success/error states, calls `signIn`
  with updated `isVerified` if already authed), `/forgot-password` (always shows "Check your
  email"), `/reset-password` (consumes `?token=`, password+confirm form, same strength rules as
  signup).
- New shared `AuthCard` component (extracted from the `/auth` page layout) used by all three pages.
- New `VerificationBanner` (in `PortalNav`, `data-testid="verification-banner"`) — shown whenever
  `user && !user.isVerified && !user.isGuest`, with a "Resend" button
  (`data-testid="resend-verification-btn"`) hitting `/auth/resend-verification`.
- `AuthForm.tsx` — previously-dead "Forgot password?" button now routes to `/forgot-password`;
  `AuthUser`/`AuthResponse` types gained `isVerified: boolean` (also fixed a missed
  `isVerified` field on the Google OAuth callback's `AuthResponse` type — portal type-check was
  failing without it).

### Tests

- **`tests/integration/auth-verification-reset.spec.ts`** (new, 14 tests) — R204-R209: signup
  issues a verification token + job; verify-email happy/expired/used/wrong-type paths;
  resend-verification re-issues vs. no-ops for verified users; forgot-password
  no-enumeration + real-account paths; reset-password updates password + `isVerified` + rejects
  reused tokens; googleAuth sets `isVerified=true` for new and linked users.
- **`tests/unit/api/worker-guards.spec.ts`** — R210/R211: `SendVerificationWorker` and
  `SendPasswordResetWorker` skip on missing `AppConfig` / already-verified / unknown user, and
  build the correct portal URLs otherwise.
- **`tests/e2e/flows/F3.spec.ts`** (new) — R212: signup → verification banner visible → verify
  email link → banner clears; "Forgot password?" → `/forgot-password` → reset email →
  `/reset-password` → sign in with the new password. (Not executed in this session — the sandbox's
  Node 22.15 can't `require()` `@tmr/db`'s raw-TS `main` entry, so the API webServer fails to boot
  for any Playwright run, F1/F2 included. Pre-existing environment issue, unrelated to this change.)
- Added R204-R212 rows to `tests/regression-catalogue.md`.

### Docs

- `docs/atlas/auth.md` — new "Email verification (soft gate)" and "Forgot / reset password"
  sections; removed the "No forgot-password flow" known gap; new Notable Decisions.
- `docs/atlas/_generated/` regenerated (`pnpm atlas:gen`): 86 routes / 20 controllers, 25 modules,
  22 models / 24 enums.
- STATE.md Decisions — 4 new rows (soft verification gate, `MagicToken.type` reuse, no
  feature-flag gating on these workers, forgot-password no-enumeration).

### Verification

- `pnpm --filter @tmr/api type-check` ✅, `pnpm --filter @tmr/portal type-check` ✅ (after the
  Google-callback `AuthResponse.isVerified` fix above).
- `pnpm test:unit` — 143/143 ✅ (includes new R210/R211 worker tests).
- `pnpm test:integration` — new `auth-verification-reset.spec.ts` 14/14 ✅. Full-suite run hit a
  pre-existing "too many database connections" failure across 7 unrelated suites when run
  back-to-back (maxWorkers=1, but connections accumulate across 21 suites in one process); the
  same suites pass individually. Not a regression from this change.
- `pnpm lint` not run — pre-existing environment issue in this sandbox (`@tmr/api` has no ESLint
  config for ESLint 6.4.0; `next lint` for `@tmr/portal` wants an interactive `eslint --init`).

---

## Session Log — 2026-06-14 (plan: in-this-app-we-nested-squirrel)

**Scope**: Email sending migration + sync hardening + cleanup (5 work items)

### Changes

**Item 1 — Gmail REST API send (scope narrowing)**
- `apps/api/src/modules/email/email.service.ts` — replaced SMTP XOAUTH2 send path for Google
  OAuth with Gmail REST API `users.messages.send`. New helpers: `buildMimeBuffer()` (nodemailer
  streamTransport → raw RFC 2822 Buffer), `gmailApiSend()` (base64url-POST to Gmail API), `send()`
  (unified routing: test capture → Gmail API → Microsoft SMTP → plain SMTP). Removed the old
  `getTransporter()` (renamed to `getSmtpTransporter()` for non-Gmail use); kept SMTP path for
  Microsoft OAuth and plain-SMTP fallback.
- `sendTicketConfirmation`, `sendAgentReply`, `sendPortalReplyCopy` now **throw on failure** (no
  more try/catch swallowing). Return types changed from `Promise<void>` / `Promise<string | null>`
  to `Promise<string>` (returns the RFC Message-ID).
- All non-critical send methods (`sendAgentInvite`, `sendEscalationNotification`,
  `sendEmailVerification`, `sendPasswordReset`, `sendRaw`) updated to use the unified `send()`
  helper so they work with Gmail API too (keep their own try/catch).
- `apps/api/src/modules/email-oauth/email-oauth.service.ts` — Google OAuth scope narrowed from
  `https://mail.google.com/ email profile` to
  `https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send email profile`.
  **Existing connected accounts must reconnect** to receive the narrower scope.

**Item 2 — Delete ticket action removed**
- `apps/api/src/modules/tickets/tickets.controller.ts` — removed `@Delete(':id')` endpoint.
- `apps/api/src/modules/tickets/tickets.service.ts` — removed `softDelete()` method; added
  `deletedAt: null` guard to `findById()` so soft-deleted tickets return 404 (fixes R101).
- `apps/bridge/src/app/tickets/[id]/page.tsx` — removed "🗑 Archive ticket" button.

**Item 3 — Sync dispatcher/importer split + on-by-default + alerting**
- `apps/api/src/modules/queue/queue.module.ts` — added `EMAIL_INGEST_THREAD_QUEUE` constant.
- `apps/api/src/modules/queue/queue.service.ts` — added `IngestThreadJobData` interface and
  `enqueueIngestThread()` (singletonKey = `cfgId:threadId`, 5× retry + backoff).
- `apps/api/src/modules/email-sync/live-poller.service.ts` — refactored to thin dispatcher:
  enqueue all changed threads → advance checkpoint (always). Removed in-process ingestion +
  conditional checkpoint hold. Changed `enabled` gate from `=== '1'` to `!== '0'` (on by default).
  `ThreadIngestionService` dependency removed; `QueueService` added.
- `apps/api/src/modules/email-sync/ingest-thread.worker.ts` — new `IngestThreadWorker`:
  consumes `email:ingest-thread`, calls `ThreadIngestionService.fetchAndUpsertThread`.
- `apps/api/src/modules/email-sync/email-sync.module.ts` — added `IngestThreadWorker`.
- `apps/api/src/modules/email-sync/email-sync.controller.ts` — added `GET /sync/health`
  endpoint (returns `{ failedIngestJobs: N }` via raw Prisma query on `pgboss.job`).
- `apps/bridge/src/app/settings/email/page.tsx` — added `useSyncHealth()` hook and banner
  showing failed job count when > 0 (polls `/sync/health` every 60s).

**Item 4 — Confirmation email paper trail**
- `apps/api/src/modules/email/workers/send-confirmation.worker.ts` — stores the RFC
  `messageId` returned by `sendTicketConfirmation()` on the `confirmation_sent:` SYSTEM_EVENT row.

**Item 5 — Widened bounce detection**
- `apps/api/src/modules/email-sync/thread-ingestion.service.ts` — `BOUNCE_PATTERN` extended to
  include `bounce|bounces|noreply|no-reply|no.reply|donotreply|do-not-reply|auto-reply|autoreply`.
  Bounce handler wrapped in try/catch with WARN logging on failure.

### Docs
- `docs/atlas/email.md` — Gmail API send path, scope change, dispatcher/importer flow diagram,
  `GET /sync/health` endpoint, paper-trail note on confirmation, widened bounce pattern,
  `EMAIL_SYNC_LIVE_POLL` default-on, re-auth requirement for existing accounts.
- `docs/atlas/tickets.md` — delete action removed (Notable Decisions updated).
- `tests/regression-catalogue.md` — R101 promoted from 🟡 to 🔴 (fix landed); R184 superseded
  (behavior changed); new R213-R216 entries.

### Tests
- `pnpm type-check` ✅ (API + bridge).
- `pnpm test:unit` — 143/143 ✅.
- `pnpm test:integration` — running at session end.

### Known gaps
- `pnpm atlas:gen` not run (no new routes/models, only one endpoint added: `GET /sync/health`).
  Run before pushing.
- R213-R216 test bodies to be written.
- Existing accounts must re-consent for narrower Google scope — a reconnect flow banner is a
  follow-up (not blocking; old tokens continue to work until they expire, at which point the
  auto-refresh will fail and the admin will see an OAuth error).

### Follow-up fix (same session) — Gmail thread-id capture (R217)
- **Bug found after migration:** agent replies on **portal-originated** tickets were sent as new
  Gmail threads. Root cause: the Gmail REST API only threads a sent message when the request body
  carries the conversation's `threadId` — matching `References`/`In-Reply-To` headers alone are not
  enough (unlike SMTP). Portal tickets have no `externalThreadId` until an inbound email arrives, so
  `gmailApiSend` sent with no `threadId` every time, and it also **discarded** the `threadId` Gmail
  returned.
- **Fix** (`apps/api/src/modules/email/email.service.ts`): `gmailApiSend` now returns the
  `GmailSendResponse` (`{id, threadId}`); `send()` returns it; new private `stampGmailThreadId()`
  persists the returned `threadId` onto `Ticket.externalThreadId` via `updateMany(where: {externalThreadId: null})`
  (never clobbers a thread id from inbound ingestion). Called from `sendTicketConfirmation`,
  `sendAgentReply`, `sendPortalReplyCopy`. First outbound (the confirmation) establishes the thread;
  the reply worker re-fetches the ticket so later replies pass the stamped `threadId`.
- **Tests:** `tests/unit/api/email-thread-stamping.spec.ts` (R217, 3 cases) ✅; `pnpm test:unit` 146/146 ✅.
- **Docs:** `docs/atlas/email.md` Threading row + R217 in regression catalogue.
- **Known edge:** if the bot reply and the confirmation send concurrently on a brand-new portal
  ticket (both before either stamps), they can land in two Gmail threads (first stamp wins, second
  no-ops). Rare; not addressed.

---

## Session Log — 2026-06-14 (plan: i-recenty-migrated-to-effervescent-locket)

### Fix — recipient-side threading broken by Gmail's Message-ID rewrite (R218)

- **Bug:** every agent reply and ticket-confirmation pair showed up as **two separate
  conversations** in the recipient's mailbox, even after R217's `threadId` stamping fixed the
  *sending* account's view.
- **Root cause (confirmed via "Show original"):** recipient mail clients thread on RFC headers
  (`Message-ID`/`In-Reply-To`/`References`), not Gmail's `threadId`. Gmail **rewrites the
  sender-supplied `Message-ID`** on send — our synthetic `<ticket-...@gmail.com>` /
  generated ids were replaced with `<...@mail.gmail.com>`. The reply's `In-Reply-To`/`References`
  still pointed at the dead synthetic id, which no delivered message has, so the recipient's
  client started a new thread.
- **Fix** (`apps/api/src/modules/email/email.service.ts`):
  - `gmailApiSend` now does a follow-up `GET /gmail/v1/users/me/messages/{id}?format=metadata&metadataHeaders=Message-ID`
    after sending, and attaches the Gmail-assigned id as `GmailSendResponse.rfcMessageId` (best
    effort — logs and continues if the lookup fails). No new OAuth scope needed (`gmail.modify`
    already grants read).
  - `buildThreadHeaders` no longer filters to `type: 'REPLY', isInternal: false` — it now chains
    `References`/`In-Reply-To` from **all** stored `Message.messageId` values (internal notes
    naturally have none), so the confirmation's real id is included as the thread root.
  - `sendTicketConfirmation` / `sendAgentReply` / `sendPortalReplyCopy` now return
    `result?.rfcMessageId ?? <synthetic/generated id>`. Workers already persist the returned id
    onto the message row, so the real-id chain self-assembles with no worker changes.
  - **Bonus:** the confirmation's real Message-ID is now also usable for inbound Level-1 matching
    in `ThreadIngestionService` (a customer reply's `In-Reply-To` now matches a stored
    `Message.messageId` directly, not just the Level-2 synthetic-pattern fallback).
- **Scope / known gap:** fix targets the **Gmail REST** send path only. Microsoft Graph and plain
  SMTP also rewrite the sender Message-ID but have no equivalent "fetch the assigned id"
  follow-up in `EmailService` — those paths still fall back to the synthetic/generated id for
  `References`/`In-Reply-To`. Recorded in `docs/atlas/email.md` Known gaps.
- **Tests:** extended `tests/unit/api/email-thread-stamping.spec.ts` with R218 (2 cases) — asserts
  the Gmail-assigned id is returned for the confirmation, and that a subsequent agent reply chains
  `References`/`In-Reply-To` from the real stored confirmation id (not the synthetic root).
  `pnpm test:unit` (email-thread-stamping.spec.ts) — 5/5 ✅.
- **Docs:** `docs/atlas/email.md` — Threading row, sequence diagram, confirmation paper-trail
  section, and new Known gap (Graph/SMTP); R218 added to `tests/regression-catalogue.md`.

---

## Session Log — 2026-06-15 (plan: in-ticket-flow-i-dreamy-toast)

### Feature — delta-quoting for outbound emails (R219)

- **Bug:** a portal ticket's confirmation email contained only the fixed confirmation boilerplate
  — the customer's own ticket description never reached their inbox. Similarly, an agent's reply
  email never quoted the customer's prior message(s), so a customer who'd sent follow-ups before
  an agent answered saw a reply with no visible context.
- **Fix** — added a nullable watermark `Message.customerEmailedAt DateTime?` (+
  `@@index([ticketId, customerEmailedAt])`, migration `20260615000000_add_message_customer_emailed_at`,
  applied via the documented shadow-DB workaround — hand-written SQL + `prisma db execute` +
  `prisma migrate resolve --applied`). `EmailService` gained:
  - `loadUndeliveredHistory(ticketId, excludeMessageId?)` — customer-facing `REPLY` messages with
    `customerEmailedAt = NULL`, `deletedAt = NULL`, `isInternal = false`, and
    `OR: [{ sentVia: null }, { sentVia: { not: 'EMAIL' } }]` (the OR form is required — Prisma's
    bare `{ not: 'EMAIL' }` on a nullable enum compiles to `<> 'EMAIL'`, which excludes `NULL`
    rows under SQL three-valued logic and would silently skip every portal message).
  - `renderQuotedHistory(messages)` — `On <date>, <author> wrote:` + `> `-quoted body, attributing
    to `authorUser`/`authorAgent`/`authorBotName` (bot suffixed `(bot)`).
  - `markMessagesEmailed(messageIds)` — idempotent `updateMany` setting `customerEmailedAt = now()`.
  - `sendTicketConfirmation` and `sendAgentReply` now return `{ messageId, quotedMessageIds }`
    (was a bare string). Confirmation appends the delta under `Your message:`; agent reply
    excludes its own triggering message and appends the delta under `--- Previous messages:`.
- **Watermark wiring:**
  - `ThreadIngestionService` sets `customerEmailedAt: msg.sentAt` when creating a `Message` from
    an inbound email — that message *is* the email the customer received, never re-quote it.
  - `SendConfirmationWorker` calls `markMessagesEmailed(quotedMessageIds)` after sending.
  - `SendReplyWorker` (non-portal-copy branch) and `BotService` (auto-reply path) call
    `markMessagesEmailed([messageId, ...quotedMessageIds])`.
- **Tests:**
  - New `tests/unit/api/email-delta-quote.spec.ts` (8 tests) — `loadUndeliveredHistory`
    where-clause/ordering/exclude behavior, `renderQuotedHistory` attribution, empty-delta
    handling, `markMessagesEmailed` idempotency.
  - Updated `tests/unit/api/email-thread-stamping.spec.ts` and `tests/unit/api/worker-guards.spec.ts`
    for the new `{ messageId, quotedMessageIds }` return shape.
  - New integration describe block "S11 — Delta-quoting" in `tests/integration/email-ticket-flow.spec.ts`
    (3 tests): confirmation quotes-then-marks the portal description; agent reply quotes prior
    undelivered customer messages once, not on a subsequent reply; an inbound email message is
    pre-marked and never quoted.
  - `pnpm exec vitest run --config tests/vitest.unit.config.ts` — 156/156 ✅. `pnpm --filter @tmr/api type-check` ✅.
  - Integration: `email-ticket-flow.spec.ts` + `email-poller.spec.ts` — 42/43 ✅ (R84 pre-existing
    failure, confirmed via `git stash` to fail identically on master — unrelated, out of scope).
- **Known edge case (documented, not fixed):** pre-existing rows all have `customerEmailedAt = NULL`
  at deploy. The first agent reply on an old portal ticket will quote the entire prior un-marked
  history once — accepted as a harmless one-time "thread so far" recap. No backfill performed.
- **Docs:** `docs/atlas/email.md` — new "Delta-quoting" section + sequence diagram, Data model
  touched (`customerEmailedAt`), Notable Decisions (3 rows), Known gaps (text-only quoting,
  no backfill). Decisions table row above. `worldgraph/atlas.world.json` `feature:email` dossier
  updated. R219 added to `tests/regression-catalogue.md`. `pnpm atlas:gen` run.

---

### 2026-06-16 — Portal reply ack + remove agent-reply quoting

**Summary:** Replaced the self-addressed portal-reply mirror (`sendPortalReplyCopy`) with a direct
customer-facing ack (`sendPortalReplyAck`), and removed all quoted history from agent/bot reply
emails.

**Code changes:**
- `EmailService.sendPortalReplyAck(ticket, message, appConfig)` — new method. Sends "Received your
  response" email To the customer, Reply-To = support address, threaded into the conversation via
  `buildThreadHeaders` + `externalThreadId`. Returns the RFC Message-ID for dedup stamping.
- `EmailService.sendAgentReply` — removed `loadUndeliveredHistory` + `renderQuotedHistory` + the
  `--- Previous messages:` block. Body is now: reply text, "View full thread:" link, sign-off.
  Returns `quotedMessageIds: []` (shape preserved so worker compiles unchanged).
- `SendReplyWorker` (`kind === 'portal-copy'` branch) — calls `sendPortalReplyAck` instead of
  `sendPortalReplyCopy`. Log message updated to "portal ack".
- `MessagesService` comment updated from "Mirror customer portal REPLY into the support mailbox"
  to describe the ack.
**Tests:**
- `tests/unit/api/email-delta-quote.spec.ts` rewritten — tests now assert agent/bot reply emails
  contain **no** `--- Previous messages:` block; new `sendPortalReplyAck` describe block (5 tests:
  To=customer, Reply-To=support, greeting, name-null fallback, returns Message-ID string). All
  160 unit tests pass.
**Docs:**
- `docs/atlas/email.md` — "Portal reply mirror" section renamed to "Portal reply ack"; body
  updated; "Delta-quoting" section rewritten (confirmation-only quoting; agent replies no quoted
  block); Notable Decisions (G1 row, delta-quoting row) updated; Known gaps updated.
- `STATE.md` Decisions table row added.

---

### 2026-06-17 — Embedded Portal SSO (plan: in-this-app-for-composed-puppy)

Implemented a generic host-app → portal single-sign-on handoff using HMAC HS256 JWTs, replay-protection, and user upsert logic.

**Schema (`packages/db/prisma/schema.prisma` + migration `20260617000000_add_sso`):**
- `User.externalId String? @unique` — stable host user ID for upsert lookup
- `UserSource.SSO` — new enum value
- `AppConfig.ssoEnabled Boolean @default(false)` + `ssoSecretEnc String?`
- `SsoUsedToken` model — `jti` primary key + `expiresAt DateTime` (with index) for replay protection

**API (`apps/api/src/modules/auth/`):**
- `auth.dto.ts` — `ssoSchema` / `SsoDto` (Zod)
- `auth.service.ts` — `SsoTokenClaims` interface, `SSO_MAX_IAT_SKEW_S = 60`, private `verifyExternalJwt()` (header decode, alg check, `timingSafeEqual` HMAC verify, exp/iat/jti guards), public `ssoAuth()` (config load → decrypt secret → verify → replay-protect → upsert → issueToken)
- `auth.controller.ts` — `POST /auth/sso` with `@RateLimit(AUTH_RATE_LIMIT)`
- `auth.module.ts` — added `AppConfigModule` import so `AppConfigService` is injectable

**Config service (`apps/api/src/modules/config/config.service.ts`):**
- `UPDATABLE_FIELDS` now includes `ssoEnabled` + `ssoSecretEnc`
- `getSafe()` redacts `ssoSecretEnc`; exposes `ssoSecretSet: boolean` (mirrors `botKeySet` pattern)
- `update()` encrypts `ssoSecretEnc` via `credentials-cipher.ts` on write

**Portal (`apps/portal/src/app/auth/sso/page.tsx`):**
- New handoff page: reads `?token=&redirect=` from search params, POSTs to `/auth/sso`, calls `signIn(res.token, res.user)`, redirects to `redirect ?? '/tickets'`
- `handledRef` strict-mode guard (same pattern as Google callback)

**Bridge (`apps/bridge/src/app/settings/sso/page.tsx`):**
- Settings UI: `ssoEnabled` toggle, shared secret field (shows `ssoSecretSet`, supports set/replace/clear), read-only Node.js integration snippet with Copy button, security checklist callout
- Settings nav (`settings/layout.tsx`) — added "Embedded Portal" link to Integrations section

**Tests:**
- `tests/unit/api/sso-auth.spec.ts` — R221–R226 (Vitest, direct class instantiation, no DB/Docker)
- `tests/integration/sso-auth.spec.ts` — R227–R231 (Jest/Supertest + Testcontainers harness)

**Docs/registry:**
- `tests/regression-catalogue.md` — R221–R231 added
- `docs/atlas/auth.md` — SSO section added (sequence diagram, key files, security invariants, notable decisions, known gaps); Notable Decisions and Known Gaps updated
- `worldgraph/atlas.world.json` — `feature:auth` dossier + index updated; `entity:SsoUsedToken` node added; `route:POST /api/v1/auth/sso` node added


---

## Session — 2026-06-18 (Plan great-one-thing-these-hazy-seahorse: AI/analysis gating on isTicket)

**Problem fixed:** Sentiment analysis (`ai:analyze-message`) was being enqueued for every inbound customer email regardless of `isTicket`. Raw `NEW` conversations (pre-triage email threads) and `DISMISSED` ones were accumulating `sentimentScore`, `CustomerSignal`, priority bumps, and churn-risk notifications. The customer-intelligence dashboard also included those rows in its aggregates.

**Changes:**

1. **`ThreadIngestionService`** — Added `&& ticketIsTicket` to the `ai:analyze-message` enqueue guard (the live fix; the variable was already in scope).
2. **`MessagesService`** — Added `&& ticket.isTicket` to the customer-reply sentiment enqueue guard (portal path; `ticket` already loaded).
3. **`TicketsService.update()`** — Added `&& ticket.isTicket` defensive guard before enqueueing classify + CSAT on RESOLVED (a non-ticket can't reach RESOLVED via normal UI, but now explicitly guarded).
4. **`TicketsService.convert()`** — After `activateTicket()`, retroactively enqueues `ai:analyze-message` for all prior unanalyzed customer messages (`analyzedAt = null`). Idempotent; already-analyzed messages skipped.
5. **`AnalyzeMessageWorker`** — Added `isTicket` to the ticket select and early-return if `!message.ticket?.isTicket`.
6. **`ClassifyTicketWorker`** — Added `!ticket.isTicket` to the early-return guard.
7. **`CustomersService`** — All 20+ queries (sentiment aggregates, CSAT aggregates, topic queries, signal counts, health-score user lookup, effort aggregates, category mix, conversation depth, sentiment label breakdown, topic trend, per-topic WoW delta, friction by field2) scoped to `isTicket=true`. Raw SQL queries add `AND "isTicket" = true`; Prisma ORM queries add `isTicket: true` or `ticket: { isTicket: true }`.

**Tests added:** `tests/integration/ai-gating.spec.ts` — R110–R114 (spy-based, no real Gemini calls).

**Docs updated:** `docs/atlas/ai.md` (isTicket gating rule section), `docs/atlas/analytics.md` (customer insights isTicket scoping note), `tests/regression-catalogue.md` (R232–R236), `STATE.md` (this entry + Decisions table row).

**No schema changes** — no new migration, no atlas:gen run required.

---

## Session — 2026-06-19 (Plan in-this-app-we-glistening-nova: Ticket Tags + Canned Responses)

**Two agent-facing productivity features built from existing schema scaffolding.**

### Part A — Tags

**Problem:** The `Tag` model, `Ticket.tags` relation, and `tagIds` update path were all in the schema but had no API, no settings page, no picker UI, and a DB drift that would have caused every insert to fail (`orgId NOT NULL` column in DB vs. single-tenant `schema.prisma` without orgId).

**Changes:**

1. **Migration `20260619000000_tag_drop_orgid`** — Drops `orgId` column + `(orgId,name)` unique index; creates `Tag_name_key`. Resolves the init-migration drift.
2. **`apps/api/src/modules/tags/`** — New module: `tags.dto.ts` (fixed palette enum `TAG_PALETTE`, create/update schemas), `tags.service.ts` (list with `_count.tickets`, create/update with P2002→409, delete with cascade), `tags.controller.ts` (GET/POST/PATCH/DELETE, `AgentGuard`), `tags.module.ts`; registered in `app.module.ts`.
3. **`tickets.dto.ts`** — Added `tagIds` to `listTicketsSchema` (coerces single string to array).
4. **`tickets.service.ts`** — (a) `list()`: adds `tagIds` filter `where.tags = { some: { id: { in: tagIds } } }`; conditionally includes `tags: true` only for agent callers. (b) `update()`: pre-fetch now includes `tags: { select: { id: true } }`; after update, if tagIds changed, creates internal `SYSTEM_EVENT` `tags_changed`. (c) `findById()`: strips `tags` from response for portal callers.
5. **Bridge settings nav** — Added "Tags" and "Canned Responses" to Workspace section.
6. **`apps/bridge/src/app/settings/tags/page.tsx`** — Settings page: list with swatch + name + "N tickets", create/edit with palette swatch row, delete with confirm showing ticket count.
7. **`apps/bridge/src/app/tickets/[id]/page.tsx`** — `Tag` type + `tags: Tag[]` on `TicketDetail`; `TagPicker` popover (loads `/tags` on open, toggles with PATCH, renders badge pills); `updateTags` handler refetches ticket after change; tag badges in thread header; `tags_changed` renders as "Tags updated" in `MessageCard.tsx`.
8. **`apps/bridge/src/app/inbox/page.tsx`** — `Tag` type + `tags?: Tag[]` on `TicketListItem`; tag filter `<select>` loaded from `/tags`; tag badges rendered in conversation rows; `tagFilter` state wired into API params.
9. **Portal cleanup** — Removed unused `tags: { id, name, color }[]` field from `TicketListItem` in `apps/portal/src/app/tickets/page.tsx`.
10. **`MessageCard.tsx`** — Added `if (body === 'tags_changed') return 'Tags updated'` to `parseEvent()`.

### Part B — Canned Responses

**Problem:** The `CannedResponse` model (`id, name, body`) was in the schema but referenced nowhere.

**Changes:**

1. **`apps/api/src/modules/canned-responses/`** — New module: `canned-responses.dto.ts` (create/update schemas), `canned-responses.service.ts` (straight CRUD ordered by name), `canned-responses.controller.ts` (GET/POST/PATCH/DELETE, `AgentGuard`), `canned-responses.module.ts`; registered in `app.module.ts`.
2. **`apps/bridge/src/app/settings/canned-responses/page.tsx`** — Settings page with inline `RichEditor` component (toolbar + `contentEditable`, replicating composer pattern); list shows `/name` slug + truncated body preview; create/edit/delete.
3. **Slash-command insertion** — In `apps/bridge/src/app/tickets/[id]/page.tsx`: canned responses loaded once when composer opens; `handleEditorInput` detects `/query` backwards from caret (start-of-line or after whitespace); `filteredCanned` computed from query; fixed picker popover (positioned via `getBoundingClientRect`) with arrow-key/Enter/Tab/Escape navigation; `insertCannedResponse` deletes the `/query` text then `execCommand('insertHTML')` the template body. Works for reply and note tabs.

### Tests + docs

- `tests/integration/tags.spec.ts` — R110–R116 (tags CRUD, duplicate-name 409, delete-in-use cascades, tagIds filter, Portal exclusion, tags_changed event, same-tags no-op).
- `tests/integration/canned-responses.spec.ts` — R117–R118 (CRUD, portal 403).
- `tests/regression-catalogue.md` — R237–R240 added.
- `docs/atlas/tickets.md` — Tags section added; `tagIds` filter documented.
- `docs/atlas/canned-responses.md` — New atlas page.
- `worldgraph/atlas.world.json` — `module:TagsModule`, `module:CannedResponsesModule`, `entity:Tag`, `entity:CannedResponse` nodes added; `pnpm worldgraph:check` passes (109 nodes).
- `pnpm atlas:gen` run — 27 modules, 95 routes, 23 models confirmed.
- `pnpm type-check` (api, bridge, portal) — all pass with no errors.

---

## Session — 2026-06-20 (Plan okay-i-made-a-sprightly-kazoo: Grouped Inbox Redesign — Premium Light + Dark)

**Pure visual redesign of the Bridge agent dashboard. No data wiring, API calls, schema, or logic changes.**

### What changed

**`apps/bridge/src/globals.css`**
- `--d-*` token palette tuned to spec (bg, surface, raised-2, border, text, text-2/3/4).
- Accent switched blue → orange `#FF6700` (`--d-accent`, `--d-accent-hv`, `--d-accent-bg`) in both dark `:root` and light override.
- Four new tokens added to both themes: `--d-headline` (group header divider), `--d-unread` (unread row tint), `--d-chip` (ticket-id mono chip bg), `--d-rail` (nav rail surface).
- Status pill restyle: alpha-tint approach (color + `rgba(…, 0.13)` bg) works in both themes — all light-theme pill overrides collapsed/removed.
- New `.d-closed` pill class (`#7E8590`); `.d-urgent` updated to danger red.
- `.tnum` helper class (`font-variant-numeric: tabular-nums`).
- `[data-inbox-row]:focus-visible` outline rule.

**`apps/bridge/src/components/dashboard/TicketPreviewPanel.tsx`**
- `CAT_COLOR`: spec-aligned hex values for all five categories.
- `STATUS_CLS`: `CLOSED`/`DISMISSED` now map to `'d-closed'` (was `'d-res'`).
- `CategoryPill`: refactored from filled chip (icon + label) to colored dot + label. `CAT_ICON` export retained.

**`apps/bridge/src/app/tickets/[id]/page.tsx`**
- Local `STATUS_CLS` updated to match: `CLOSED`/`DISMISSED` → `'d-closed'`.

**`apps/bridge/src/app/inbox/page.tsx`**
- `ChevronRight` removed from import (no longer used).
- Header: title 22px / `-0.022em` tracking; `.tnum` on total count.
- `DomainFavicon`: `borderRadius: '50%'` → `10` (square-ish tile).
- Group card: `borderRadius: 12 → 14`.
- Group header banner: `background: var(--d-raised-2)`, padding `15px 18px`, `--d-headline` bottom divider when expanded. Chevron moved to **left** (rotates `0°` expanded / `-90°` collapsed, `transform 150ms cubic-bezier(.2,0,0,1)`). Right side: "N new" orange accent pill + timestamp. Domain name 16px / 600 / `-0.014em`.
- Conversation rows: 4-column CSS grid `14px 38px 1fr auto`, `columnGap: 13`, `padding: 13px 18px`. Gutter col = accent dot when unread. Avatar 38px (was 28px). Line 1 = title (14px, 600 unread/500 read, `-0.008em`) + `CategoryPill` + tags. Line 2 = sender email · ticket# chip (`var(--d-chip)`, mono, `.tnum`) + `UserCategoryBadge`. Meta column stacked: timestamp top, status pill + assignee avatar bottom. Unread rows tinted `var(--d-unread)`; hover → `var(--d-raised-2)`. Keyboard accessible: `tabIndex=0`, `role=button`, `onKeyDown` Enter/Space, `data-inbox-row` attribute.
- Skeleton: `borderRadius: 14`.
- Footer: `.tnum` on "Showing X of Y".

**`apps/bridge/src/components/dashboard/Sidebar.tsx`**
- Rail `<div>` gets `background: var(--d-rail)` (dark in both themes).
- `RailBtn` active background: `rgba(59,130,246,0.14)` → `var(--d-accent-bg)`.
- Panel link active backgrounds: `rgba(59,130,246,0.1)` → `var(--d-accent-bg)`.

### Docs / tests
- No new endpoints, modules, models, or data flows — no atlas/worldgraph regen needed.
- No tests added (pure visual; existing `data-testid` attributes and test selectors preserved).
- `pnpm --filter @tmr/bridge type-check` — passes with no errors.

## Session — 2026-06-21 (Plan in-this-application-in-vivid-narwhal: CC support for agent replies)

### What changed

**CC on agent replies (sticky participants)**

Full end-to-end implementation of CC support across 8 layers.

**Schema (`packages/db/prisma/schema.prisma`)**
- Added `TicketParticipant` model with `[ticketId, email]` unique key, `source: ParticipantSource` (AGENT | INBOUND), and optional `addedByAgentId` FK.
- Added `cc String[] @default([])` to `Message`.
- Added `participants TicketParticipant[]` relation to `Ticket` and inverse `addedParticipants` on `Agent`.
- Migration file: `20260621000000_cc_participants/migration.sql` (additive, no data loss, no backfill).

**API — messages (`apps/api/src/modules/messages/`)**
- `messages.dto.ts`: added `cc` field (email array, max 20, lowercase+trim+dedup via zod).
- `messages.service.ts`: CC guard (agent-only, REPLY-only), customer-email drop, message.cc snapshot, and `TicketParticipant` reconcile inside the same transaction. Omitted `cc` → participants untouched (E13).

**API — email (`apps/api/src/modules/email/email.service.ts`)**
- `sendAgentReply`: passes `message.cc` as `cc:` to nodemailer. TO-only for confirmation/ack/escalation (D5).
- `makeCapturingTransport`: records `Cc` header and top-level `cc` on `CapturedMail`.
- `CapturedMail` + `tests/e2e/fixtures/mail.ts`: added optional `cc` field.

**API — inbound ingestion (`apps/api/src/modules/email-sync/thread-ingestion.service.ts`)**
- Added `resolveSenderUser()` private helper (P2002-safe upsert).
- Per-message attribution: each message's `from:` address resolves to its own User row (`authorUserId`).
- Auto-add INBOUND participants: non-agent, non-primary-customer senders are upserted into `TicketParticipant` with `source=INBOUND`.

**API — tickets (`apps/api/src/modules/tickets/tickets.service.ts`)**
- `TICKET_DETAIL_INCLUDE`: added `participants: { id, email, name, source }`.

**Bridge frontend**
- `Message`/`TicketDetail` interfaces: added `cc` and `participants`.
- `ccList` / `ccInput` state; sticky init from `ticket.participants` on ticket identity change.
- CC chip editor row in compose header (reply only); add on Enter/comma/blur, remove with ×.
- `sendMessage` sends `payload.cc = ccList` on replies; syncs `ccList` from `res.message.cc` after send.
- `MessageCard`: added `cc` prop; renders `cc: …` in REPLY header for agent messages with a CC list.

**Tests**
- Unit: `tests/unit/api/messages-dto-cc.spec.ts` (8 tests), `tests/unit/api/email-agent-reply-cc.spec.ts` (3 tests).
- Integration: `tests/integration/messages.spec.ts` extended with R126–R131 (CC persist, sticky, customer-drop, internal-note reject, user-role reject, cap at 20).
- Regression catalogue: R241–R247.

**Docs**
- `docs/atlas/email.md`: CC on agent replies, inbound attribution, TO-only policy.
- `docs/atlas/messages.md`: new CC section (data model, add/remove flow, validation, inbound auto-add).
- `docs/atlas/tickets.md`: `TicketParticipant` description and link.
- `docs/atlas/_generated/`: regenerated (`pnpm atlas:gen`).
- `worldgraph/atlas.world.json`: added `entity:TicketParticipant` node, updated `entity:Ticket` and `feature:messages` connects. Validates OK (110 nodes, 7 journeys).

### Key decisions

| Decision | Why |
|---|---|
| D1 — `TicketParticipant` relational table (not JSON array on Ticket) | Free dedup via `[ticketId, email]` unique key, idempotent inbound upsert, per-row audit (`source`, `addedByAgentId`) |
| D2 — `cc String[]` snapshot on `Message` | Immutable audit of what was on the wire; timeline renders `message.cc`; composer renders `ticket.participants` |
| D3 — Participant table = source of truth; DTO carries full edited list; worker reads snapshot | Deterministic send even if participants change between enqueue and delivery; queue payload unchanged |
| D4 — Validation split: zod (shape/format/cap/dedup) in DTO; context rules (agent-only, REPLY-only, drop customer) in service | Each layer validates what it can see |
| D5 — Confirmation / portal-ack / escalation stay TO-only | These flows must not blast an agent-curated CC list; preserves existing heavily-tested paths |

---

## Session — 2026-06-21 (TMR Product Metadata)

### What changed

**Prisma**
- Added `tmrUserId String?`, `tmrMetadata Json?`, `tmrMetadataStatus TmrSyncStatus @default(PENDING)`, `tmrMetadataAt DateTime?` to `User` model.
- Added `TmrSyncStatus` enum (`PENDING`, `OK`, `NOT_FOUND`, `ERROR`).
- Migration: `packages/db/prisma/migrations/20260621000001_add_tmr_metadata/`.

**New module: `apps/api/src/modules/tmr-data/`**
- `tmr-data.types.ts` — `TmrMetadata` / `TmrAccountSummary` / `TmrTeamSummary` types + exported `reduceTmrDetails()` pure function.
- `tmr-data.service.ts` — `TmrDataService.syncUser(userId)`: resolves email via fuzzy search, fetches details, reduces to compact summary, persists to DB. Fails silently (logs + sets ERROR).
- `fetch-tmr-metadata.worker.ts` — pg-boss worker for `FETCH_TMR_METADATA_QUEUE`.
- `tmr-data.module.ts` — exports `TmrDataService`; registered in `app.module.ts`.

**Queue**
- Added `FETCH_TMR_METADATA_QUEUE = 'tmr:fetch-metadata'` constant.
- Added `FetchTmrMetadataJobData { userId }` interface.
- Added `QueueService.enqueueFetchTmrMetadata()` (retryLimit: 3, retryDelay: 10).

**Enqueue hooks (fire-and-forget)**
- `tickets.service.ts`: after `activateTicket()` → `enqueueFetchTmrMetadata({ userId: caller.id }).catch(() => {})`.
- `thread-ingestion.service.ts`: after AI analysis enqueue → gated by `!isBackfill && wasCreated && !firstMsgIsBulk`.

**Users API**
- `GET /users/:id`: now includes `tmrMetadata`, `tmrMetadataStatus`, `tmrMetadataAt` in response.
- `POST /users/:id/tmr-metadata/refresh` → 202 Accepted + enqueues sync job (agent-auth protected).

**Bridge UI**
- New `TmrProductSection.tsx` component with `panel` (full CustomerProfilePanel section) and `compact` (ticket sidebar widget) variants. All 4 sync states handled: PENDING shimmer, OK data, NOT_FOUND empty state, ERROR retry state. Theme-safe (`var(--d-*)` tokens only).
- `CustomerProfilePanel.tsx`: extended to include TMR fields in ProfileData; added lazy-sync on first open (`PENDING` → POST refresh → poll after 3s); `TmrProductSection variant="panel"` inserted before Internal Notes.
- Ticket `[id]/page.tsx`: added `userTmr` state fetched from `GET /users/:id`; lazy sync on first open; `TmrProductSection variant="compact"` in right sidebar (hidden for NOT_FOUND); "view more details →" opens CustomerProfilePanel.

**Tests**
- Unit: `tests/unit/api/tmr-data-reduce.spec.ts` (10 tests, R220–R222).
- Integration: `tests/integration/tmr-data.spec.ts` (R223–R232).
- Regression catalogue: R248 (bulk/backfill must never trigger tmr_data_service call).

**Docs**
- `docs/atlas/tmr-data.md`: new feature page.
- `docs/atlas/_generated/`: regenerated (`pnpm atlas:gen`).
- `worldgraph/atlas.world.json`: added `module:TmrDataModule` + `feature:tmr-data` nodes. Validates OK (112 nodes, 7 journeys).
- `.env.example`: added `TMR_DATA_SERVICE_BASE_URL/API_KEY/API_KEY_HEADER`.

### Key decisions

| Decision | Why |
|---|---|
| D1 — Cache on `User` row (not a new table) | Mirrors existing `category`/`emailStatus` pattern; no join needed when fetching profile |
| D2 — `TmrSyncStatus` enum on `User` | Stateless single-field sync lifecycle; clear distinction between never-tried (PENDING), missing (NOT_FOUND), and broken (ERROR) |
| D3 — Auth via env vars (base URL + key header) | No AppConfig dependency; safe to leave blank (PENDING no-op); operator-configurable header name |
| D4 — Backfill excluded, lazy sync on first open | Avoids bombarding the external service during backfill; PENDING users sync naturally when an agent opens their profile |
| D5 — Bulk/promotional senders excluded | TMR product users are never bulk senders; avoids pointless calls on newsletters |
| D6 — Silent failure everywhere | External service outages must never abort ticket creation or email ingestion |

---

## Session Log — 2026-06-21 (plan: i-have-completed-51-vectorized-dolphin)

**Pre-deployment QA fix sprint — 12 issues from manual regression QA**

### What changed

**A — Knowledge Base**
- A1: Fixed `KnowledgeChunk.id` UUID cast bug in `indexer.service.ts`: changed `::uuid` → `::text` in the batched `UPDATE … FROM (VALUES …)` SQL — IDs are cuid() text, not uuid type.
- A2: KB scan now sets `kbPhase = 'FAILED'` (with a user-readable error) when scan returns 0 chunks, instead of advancing to `AWAITING_CONFIRM` on an unreachable URL. Applied in both `crawl-and-index.worker.ts` (background scan) and `knowledge-base.controller.ts` (manual re-scan).

**B — Agent invite accept flow (end-to-end)**
- B1: `agents.service.ts` — `invite()` now fires `emailService.sendAgentInvite()` after upsert; `AgentsModule` imports `EmailModule` + `AppConfigModule`.
- B2: `auth.service.ts` — new `acceptAgentInvite()` method; `auth.dto.ts` — `acceptInviteSchema` (Zod, token + password ≥8 with number + special char); `auth.controller.ts` — `POST /auth/agent/accept-invite` endpoint.
- B3: New page `apps/bridge/src/app/auth/accept-invite/page.tsx` — reads `?token=`, shows live password requirements checklist, POSTs accept-invite, signs in on success, redirects to `/inbox`.

**C — Settings fixes**
- C1: Portal submit page (`apps/portal/src/app/submit/page.tsx`) now renders `appConfig.portalTagline` under the hero heading.
- C2: Timezone input in `ShiftsSection.tsx` now has debounced auto-save (500ms) with "Saving…"/"Saved ✓" feedback states.

**D — Email archive progress bar fix**
- Fixed `useBackfillStatus.ts`: added `pollRef` + `mountedRef`; `refresh()` now resumes the self-scheduling poll loop (was calling a dead one-shot closure); SSE handler seeds state from `null` to unblock subsequent polls.

**E — Canned responses form**
- E1: `RichEditor` receives stable `initialHtml` prop (not live `body` state) to prevent re-mount on every keystroke.
- E2: Link dialog moved inside `RichEditor`; uses `PromptDialog`; captures/restores selection via `savedRangeRef`.
- E3: Save button disabled when name or body is empty.
- E4: Toggle button shows correct icon (Plus/X) matching open/closed state.

**F — Reusable modal components**
- New `apps/bridge/src/components/ui/Dialog.tsx` — `ConfirmDialog` (with danger variant) and `PromptDialog`.
- Updated `settings/tags/page.tsx` to use `ConfirmDialog` instead of `window.confirm`.

**G — Portal signup validation**
- G1: Create account button disabled until form is valid (was always enabled until submit).
- G2: Confirm-password error shown live as user types the password field (not just on confirm-password touch).

**H — Verify-email cross-tab sync**
- `apps/portal/src/lib/auth.tsx` — `window.storage` event listener calls `rehydrate()` when `tmr_portal_token` or `tmr_portal_user` changes in another tab, so the verify-email page auto-advances when the user verifies in a different tab.

### Tests
- Integration tests added for B (R196/R197/R198) in `tests/integration/auth.spec.ts`.
- Regression catalogue: R250 (KB uuid cast), R251 (KB 0-pages FAILED), R252 (accept-invite endpoint).

### Docs
- `docs/atlas/auth.md`: added accept-invite node to diagram + "Agent invite accept flow" section.
- `docs/atlas/_generated/`: regenerated (`pnpm atlas:gen`, 97 routes).
- `worldgraph/atlas.world.json`: updated Auth node (accept-invite page, keyFiles, summary) + KB node (A2 FAILED behavior). Validates OK (112 nodes, 7 journeys).

### Key decisions

| Decision | Why |
|---|---|
| D1 — `::text` cast for KnowledgeChunk.id | cuid() IDs are text, not uuid; Postgres rejects `::uuid` cast on cuid strings |
| D2 — accept-invite page in Bridge `/auth/` route group | Outside `(dashboard)` layout so unauthenticated agents can reach it without redirect |
| D3 — Link dialog inside RichEditor (not CannedForm) | RichEditor owns the contentEditable ref; moving the dialog in eliminates the "ref not connected" bug |
| D4 — `pollRef` pattern in useBackfillStatus | setTimeout-based self-scheduling loops capture stale closures; ref allows refresh() to call the live poll |

## Session — 2026-06-22 (Cloud logging — winston + GCP Cloud Logging)

Added GCP Cloud Logging to `apps/api`, mirroring `tmr_data_service/src/configs/logger.ts`. Replaced the hand-rolled `FileLogger` (`apps/api/src/common/logger/file-logger.ts`, deleted) with a winston-backed `WinstonLogger`.

### What changed
- **Deps** (`apps/api/package.json`): `winston ^3.19`, `@google-cloud/logging-winston ^6.0`, `winston-daily-rotate-file ^5.0`.
- **`apps/api/src/common/logger/logger.service.ts`** (new) — `WinstonLogger implements NestJS LoggerService`. Single shared winston logger with **two transports, no Console**:
  - `DailyRotateFile` → `apps/api/logs/app-%DATE%.log`, `7d` retention, custom format emitting exactly `{ts,level,context,msg}` (NestJS-style level labels, `info→LOG`) so the CLAUDE.md `tail -f | jq` debugging workflow is unchanged.
  - `LoggingWinston` (GCP) → keyFile creds, `maxEntrySize 250000`, gRPC keepalive, **non-fatal `defaultCallback`** (missing key file logs to stderr, app keeps running).
  - Keeps NestJS `ConsoleLogger` call signatures → all 36 `new Logger(ctx)` call sites unchanged.
- **`apps/api/src/common/logger/log-truncation.ts`** (new) — ported verbatim from the reference; `reduceLogInfoSize` shrinks oversized payloads under GCP's 256KB protobuf cap before send.
- **`main.ts`** — swapped `FileLogger` → `WinstonLogger`.
- **Env**: `.env.example` documents `CLOUD_PROVIDER`, `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_CREDENTIALS_PATH` (default `./cloudlogging.json`), `GOOGLE_CLOUD_SERVICE_CONTEXT`, `LOG_SERVICE_NAME`. `.gitignore` ignores `**/cloudlogging*.json`.

### Decisions taken (with the user)
- Winston-based, mirroring the reference (vs. bolting GCP onto the old FileLogger).
- **No console output** — only file + GCP (user request).
- keyFile-path credentials (vs. inline env vars).
- Always-on GCP, but degrade gracefully on missing creds (non-fatal write errors).
- Ported the 256KB truncation guard.

### Verified
- `pnpm --filter @tmr/api type-check` clean.
- Runtime smoke (tsx): file lines parse with `jq` (`{ts,level,context,msg}`), error appends stack, and a missing key file produces a stderr `[LOG] GCP write error` without crashing.
- Unit test `tests/unit/api/logger-file-format.spec.ts` (R253) — 3 tests green.

### Tests / docs
- Regression catalogue: R253 (logger file-line parse contract).
- `docs/atlas/architecture.md`: added a Logging & Observability section.
- Note: repo `pnpm lint` is broken at the environment level (ESLint 6.4.0 finds no config) — pre-existing, unrelated to this change.
