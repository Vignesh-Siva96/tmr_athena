---
title: Analytics
stack: [NestJS, Prisma `groupBy`, $queryRaw, Recharts, Gemini 2.0 Flash, framer-motion]
status: working
last-reviewed: 2026-06-14 (ops rework — real-ticket scoping, FRT, triage, bot deflection, SLA)
---


# Analytics

## What it does

Two analytics dashboards in Bridge:

- **`/analytics/operations`** — Support-ops view: queue volume, resolution rates, agent performance, connector breakdowns. Existed since Session 8.
- **`/analytics/customers`** — Customer intelligence view: sentiment, topic clusters, CSAT (user + AI inferred), health scores, and product friction. Added in this session.

`/analytics` redirects to `/analytics/operations` (Next.js server redirect).

## Stack

| Layer | What | Notes |
|---|---|---|
| Backend (ops) | `AnalyticsModule` → `GET /analytics` | Returns all ops metrics in one shot |
| Backend (customers) | `AnalyticsModule` → `GET /analytics/customers` | Returns all customer intelligence in one shot |
| Daily series | `$queryRaw` with `DATE_TRUNC('day', ...)` | Gap-filled in JS so missing days render as 0 |
| Breakdowns | Prisma `groupBy` | Status, category, priority, connector, topic |
| AI data | Gemini 2.0 Flash (async via pg-boss) | Sentiment on messages, topic clustering on tickets, CSAT inference |
| Charts | `recharts@3` | Line, donut, horizontal bars, grouped bars, scatter; multi-line topic trend |
| Tooltips | `ChartTooltip` component using `var(--d-*)` | Auto theme support (light/dark) |
| Info tooltips | `InfoTooltip` component (`<Info size={13}>` + hover div) | Hover description on every chart title |

## Key files

| File | Role |
|---|---|
| [`apps/api/src/modules/analytics/analytics.controller.ts`](../../apps/api/src/modules/analytics/analytics.controller.ts) | `GET /analytics` — ops metrics |
| [`apps/api/src/modules/analytics/analytics.service.ts`](../../apps/api/src/modules/analytics/analytics.service.ts) | Parallel queries for ops dashboard |
| [`apps/api/src/modules/analytics/customers.controller.ts`](../../apps/api/src/modules/analytics/customers.controller.ts) | `GET /analytics/customers` — customer intelligence |
| [`apps/api/src/modules/analytics/customers.service.ts`](../../apps/api/src/modules/analytics/customers.service.ts) | Parallel queries for customer insights (sentiment, topics, CSAT, health scores) |
| [`apps/api/src/modules/analytics/rating.controller.ts`](../../apps/api/src/modules/analytics/rating.controller.ts) | `GET/POST /rate/:token` — public CSAT submission (no auth) |
| [`apps/bridge/src/app/analytics/operations/page.tsx`](../../apps/bridge/src/app/analytics/operations/page.tsx) | Operations dashboard page |
| [`apps/bridge/src/app/analytics/customers/page.tsx`](../../apps/bridge/src/app/analytics/customers/page.tsx) | Customer insights page |
| [`apps/bridge/src/app/analytics/page.tsx`](../../apps/bridge/src/app/analytics/page.tsx) | Redirect → `/analytics/operations` |

## Operations page

All operational metrics count **real tickets only** (`isTicket = true`). Conversations (`isTicket=false`, `status=NEW`) and dismissed rows are always excluded.

### Metric definitions

**Responsiveness KPI row** (5 cards):
- **Open backlog** — real tickets in OPEN/IN_PROGRESS/WAITING; sub-label shows unassigned count.
- **Agent FRT P50** (first-response time) — median time from clock-start to first human-agent `REPLY` message. Clock start: if a `BotInteraction` with `didAnswer=false` exists, use escalation time; else use `ticket.createdAt`. P90 shown as sub-label.
- **Resolution time P50** — median `firstResolvedAt − createdAt` for resolved real tickets (last 30d). P90 as sub.
- **Resolution rate** — % of real tickets in RESOLVED/CLOSED.
- **SLA compliance %** — share of real tickets where FRT ≤ `AppConfig.slaFirstResponseHours` (default 4h).

