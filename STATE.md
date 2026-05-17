# STATE.md — TMR Support Platform

Living document. Updated every session. Reflects current reality, not the original spec.
Last updated: 2026-05-17

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
cd docker && docker compose up postgres redis minio -d

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
| **No Bull/Redis queue** for emails                                      | Emails sent inline (fire-and-forget) — queue is a stub module only                                                                 |
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

---

## Feature Status

### Customer Portal (localhost:3000)

| Feature                      | Status             | Notes                                                               |
| ---------------------------- | ------------------ | ------------------------------------------------------------------- |
| Submit ticket (auth'd user)  | ✅ Working         | Category, destination, connector dropdown, description, attachments |
| Submit ticket (guest flow)   | ✅ Working         | Calls `/auth/guest` first, gets temp token                          |
| File upload on submit        | ✅ Working         | POSTs to `/files/upload`, links attachment IDs to ticket            |
| Confirmation email on submit | ✅ Working         | Requires SMTP credentials in `.env`                                 |
| Sign in (email/password)     | ✅ Working         |                                                                     |
| Sign up (email/password)     | ✅ Working         |                                                                     |
| Google OAuth                 | ❌ Not wired       | Button renders; needs real Google Cloud credentials + redirect URI  |
| Forgot password              | ❌ Not implemented | Magic link API exists but no UI flow                                |
| My Tickets list              | ✅ Working         | Filter tabs, search, correct counts per tab                         |
| Ticket detail (thread view)  | ✅ Working         | Messages, system events, GitHub issue display                       |
| Reply to ticket              | ✅ Working         | Saved to DB; no email notification to agents                        |
| Reopen resolved ticket       | ✅ Working         | PATCHes status to OPEN                                              |
| Markdown toolbar             | ❌ Cosmetic only   | Buttons render but don't insert markdown                            |
| File attach in reply         | ❌ Not implemented | Paperclip icon; no handler                                          |

### Agent Dashboard (localhost:3002)

| Feature                                   | Status       | Notes                                                                                                                          |
| ----------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Agent sign in                             | ✅ Working   |                                                                                                                                |
| Agent Google OAuth                        | ❌ Not wired | Same as portal; needs credentials                                                                                              |
| Inbox — ticket list                       | ✅ Working   | Loads all tickets with sort toggle                                                                                             |
| Inbox — search (sidebar)                  | ✅ Working   | 350ms debounce, global search (title + customer + connector)                                                                   |
| Inbox — multi-select checkboxes           | ✅ Working   | Bulk resolve + bulk assign to me                                                                                               |
| Inbox — quick preview panel               | ✅ Working   | Customer, last message, quick reply                                                                                            |
| Inbox — quick reply send                  | ✅ Working   |                                                                                                                                |
| Inbox — assign to me                      | ✅ Working   |                                                                                                                                |
| Inbox — resolve                           | ✅ Working   |                                                                                                                                |
| All Tickets list                          | ✅ Working   | Click-to-preview panel (same as Inbox); category icons; status filter; search                                                  |
| Ticket detail — thread                    | ✅ Working   | Customer/agent messages, internal notes, system events                                                                         |
| Ticket detail — reply                     | ✅ Working   | Saves to DB; triggers email to customer                                                                                        |
| Ticket detail — internal note             | ✅ Working   | Not sent to customer                                                                                                           |
| Ticket detail — status change             | ✅ Working   | Dropdown, creates system event in thread; full refetch after change                                                            |
| Ticket detail — priority change           | ✅ Working   | Custom color-coded pill dropdown (blue/orange/rose); optimistic update; click-outside to close                                 |
| Ticket detail — send & resolve            | ✅ Working   | Sends message (if body), then resolves                                                                                         |
| Ticket detail — archive (admin)           | ✅ Working   | Soft-delete; redirects to inbox                                                                                                |
| Ticket detail — GitHub issue panel        | ✅ Working   | Create new issue (uses default repo, shows it with change link) or link existing by URL/shorthand; unlink button; no-repo warning with settings link |
| Ticket detail — fix-deployed banner       | ✅ Working   | Amber banner appears when linked issue gets fix-deployed label                                                                 |
| Ticket detail — mark pending confirmation | ✅ Working   | Appears after agent sends reply; adds label via Octokit                                                                        |
| Customer profile slide-over               | ✅ Working   | Stats, ticket history, internal notes                                                                                          |
| Customer notes — add/edit/delete          | ✅ Working   | Own notes only                                                                                                                 |
| Sidebar — real counts                     | ✅ Working   | Fetches from `/tickets/stats`                                                                                                  |
| Sidebar — status/label filters            | ✅ Working   | Navigate to `/tickets?status=X`                                                                                                |
| Sidebar — two-layer rail                  | ✅ Working   | 48px icon rail + 172px panel; Tickets/GitHub/Analytics sections; live app name + logo from config                              |
| GitHub — Action Needed page               | ✅ Working   | `/github`; stats bar; split panel (notification list + full ticket context with quick reply)                                   |
| GitHub — notifications panel              | ✅ Working   | Slide-over ("Full view" button); fix-deployed pill uses CSS vars; read/unread by color only                                    |
| Settings — General                        | ✅ Working   | App icon (base64 upload) + app name for admins; theme toggle for all; live sidebar update via custom event                     |
| Settings — Branding                       | ✅ Working   | Color pickers, logo upload, save to API; brand color extraction from image (canvas) or website URL (backend proxy)             |
| Settings — Agents                         | ✅ Working   | List, invite, change role, activate/deactivate                                                                                 |
| Settings — GitHub — connection            | ✅ Working   | Full OAuth flow: redirect → GitHub → callback page → token exchange; disconnect                                                |
| Settings — GitHub — default repo          | ✅ Working   | Searchable dropdown fetches real repos from GitHub API; manual entry fallback; improved info panel with ✅/⚠️ rows            |
| Settings — GitHub — webhook setup         | ✅ Working   | Premium step-by-step UI; copy URL, generate/reveal/regenerate secret, verification status                                      |
| Settings — GitHub — label config          | ✅ Working   | Configurable fix-deployed + pending-customer-confirmation label names                                                          |

### GitHub Webhook Flow

| Feature                               | Status     | Notes                                                                 |
| ------------------------------------- | ---------- | --------------------------------------------------------------------- |
| Webhook endpoint                      | ✅ Working | `POST /api/v1/github/webhook`; HMAC-SHA256 signature verified         |
| `fix-deployed` label → notification   | ✅ Working | Creates `Notification` record linked to ticket                        |
| Notification delivery                 | ✅ Working | All agents see all notifications                                      |
| Webhook verification status           | ✅ Working | `webhookVerifiedAt` set on first successful delivery                  |
| `pending-customer-confirmation` label | ✅ Working | Added by agent via button; removes fix-deployed simultaneously        |
| GitHub webhook tunnel (dev)           | ⚠️ Manual  | Use ngrok or Cloudflare Tunnel; set tunnel URL as NEXT_PUBLIC_API_URL |

### Email

| Feature                       | Status     | Notes                                                       |
| ----------------------------- | ---------- | ----------------------------------------------------------- |
| Ticket confirmation email     | ✅ Working | Sent on ticket creation; requires SMTP creds                |
| Agent reply email to customer | ✅ Working | Sent when agent replies (non-internal); requires SMTP creds |
| Email threading (same thread) | ✅ Working | `Message-ID` + `In-Reply-To` + `References` headers set     |
| Inbound email → ticket reply  | ⚠️ Partial | Code works; needs real MX record pointing to port 2525      |
| Agent invite email            | ✅ Working | Sends invite link on agent invite                           |

### API

| Module        | Status      | Notes                                                             |
| ------------- | ----------- | ----------------------------------------------------------------- |
| Auth (user)   | ✅ Complete | signup, signin, google, guest, magic-link                         |
| Auth (agent)  | ✅ Complete | signin, google                                                    |
| Config        | ✅ Complete | GET (public), PATCH (admin), POST logo, GET extract-brand         |
| Tickets       | ✅ Complete | CRUD, stats, soft-delete, search                                  |
| Messages      | ✅ Complete | create, update (5-min window), auto status transitions            |
| Files         | ✅ Complete | MinIO upload, presigned URLs, link attachments                    |
| Agents        | ✅ Complete | list, invite, update role/status, delete                          |
| Users         | ✅ Complete | profile, stats, customer notes CRUD                               |
| GitHub        | ✅ Complete | connect, config, issues, link/unlink, list repos, webhook, label management, notifications |
| Notifications | ✅ Complete | list, unread count, mark read, mark all read                      |
| Email         | ✅ Complete | outbound send + inbound SMTP listener                             |
| Queue         | ⚠️ Stub     | Module exists; emails sent inline, not queued                     |
| Analytics     | ✅ Complete | GET /analytics — all metrics in one call, agent-only              |

---

## Key File Map

### API (`apps/api/src/`)

| What                                   | Where                                                   |
| -------------------------------------- | ------------------------------------------------------- |
| App bootstrap + rawBody enabled        | `main.ts`                                               |
| All module imports                     | `app.module.ts`                                         |
| JWT verify + user/agent inject         | `common/guards/auth.guard.ts`                           |
| Response envelope `{ data: ... }`      | `common/interceptors/transform-response.interceptor.ts` |
| Prisma client wrapper                  | `modules/database/prisma.service.ts`                    |
| App config (branding + webhook config) | `modules/config/config.service.ts`                      |
| Ticket list + search + stats           | `modules/tickets/tickets.service.ts`                    |
| Email send + inbound SMTP              | `modules/email/email.service.ts`                        |
| Webhook handling + label management    | `modules/github/github.service.ts`                      |
| Notifications CRUD                     | `modules/notifications/notifications.service.ts`        |

### Portal (`apps/portal/src/`)

| What                             | Where                                    |
| -------------------------------- | ---------------------------------------- |
| Auth context (localStorage JWT)  | `lib/auth.tsx`                           |
| API client (adds Bearer token)   | `lib/api.ts`                             |
| Brand config (fetches `/config`) | `lib/brand.tsx`                          |
| Submit ticket form               | `app/submit/page.tsx`                    |
| Connector dropdown with icons    | `components/portal/ConnectorSelect.tsx`  |
| Category card selector           | `components/portal/CategorySelector.tsx` |
| File dropzone + chips            | `components/portal/FileDropzone.tsx`     |
| My Tickets list                  | `app/tickets/page.tsx`                   |
| Single ticket thread             | `app/tickets/[id]/page.tsx`              |

### Bridge — Agent App (`apps/bridge/src/`)

| What                                      | Where                                           |
| ----------------------------------------- | ----------------------------------------------- |
| Auth context (localStorage JWT)           | `lib/auth.tsx`                                  |
| API client                                | `lib/api.ts`                                    |
| Persistent sidebar + GitHub icon + search | `components/dashboard/Sidebar.tsx`              |
| GitHub notifications slide-over panel     | `components/dashboard/NotificationsPanel.tsx`   |
| Inbox with preview panel                  | `app/inbox/page.tsx`                            |
| All tickets list                          | `app/tickets/page.tsx`                          |
| Agent ticket detail + fix-deployed banner | `app/tickets/[id]/page.tsx`                     |
| Customer profile slide-over               | `components/dashboard/CustomerProfilePanel.tsx` |
| Settings — premium GitHub setup           | `app/settings/github/page.tsx`                  |
| Settings — GitHub OAuth callback          | `app/settings/github/callback/page.tsx`         |
| Settings layout + live GitHub badge       | `app/settings/layout.tsx`                       |
| Theme context (dark/light, localStorage)  | `lib/theme.tsx`                                 |
| Light/dark CSS variables                  | `src/globals.css`                               |

### Shared

| What                            | Where                              |
| ------------------------------- | ---------------------------------- |
| Prisma schema (source of truth) | `packages/db/prisma/schema.prisma` |
| Seed script                     | `packages/db/src/seed.ts`          |
| Shared TS types + Zod schemas   | `packages/types/src/`              |
| Design tokens (CSS variables)   | `design/tokens.css`                |
| Docker Compose                  | `docker/docker-compose.yml`        |

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
| Queue module is a stub                      | Low                | Emails work inline; Bull/Redis not wired                               |
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
