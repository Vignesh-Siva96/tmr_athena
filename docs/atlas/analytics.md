---
title: Analytics
stack: [NestJS, Prisma `groupBy`, $queryRaw, Recharts, Gemini 2.0 Flash]
status: working
last-reviewed: 2026-05-24 (chart redesign)
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

- **KPIs**: total tickets, open, resolved, resolution rate, avg resolution hours, new-this-week + WoW%, unassigned
- **Volume by day**: 30-day area chart
- **Donut**: status distribution
- **Horizontal bars**: category, top 10 connectors, priority
- **Top customers** (by ticket count, with "At risk" badge for ≥3 open tickets)
- **Agent performance** (assigned / resolved / open per agent)
- **Insights row**: tickets-per-customer avg, backlog pressure %, unassigned count

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
| `InfoTooltip` | `customers/page.tsx` (local) | Hover tooltip; `direction` prop (`'up'` default / `'down'`) controls whether tip renders above or below the icon. KPI cards and signals strip use `direction="down"` to avoid clipping into the sticky header. |
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
