# TMR Data — Product Metadata Feature

**Status:** Active  
**Bridge-only:** UI renders exclusively in `apps/bridge`. Nothing touches `apps/portal`.

---

## What this feature does

Agents in bridge can see a compact summary of a customer's Two Minute Reports (TMR) product
state — which accounts/plans they hold, subscription status, and per-team usage counts (data
sources, queries, schedules). Data is fetched from an internal `tmr_data_service` back-office
API and cached on the `User` row so every bridge view is instant.

---

## Stack / key files

| Layer | File |
|---|---|
| Prisma schema | `packages/db/prisma/schema.prisma` — `User.tmrMetadata`, `TmrSyncStatus` enum |
| Service | `apps/api/src/modules/tmr-data/tmr-data.service.ts` — `syncUser()`, `reduce()` |
| Types | `apps/api/src/modules/tmr-data/tmr-data.types.ts` — `TmrMetadata`, `reduceTmrDetails()` |
| Worker | `apps/api/src/modules/tmr-data/fetch-tmr-metadata.worker.ts` |
| Module | `apps/api/src/modules/tmr-data/tmr-data.module.ts` |
| Queue | `apps/api/src/modules/queue/queue.module.ts` — `FETCH_TMR_METADATA_QUEUE` |
| Queue service | `apps/api/src/modules/queue/queue.service.ts` — `enqueueFetchTmrMetadata()` |
| Users API | `apps/api/src/modules/users/users.service.ts` / `users.controller.ts` |
| Bridge component | `apps/bridge/src/components/dashboard/TmrProductSection.tsx` |
| Customer panel | `apps/bridge/src/components/dashboard/CustomerProfilePanel.tsx` |
| Ticket page | `apps/bridge/src/app/(dashboard)/tickets/[id]/page.tsx` |

---

## Data flow

```
New portal ticket / new live email
        │
        ▼
tickets.service / thread-ingestion.service
  └─ queueService.enqueueFetchTmrMetadata({ userId }) (fire-and-forget)
        │
        ▼
pg-boss worker (FETCH_TMR_METADATA_QUEUE)
  └─ TmrDataService.syncUser(userId)
        │
        ├─ POST tmr_data_service/back-office/getUsersByFuzzySearch → exact email match
        ├─ POST tmr_data_service/back-office/getUserDetails → raw payload
        └─ reduceTmrDetails(data) → TmrMetadata
              └─ User.update({ tmrMetadata, tmrMetadataStatus: OK, tmrUserId })
```

**Manual refresh / lazy sync on first open:** Bridge POSTs `POST /users/:id/tmr-metadata/refresh`
which re-enqueues the worker. CustomerProfilePanel auto-calls this once if `status === PENDING`.

---

## External API contract

Base URL + auth header from env (`TMR_DATA_SERVICE_BASE_URL`, `TMR_DATA_SERVICE_API_KEY`,
`TMR_DATA_SERVICE_API_KEY_HEADER`).

1. `POST /back-office/getUsersByFuzzySearch` — `{ emailId }` → find EXACT case-insensitive email match in `data[]`
2. `POST /back-office/getUserDetails` — `{ userId }` → `{ accounts[], teams[], dataSources[], queries[], schedules[] }`

Only matched emails are accepted — fuzzy near-matches are rejected (→ `NOT_FOUND`).

---

## TmrSyncStatus lifecycle

| Status | Meaning |
|---|---|
| `PENDING` | Never attempted (all existing + backfilled users) |
| `OK` | Last sync succeeded; `tmrMetadata` is current |
| `NOT_FOUND` | Email has no matching TMR account |
| `ERROR` | Last sync threw/timed out; will retry on next manual refresh |

---

## Failure handling

- `syncUser` wraps the entire flow in try/catch; on any error it logs at `error` level
  (`context: TmrDataService`) and sets `tmrMetadataStatus = ERROR`. **Never rethrows.**
- Missing env (`TMR_DATA_SERVICE_BASE_URL` / `TMR_DATA_SERVICE_API_KEY`): logs `warn` once,
  returns immediately leaving `PENDING` — no DB write.
- Enqueue sites use `.catch(() => {})` so enqueue failure never propagates into ticket/email flow.
- Worker retries: `retryLimit: 3, retryDelay: 10` (pg-boss).
- HTTP timeout: `AbortSignal.timeout(10_000)` per call.

---

## Skipped cases

- **Promotional / bulk senders** — `firstMsgIsBulk` check in `thread-ingestion.service.ts`; section hidden in bridge UI.
- **Backfill** — `isBackfill: true` in `fetchAndUpsertThread`; backfilled users stay `PENDING` and sync lazily on first open.

---

## UI placement

- **Customer Profile Panel** (`variant="panel"`) — full product section below Conversations, showing brand band + account cards + team stat tiles.
- **Ticket page sidebar** (`variant="compact"`) — compact widget above Ticket Meta; "view more details →" opens CustomerProfilePanel.
- **Shimmer loading** states use the `.shimmer` CSS class (already has light-theme override in `globals.css`).
- **Theme-safe:** all surfaces use `var(--d-*)` tokens only. Works in both dark and light themes.

---

## Tests

- Unit: `tests/unit/api/tmr-data-reduce.spec.ts` (R220–R222)
- Integration: `tests/integration/tmr-data.spec.ts` (R223–R232)
- Regression catalogue: `tests/regression-catalogue.md` row "promotional/bulk or backfill email must never trigger a tmr_data_service call"
