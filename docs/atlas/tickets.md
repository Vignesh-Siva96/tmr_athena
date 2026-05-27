---
title: Tickets
stack: [NestJS, Prisma, Postgres, Zod]
status: working
last-reviewed: 2026-05-27
---

# Tickets

## What it does

The central object of the platform. A ticket represents one customer support conversation — created from the portal form, from an inbound email, or (occasionally) directly by an agent. It carries status, priority, category, optional assigned agent, and a thread of `Message` rows.

## Stack

| Layer | Library / service | Why |
|---|---|---|
| HTTP | NestJS controller + Zod validation | Same pattern as the rest of the API |
| Persistence | Prisma + Postgres | Single source of truth |
| Statuses | Enum in `schema.prisma` | `OPEN · IN_PROGRESS · WAITING · RESOLVED · CLOSED` |
| Soft-delete | `deletedAt` timestamp | Archive instead of hard-delete |
| Ticket number | `@default(autoincrement())` | Human-readable `TMR-1234` displayed in UI + email subjects |

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> OPEN: created
  OPEN --> IN_PROGRESS: agent first reply
  IN_PROGRESS --> WAITING: agent replied,<br/>awaiting customer
  WAITING --> IN_PROGRESS: customer replies
  IN_PROGRESS --> RESOLVED: agent marks resolved
  WAITING --> RESOLVED: agent marks resolved
  OPEN --> RESOLVED: direct resolve
  RESOLVED --> OPEN: customer reopens
  RESOLVED --> CLOSED: time / admin close
  CLOSED --> [*]: soft delete (deletedAt)
```

Auto-status transitions are wired in [`MessagesService.create`](../../apps/api/src/modules/messages/messages.service.ts) — see the messages atlas for the exact rules.

## Creation paths

```mermaid
flowchart TB
  Portal[Customer fills Submit form] --> CreateTicket
  EmailNew[New inbound email,<br/>no thread match] --> CreateTicket
  Agent[Agent creates manually] --> CreateTicket

  CreateTicket[TicketsService.create]
  CreateTicket --> DB[(Postgres)]
  CreateTicket --> Notify[Confirmation email]
  Notify -.->|EmailService| Customer
```

`TicketsService.create()` is the single funnel — invoked from the controller for portal submissions, from `InboundEmailProcessor` for fresh email conversations, and from any future channel.

## List + filter + search

The Inbox and All Tickets views use the same `GET /tickets` endpoint with query params:

- `status` — single value or comma-separated list
- `category` — same
- `assigneeId` — `me` resolves to caller; literal id otherwise
- `search` — case-insensitive against title, customer email/name, connector
- `limit` / `offset` — pagination (cursor-based not used; counts are small)
- `sortOrder` — `desc` / `asc` on `createdAt`

Stats endpoint (`GET /tickets/stats`) feeds the sidebar counts and the analytics page; computed via parallel Prisma `groupBy` + `count`.

## Key files

| File | Role |
|---|---|
| [`apps/api/src/modules/tickets/tickets.controller.ts`](../../apps/api/src/modules/tickets/tickets.controller.ts) | HTTP surface |
| [`apps/api/src/modules/tickets/tickets.service.ts`](../../apps/api/src/modules/tickets/tickets.service.ts) | Create / list / search / stats / status transitions / soft-delete |
| [`apps/api/src/modules/tickets/tickets.dto.ts`](../../apps/api/src/modules/tickets/tickets.dto.ts) | Zod schemas for create / update / list |
| [`apps/portal/src/app/submit/page.tsx`](../../apps/portal/src/app/submit/page.tsx) | Customer Submit form |
| [`apps/bridge/src/app/inbox/page.tsx`](../../apps/bridge/src/app/inbox/page.tsx) | Inbox (`/inbox`) — domain-grouped view; gated behind `EmailNotConfiguredGate`; header has search + status/category filters |
| [`apps/bridge/src/app/tickets/domain/[domain]/page.tsx`](../../apps/bridge/src/app/tickets/domain/[domain]/page.tsx) | Per-domain view — hero header with favicon + name, flat ticket list, status filter, "← Inbox" back button |
| [`apps/bridge/src/app/tickets/[id]/page.tsx`](../../apps/bridge/src/app/tickets/[id]/page.tsx) | Ticket detail — Gmail-thread layout; inline compose; AI Analysis in sidebar |
| [`apps/bridge/src/lib/useEmailConfig.ts`](../../apps/bridge/src/lib/useEmailConfig.ts) | Hook: `GET /config` → `{ isConnected, isLoading, refresh }` — module-level cache |
| [`apps/bridge/src/components/dashboard/EmailNotConfiguredGate.tsx`](../../apps/bridge/src/components/dashboard/EmailNotConfiguredGate.tsx) | Full-page gate; ADMIN sees Connect CTA → `/settings/email`; non-ADMIN sees "ask admin" state |
| [`apps/bridge/src/lib/groupTicketsByDomain.ts`](../../apps/bridge/src/lib/groupTicketsByDomain.ts) | Pure helper: groups tickets by `user.email` domain; sorts groups by `lastActivity` desc |
| [`apps/bridge/src/components/dashboard/MessageCard.tsx`](../../apps/bridge/src/components/dashboard/MessageCard.tsx) | Email-card renderer (Bridge only) — handles REPLY / INTERNAL_NOTE / SYSTEM_EVENT |

## Endpoints

See `TicketsController` in [_generated/api-routes.md](_generated/api-routes.md#ticketscontroller).

## Data model touched

`Ticket` (the row itself), `Message` (thread), `Attachment` (linked at create-time), `User` (customer), `Agent` (assignee), `Notification` (fix-deployed flag). See [_generated/erd.md](_generated/erd.md).

Key enums: `TicketStatus` · `TicketPriority` · `TicketCategory` · `TicketSource`.

## Bridge UI — Inbox page (`/inbox`)

The one and only list page. Previously there were two pages (`/inbox` flat list + `/tickets` domain-grouped); they are now merged. The `/inbox` route has the domain-grouped view. The old flat-list `/inbox` page is deleted. The header contains all navigation controls — the sidebar collapses to the 48 px icon rail when this section is active (no content panel).

Header layout (left → right):
- **Title**: "Inbox" + total count
- **Search** — 180 px input with debounce (300 ms), clears on Esc or × button; updates `?search=` URL param
- **Status filter** — dropdown; "All statuses" or any single `TicketStatus`
- **Category filter** — dropdown; "All categories" or any single `TicketCategory`
- **Clear** — appears only when any filter is active

All three filters compose — all active params are preserved when changing any one filter.

## Bridge UI — domain group cards (`/inbox`)

The Inbox page (`/inbox`) groups ticket rows by customer email domain using `buildDomainGroups()`. Key design details:

- **Default state: all collapsed.** Expand state (not collapse state) is tracked — empty Set = all collapsed. Persisted in `localStorage` under `bridge.tickets.expandedDomains`.
- **Two-zone group header**: clicking the left zone (favicon + domain name + counts) navigates to `/tickets/domain/[domain]`; the right chevron button expands/collapses the row list inline. `flexShrink: 0` on each card prevents flex-shrink distortion when multiple groups are open simultaneously.
- **Group header content**: Google favicon (`https://www.google.com/s2/favicons?domain=…&sz=32` with abbr fallback), domain name, ticket count chip, open count chip (blue, only if > 0), last-activity timestamp, styled chevron button (border + hover background).
## Bridge UI — per-domain page (`/tickets/domain/[domain]`)

