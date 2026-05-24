# STATE.md — TMR Support Platform

Living document. Updated every session. Reflects current reality, not the original spec.
Last updated: 2026-05-24

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
# 1. Start infra (if not running)
cd docker && docker compose up postgres minio -d

# 2. API
pnpm --filter @tmr/api dev

# 3. Portal
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm --filter @tmr/portal dev

# 4. Dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm --filter @tmr/dashboard dev
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
| **pg-boss queue** for inbound emails (replaces BullMQ + Redis)          | `email.inbound` queue backed by Postgres (`pgboss` schema); 5x exponential retry; same `DATABASE_URL`; zero extra infra to deploy |
| **IMAP IDLE client** replaces smtp-server inbound listener              | `ImapClientService` reads from org's existing inbox via IMAP IDLE, no MX changes needed                                           |
| **VERP signed reply tokens** for threading                              | `reply+<emailThreadId>.<hmac8>@<domain>` — signed with AES-256-GCM key from `EMAIL_CREDS_KEY` env                                 |
| **IMAP/SMTP creds stored encrypted in AppConfig**                       | AES-256-GCM via `credentials-cipher.ts`; never returned plain on GET; password-set boolean returned instead                        |
| **`TransformResponseInterceptor` always wraps** in `{ data: ... }`      | Previous passthrough logic caused double-unwrap bugs in list responses                                                             |
| **Ticket numbers use `@default(autoincrement())`**                      | Removed per-org sequence; single sequence since app is single-tenant                                                               |
| **`Tag.name` is `@unique`**                                             | No org scope means tags are global                                                                                                 |
| **Connector field is a dropdown** (not free text)                       | Better UX; maps to a fixed connector_map list                                                                                      |
| **Destination field** (was "product") trimmed to Hub/Sheets/Data Studio | Per product decision                                                                                                               |
| **GitHub webhook uses rawBody**                                         | NestJS `rawBody: true` enabled for HMAC-SHA256 signature verification                                                              |
| **Notifications are global** (all agents see all)                       | No per-agent scoping; assignment is for tracking only, not access control                                                          |
| **`fix-deployed` / `pending-customer-confirmation` label names**        | Configurable via Settings → GitHub → Label Configuration                                                                           |
| **`NEXT_PUBLIC_*` vars loaded via dotenv in next.config.ts**            | Next.js only reads `.env` from its own project dir; monorepo root `.env` loaded explicitly via dotenv in both apps                 |
| **Light/dark theme via `data-theme` attribute on `<html>`**             | CSS variables override on `html[data-theme="light"]`; dark is default and completely unaffected; preference stored in localStorage |
| **GitHub OAuth callback at `/settings/github/callback`**                | Must be registered as Authorization callback URL in GitHub OAuth App settings                                                      |
| **Gemini 2.0 Flash for all AI operations**                              | Cheap ($0.075/$0.30 per 1M tokens) + fast for classification; no guardrails in Phase 1 — observe-only; see `docs/atlas/ai.md`     |
| **AI analytics observe-only (no budget caps)**                          | Per user decision: visibility first, controls later once real spend numbers are known                                               |
| **`firstResolvedAt` is immutable — set once, never overwritten**        | Preserves original resolution time even if ticket is reopened and resolved again                                                    |
| **`/analytics` → redirect to `/analytics/operations`**                  | Preserves existing bookmarks/links while adding the new `/analytics/customers` sub-route                                           |

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
| Google OAuth not wired (portal + dashboard) | Low                | Needs Google Cloud project + App credentials                           |
| Inbound email needs real MX record          | Medium             | Works locally if you point MX to your server                           |
| No real-time updates (polling/websockets)   | Medium             | Notifications poll every 30s; no instant push                          |
| Markdown toolbar is cosmetic                | Low                | Buttons render but don't insert markdown at cursor                     |
| File attach in reply not implemented        | Low                | Portal ticket reply composer                                           |
| Export as CSV (portal)                      | Low                | Button renders; no handler                                             |
| `EMAIL_CREDS_KEY` env var must be set       | Medium             | 64-char hex key required for IMAP/SMTP password encryption; app starts without it but IMAP won't connect |
| `orgs` module still exists on disk          | Cleanup            | Gutted stub; never imported — safe to delete                           |
| Auth token stored in localStorage           | Medium             | Acceptable for internal tool; consider httpOnly cookies for production |
| GitHub Issues analytics dashboard           | Deferred — Phase 2 | Charts: issue volume by destination/connector, resolution time trends  |

---

## Session Log

### 2026-05-17 — Sessions 1–4

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