**Triage & Automation row** (3–4 cards):
- **Triage backlog** — count of `{isTicket:false, status:NEW}` + oldest age.
- **Time to triage P50** — median `convertedAt − createdAt` for real tickets converted in last 30d.
- **Bot deflection** — `didAnswer=true / total BotInteractions` (last 30d). Hidden when bot is disabled.
- **Reopen rate** — `reopenCount > 0` tickets ÷ resolved count.

**Charts:**
- **Created vs Resolved** (30d two-series area chart, replaces single-series volume)
- **Status breakdown** (pie)
- **By category**, **field1**, **field2** (horizontal bars, conditional on data)
- **Priority mix**
- **Agent performance** (stacked horizontal bar)

**Removed:** High-attention customers table, tickets-per-customer insight card.

### Schema additions (migration 20260614000001)

- `Ticket.convertedAt DateTime?` — set in `tickets.service.ts convert()` when `isTicket` flips to true.
- `AppConfig.slaFirstResponseHours Int @default(4)` — SLA target read by `AnalyticsService`.

### Premium UX

- Staggered fade+rise entrance via framer-motion (gates on `!loading`).
- Count-up on integer KPI values via `useMotionValue` (respects `prefers-reduced-motion`).
- Card hover: lift + border glow (120ms transition).
- Section labels ("Responsiveness", "Triage & Automation", "Volume & Mix", "Team").
- Every KPI card and chart card has an `info` prop → `InfoTooltip` (shared component at `apps/bridge/src/components/InfoTooltip.tsx`).

### Frontend components

| Component | File | Notes |
|---|---|---|
| `InfoTooltip` | `apps/bridge/src/components/InfoTooltip.tsx` | Shared; promoted from customers/page.tsx local |
| `KpiCard` | `operations/page.tsx` (local) | `info` prop, accent top-border, hover-lift |
| `Card` | `operations/page.tsx` (local) | `info` prop, hover-lift |
| `SectionLabel` | `operations/page.tsx` (local) | Uppercase section header |
| `CountUp` | `operations/page.tsx` (local) | framer-motion count-up |
| `InsightCard` | `operations/page.tsx` (local) | Mini insight card in team sidebar |

## Customer insights page (5 bands)

Every chart title has an `InfoTooltip` (hover `ⓘ` icon) with a one-sentence description of the metric.

1. **KPI strip (6 cards)** — avg sentiment (30d), CSAT user, CSAT AI, at-risk count, reopen rate, **churn signals (30d)**. Each `KpiCard` accepts an `info` prop rendered as an `InfoTooltip`.
2. **Voice of the customer**:
   - **Signals strip (3 cards)**: 🔴 Churn risk count · 🟢 Advocacy count · ⚡ Avg effort score. Churn + advocacy cards are clickable → inline drawer. Effort card shows avg score + NPS-style stacked bar (Low 1–2 / Med 3 / High 4–5 proportions, green/yellow/red).
   - **Sentiment trend (`SentimentChart`)** — Chatbase-style two-panel layout (`grid 1fr 200px`):
     - Left: Recharts `LineChart` (30d daily avg sentiment score, `dot` enabled for isolated points, `interval="preserveStartEnd"` to always show first + last dates)
     - Right panel: avg score display + horizontal bar breakdown of Positive / Neutral / Negative with percentages (counts from `sentimentByLabel`, total from `totalAnalyzed`)
   - **Topic trend (`TopicTrendChart`)** — Chatbase-style two-panel layout:
     - Left: Recharts multi-line `LineChart` — one `<Line>` per top-8 topic (keyed by topic ID in the data array), colored via `TOPIC_COLORS` palette (`['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#A78BFA', '#06B6D4', '#F97316', '#EC4899']`)
     - Right panel: total ticket count + topic legend list (color dot + name + count per topic)
     - Data from `topicTrend` (30-day gap-filled daily counts keyed by topic ID) + `topicMeta` (id→name+color index map)
   - **Recent signals feed** — two-column: left = 10 most recent CHURN_RISK quotes; right = 10 most recent ADVOCACY quotes. Each row: quote, customer name + email, ticket link, timestamp.
   - **Effort × CSAT scatter** — per-ticket dots, X = AI effort (1-5), Y = AI CSAT (1-5). Lower-right quadrant = resolved but made customer work hard.
   - **Avg conversation depth by category** — bar chart (one bar per category, category color). Placed here because conversation depth is a customer effort signal, not a product-ops metric.