Navigated to by clicking the left zone of any domain group card on `/inbox`.

- **Hero header**: 48 px `DomainFavicon`, 22 px/700 domain name, subtitle showing total ticket count + open count, "← Inbox" back button (navigates to `/inbox`), status filter dropdown.
- **Flat ticket list**: column headers (ID / Subject / Status / Agent / Last), 52 px rows, customer name + email sub-line.
- **Data**: `GET /tickets?limit=100&search=@{domain}` server-side pre-filter + client-side exact-domain match `email.split('@')[1] === domain` for precision.
- No preview panel — row click navigates directly to `/tickets/[id]`.

## Bridge UI — Gmail-thread conversation (`/tickets/[id]`)

The ticket detail thread was redesigned to match the Gmail thread feel.

### MessageCard layout

| Message type | Visual style | Notes |
|---|---|---|
| Customer / Agent REPLY | 36 px avatar outside card on the left; full-rounded card (`border-radius: 8`) with subtle box-shadow; no left color bar | Click header to collapse to a slim single-row (avatar + name + snippet + timestamp); click again to expand |
| INTERNAL_NOTE | Same avatar-left layout; amber border + `var(--d-note-bg)` background | Amber avatar bg (`#92400E`); "INTERNAL NOTE" badge in header |
| SYSTEM_EVENT | Centered pill — unchanged | Not collapsible |

**Quoted text collapsing**: `splitQuoted()` detects `On … wrote:` patterns, `>`-prefixed lines, and `--` signature delimiters. Quoted portion hidden behind a `···` expand button — identical to Gmail's three-dot quoted-text toggle.

**Collapse behavior**: each card manages its own `collapsed` state (`useState(false)`). Clicking the header collapses; clicking the slim collapsed row expands. System events are never collapsible.

### Reply / compose flow

