# STATE.md — TMR Support Platform

Living document. Updated every session. Reflects current reality, not the original spec.
Last updated: 2026-05-27 (session 3)

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
| **Email-card format is Bridge-only; portal keeps chat bubbles**          | Portal is customer-facing — chat bubbles feel friendlier and match the portal's light-theme aesthetic. The new email-card format suits the agent tool. `MessageCard` is in `apps/bridge/` only, not `packages/ui`. |
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
| File attach in reply (bridge compose)       | Low                | Paperclip button present but disabled; no file upload flow in compose  |
| File attach in reply not implemented        | Low                | Portal ticket reply composer                                           |
| Export as CSV (portal)                      | Low                | Button renders; no handler                                             |
| `EMAIL_CREDS_KEY` env var must be set       | Medium             | 64-char hex key required for IMAP/SMTP password + OAuth token encryption; app starts without it but IMAP won't connect |
| OAuth env vars not yet set                  | Medium             | `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_CLIENT_ID/SECRET`, `OAUTH_CALLBACK_BASE`, `BRIDGE_URL` must be configured before OAuth login works |
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