3. **Product experience** — friction by connector (bug reports), category mix stacked area (90d). Section header has a "More coming soon" chip. Reopen-rate-by-category chart removed (was low-signal for current data volume).
4. **Customer health**:
   - At-risk customers table — health score, sentiment, urgents, open, **churn signals (90d) badge**, last active
5. **Coming soon card** — dashed-border placeholder noting CSAT comparison, cohort retention, and revenue impact charts are planned. (Top advocates mini-table and repeat-contact histogram were removed as incomplete.)

### Frontend components

| Component | File | Notes |
|---|---|---|
| `InfoTooltip` | `apps/bridge/src/components/InfoTooltip.tsx` (shared) | Hover tooltip; `direction` prop (`'up'` default / `'down'`) controls whether tip renders above or below the icon. Imported by both operations and customers pages. |
| `ChartTitle` | `customers/page.tsx` (local) | `<h3>` + inline `InfoTooltip`; used as header for every chart section |
| `SentimentChart` | `customers/page.tsx` (local) | `LineChart` + right stats panel |
| `TopicTrendChart` | `customers/page.tsx` (local) | Multi-line `LineChart` + right legend panel |
| `ChartTooltip` | `customers/page.tsx` (local) | Unified tooltip component for all charts (replaces old `VoiceTooltip`/`BarTooltip`) |

### Health score formula

```
score = (avgSentiment × 40) − (urgentCount30d × 15) − (openCount × 10)
      − (reopens × 5) + (resolvedCount × 2) − (daysSinceLastActive / 7)
      − (churnSignalCount90d × 25) + (advocacySignalCount90d × 10)
```

Score < 0 → at-risk. Churn signals have the heaviest weight (−25 each) because they are explicit cancellation signals.

### Signals data model

`CustomerSignal` — one row per detected signal. Fields: `type (CHURN_RISK|ADVOCACY)`, `quote` (exact phrase), `reason` (AI rationale), linked to `Message`, `Ticket`, and `User`. Active churn workflow:
1. `analyze-message` worker detects churn → inserts `CustomerSignal(CHURN_RISK)` + creates `Notification(CHURN_RISK_DETECTED)` + bumps `Ticket.priority` NORMAL→HIGH + emits `SYSTEM_EVENT` message.
2. Advocacy signals are passive — insert only, no notification.

## Endpoints

See `AnalyticsController`, `CustomersController`, `RatingController` in [_generated/api-routes.md](_generated/api-routes.md).

## CSAT public endpoint

`GET /rate/:token` — returns ticket title + current state (no auth required).
`POST /rate/:token` — submits `{ rating: 1-5, comment? }`. Idempotent.

Token lives in `TicketRating.ratingToken` (UUID). Sent to the customer 30 min after ticket is resolved via the `ai:request-csat` pg-boss queue.

## Backend response fields (customers endpoint)

The `GET /analytics/customers` response includes these chart-specific fields:

| Field | Type | Description |
|---|---|---|
| `sentimentByLabel` | `{ label, count }[]` | Positive / Neutral / Negative counts for the 30d window |
| `totalAnalyzed` | `number` | Total messages with a sentiment label in 30d (sum of `sentimentByLabel`) |
| `topicTrend` | `({ date: string } & Record<topicId, number>)[]` | 30-day gap-filled daily counts keyed by topic ID; one entry per day |
| `topicMeta` | `{ id, name, colorIndex }[]` | Top-8 topic metadata for rendering the legend; `colorIndex` maps to `TOPIC_COLORS` |

`topicTrend` uses topic IDs (not names) as keys to avoid collisions from topic renaming or unicode names.

## Data freshness

All metrics are computed on the fly at query time — no materialized cache. The AI-derived fields (`sentimentScore`, `topicId`, `aiRating`) are populated asynchronously by background workers after the triggering event (new message / ticket resolved).

## Known gaps

- No date-range picker — ops page always last 30 days; customer page sentiment is 30d, category mix is 90d.
- No CSV export.
- No GitHub Issues analytics (Phase 2).
- Sentiment trend has gaps on days with no analyzed messages.