- **Reply CTAs embedded in last message**: `isLast` prop passed to the last non-SYSTEM_EVENT `MessageCard`; renders "↩ Reply" and "🔒 Note" buttons as a footer row inside the card. Buttons are hidden while compose is open.
- **Inline compose card**: appears directly below the last message (inside the scroll area) — same avatar-left visual language as message cards. Header shows `↩ AgentName <support@…> to customer@…` for replies, amber lock icon for notes. "Switch to reply/note" link + × close in header. Autofocuses textarea on open. Esc closes; ⌘↵ / Ctrl↵ sends.
- **Send CTA**: formatting toolbar on left; "Send & Resolve" ghost button (appears only when textarea has content) + blue "Send" button (always visible, dimmed at 35% opacity when empty). No split-button chevron — cleaner than the old layout.
- **Format toolbar**: The compose area is a `contentEditable` div (not a `<textarea>`). Bold / Italic / Link / List buttons call `applyFormat()` via `document.execCommand` — formatting renders visually (WYSIWYG). ⌘B and ⌘I keyboard shortcuts work. `body` state holds `innerHTML`; sent to the API as HTML. Code button removed. Paperclip is disabled (file attach in compose is a known gap).
- The old persistent bottom composer bar is gone entirely.

### AI Analysis

Moved from the message thread to the **right sidebar**, between "Ticket" metadata and "GitHub". Shows CSAT and Effort score tiles side by side (full-width tiles in sidebar column), then the summary text below. Only rendered when ticket status is RESOLVED or CLOSED.

### TicketPreviewPanel removal

The `TicketPreviewPanel` quick-view slide-over was removed from all pages (Inbox, All Tickets, domain page, GitHub). The file (`apps/bridge/src/components/dashboard/TicketPreviewPanel.tsx`) was stripped down to utility exports only (`STATUS_CLS`, `STATUS_LABEL`, `CAT_LABEL`, `CAT_COLOR`, `PRIO_LABEL`, `CAT_ICON`, `CategoryPill`, `PriorityBadge`) — these are still imported by multiple pages. Ticket row clicks now navigate directly to `/tickets/[id]` on every page.

## Bridge UI — email gate

Both gated pages (`/inbox`, `/tickets/[id]`) render `<EmailNotConfiguredGate>` instead of their normal content when email is not configured. Gate condition: `oauthConnected === true` (OAuth is the only auth method). Sidebar (and therefore Settings) remains reachable. Gate clears immediately after OAuth connect because `useEmailConfig().refresh()` is called post-connect.

## Notable decisions

- **Single-tenant** — `orgId` was removed early. Ticket numbers use a single global sequence.
- **`Attachment.ticketId` is optional** — files are uploaded *before* the ticket exists, then linked at create-time. See [files.md](files.md).
- **Status transitions are inferred from messages**, not set explicitly by agents — see [messages.md](messages.md) for the rules. Agents *can* set status manually too via `PATCH /tickets/:id`.
- **Soft delete only** — archive sets `deletedAt`. The UI filters them out; admins could surface them.
- **Email-card format is Bridge-only** — Portal keeps chat bubbles. `MessageCard` lives in `apps/bridge/src/components/dashboard/` and is not in `packages/ui`.
- **Single Inbox at `/inbox`** — the old flat `/inbox` (bulk-select list) and the domain-grouped `/tickets` list were merged. `/inbox` is now the domain-grouped view; the old `/tickets` list page is deleted. `/tickets/[id]` and `/tickets/domain/[domain]` remain unchanged.
- **Expand state, not collapse state** — `expandedDomains` set (empty = all collapsed) avoids the "newly added domain is unexpectedly expanded" problem that the earlier `collapsedDomains` approach had.
- **Per-domain page is a full route, not a filter** — `/tickets/domain/[domain]` is a dedicated Next.js dynamic route rather than a query-param filter on `/inbox`. This allows browser history, direct linking, and a hero header without polluting the main inbox URL.
- **Inline compose, not a modal** — the reply compose area renders inside the scroll container below the last message, matching Gmail's inline reply UX rather than interrupting focus with a modal overlay.

- **Priority colors use CSS variables** — `PRIORITY_COLOR` / `PRIORITY_BG` in the ticket detail page use `var(--d-warning)` etc. rather than hardcoded dark-mode hex values. This ensures HIGH and URGENT remain readable in light theme. Hex-alpha suffix tricks (`${color}50`) can't be used with CSS vars; border is plain `var(--d-border)` and box-shadow glow uses the plain var (valid CSS).
- **Category always shown as `CategoryPill`** — ticket detail header and list rows use the same `CategoryPill` component (Lucide icon + colour-coded background). Plain text label is not used anywhere in the agent dashboard.
- **Resolve button hides when resolved** — when status is RESOLVED or CLOSED, the "Resolve ticket" action is replaced by a static "✓ Resolved" chip (no onClick, dimmed). Prevents double-resolve confusion.
- **Sidebar rail-only for tickets section** — when `activeSection === 'tickets'`, the sidebar collapses to the 48 px icon rail (content panel hidden, aside width `48px`). All filters live in the `/inbox` page header.

## Known gaps

- No SLA tracking / breach alerts (Phase 2).
- No tags surfaced in the UI beyond the existing `Tag` model.
- No customer-facing "ticket closed" notification — they just see status change in the portal.
