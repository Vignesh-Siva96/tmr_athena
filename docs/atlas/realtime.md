---
title: Real-time (SSE)
stack: [NestJS @Sse, RxJS Subject, EventSource API, React custom hooks]
status: working
last-reviewed: 2026-06-10
---

# Real-time (SSE)

## What it does

The agent dashboard (Bridge) receives server-pushed events from the API over a single persistent HTTP connection (Server-Sent Events). This eliminates the need for short-polling on most pages and gives near-instant feedback when:

- A new ticket arrives (email sync picked it up)
- A new message is posted to a ticket
- The background email archive makes progress or finishes
- A new notification is created (e.g. GitHub fix-deployed)

## Architecture

```
API (NestJS)                    Bridge (Next.js)
───────────────────────────────────────────────────
EventsModule (@Global)          layout.tsx
  SseService (RxJS Subject)  ←─── SseProvider (mounts useSseEvents once)
  SseController              ←─── ① POST /events/ticket (JWT in header)
    (@Post + @Sse)           ←─── ② EventSource(?ticket=...)
                                       │
                                  sseEventBus (in-process pub/sub)
                                       │
                                  ┌────┴──────────────┐
                                  ▼                   ▼
                            tickets/[id]      useBackfillStatus
                            (message-         (archive-progress)
                             created)
```

## API side

### SseService (`apps/api/src/modules/events/sse.service.ts`)

A simple RxJS `Subject` wrapper. Services call `sse.broadcast(event)` and the controller pipes the observable to the client.

```ts
broadcast(event: SseEvent): void   // push to all connected clients
asObservable(): Observable<{data: string}>  // serialised JSON frames
```

### SseController (`apps/api/src/modules/events/sse.controller.ts`)

```
POST /api/v1/events/ticket          (AuthGuard — JWT in Authorization header)
  → { ticket: "<short-lived single-use ticket>" }
GET  /api/v1/events?ticket=<ticket> (@Sse)
```

Two-phase auth: the `EventSource` API cannot send custom HTTP headers, and putting the JWT in the URL would leak it into logs/history. So the client first exchanges its JWT for a short-lived, **single-use** ticket via an authenticated `POST /events/ticket` (`SseService.issueTicket()`), then opens the EventSource with `?ticket=...`. The SSE endpoint consumes the ticket (`SseService.consumeTicket()`) — an invalid/expired/reused ticket gets a 401. On connect the stream merges a `{type:'hello',ts:...}` frame before the main observable.

### EventsModule (`apps/api/src/modules/events/events.module.ts`)

`@Global()` — `SseService` is available for injection in every module without needing to add `EventsModule` to `imports`.

### Where broadcasts happen

| Service | Event type | Trigger |
|---|---|---|
| `ThreadIngestionService` | `ticket-created` | New external thread upserted |
| `ThreadIngestionService` | `message-created` | New message on existing ticket |
| `EmailSyncBackfillService` | `archive-progress` | After each backfill batch |
| `MessagesService` | `message-created` | Agent or customer posts via Bridge/portal |
| `TicketsService` | `ticket-created` | Ticket created via portal API |
| `TicketsService` | `ticket-updated` | Ticket status/priority/assignee changed |
| `NotificationsService` | `notification-created` | `createAndBroadcast()` called |

### Event types (`apps/api/src/modules/events/event.types.ts`)

```ts
type SseEvent =
  | { type: 'hello'; ts: number }
  | { type: 'ticket-created'; ticketId: string; threadId?: string }
  | { type: 'ticket-updated'; ticketId: string }
  | { type: 'message-created'; ticketId: string; messageId: string }
  | { type: 'archive-progress'; processed: number; status: string }
  | { type: 'notification-created'; notificationId: string }
```

## Bridge side

### `useSseEvents(token)` (`apps/bridge/src/lib/useSseEvents.ts`)

Opens a single `EventSource` connection and pushes parsed frames to `sseEventBus`. Reconnects with exponential backoff (2s → 4s → 8s … capped at 30s) on error.

### `SseProvider` (`apps/bridge/src/components/SseProvider.tsx`)

Thin client component that calls `useSseEvents(token)` where `token` comes from `useAuth()`. Mounted inside `AuthProvider` in `layout.tsx` — a single connection for the whole session.

### `sseEventBus` (`apps/bridge/src/lib/sseEventBus.ts`)

In-process pub/sub. Components call `sseEventBus.on(type, handler)` to subscribe; `useSseEvents` calls `sseEventBus.emit(event)` when frames arrive. The `on()` call returns an unsubscribe function for use in `useEffect` cleanup.

### Where subscriptions happen

| Location | Subscribed events | Action |
|---|---|---|
| `apps/bridge/src/app/tickets/[id]/page.tsx` | `message-created` (for this ticket only) | Reload full ticket |
| `apps/bridge/src/app/inbox/page.tsx` | `ticket-created`, `ticket-updated`, `message-created` | Debounced (~300 ms) background refetch of the ticket list (G6) |
| `apps/bridge/src/lib/useBackfillStatus.ts` | `archive-progress` | Optimistic state update (no poll needed) |

## Key files

| File | Role |
|---|---|
| `apps/api/src/modules/events/sse.service.ts` | RxJS Subject; `broadcast()` + `asObservable()` |
| `apps/api/src/modules/events/sse.controller.ts` | `POST /events/ticket` (JWT → ticket) + `GET /events?ticket=...` (@Sse) |
| `apps/api/src/modules/events/events.module.ts` | `@Global()` module; exports SseService |
| `apps/api/src/modules/events/event.types.ts` | `SseEvent` discriminated union |
| `apps/bridge/src/lib/sseEventBus.ts` | In-process pub/sub; typed `on()` / `emit()` |
| `apps/bridge/src/lib/useSseEvents.ts` | Opens EventSource; reconnects with backoff |
| `apps/bridge/src/components/SseProvider.tsx` | Client component; mounts hook once per session |

## Notable decisions

- **SSE over WebSockets** — one-directional (server → client) is all we need; SSE is simpler, HTTP/1.1 compatible, and doesn't need a separate upgrade. Browser automatically reconnects on disconnect (but we also implement manual exponential backoff on `onerror` for control).
- **Ticket exchange instead of JWT in query param** — `EventSource` doesn't support custom request headers, but a long-lived JWT in a URL leaks into server logs, browser history, and referrers. The client exchanges its JWT (sent in the `Authorization` header of an ordinary `fetch`) for a short-lived single-use ticket, and only the ticket travels in the URL.
- **`@Global()` EventsModule** — avoids circular imports. `ThreadIngestionService` and `EmailSyncBackfillService` (in `EmailSyncModule`) need to broadcast but can't import `EventsModule` (which would create a cycle through `AppConfigModule`). They use a `setSseService()` pattern instead — set in `OnModuleInit` by `EventsModule`.
- **sseEventBus is in-process** — no Redis pub/sub, no external broker. Works fine for a single-process NestJS app; if the app ever runs multi-process, the bus would need to be replaced with Redis.
- **Polling kept alongside SSE** — Inbox now subscribes to SSE (`ticket-created`, `ticket-updated`, `message-created`) with a 300 ms debounce; the `setInterval` fallback was stretched from 15 s → 60 s since SSE is the primary signal. Ticket detail still polls every 10 s *and* subscribes to `message-created`. SSE makes both views instant most of the time; polling acts as a fallback if the SSE connection drops silently (some corporate proxies buffer SSE).

## Known gaps

- SSE frames are broadcast to **all** connected agents, not filtered per-agent. For a single-tenant single-org app this is fine. Multi-tenant or high-agent-count deployments should add per-session filtering.
- `notification-created` is broadcast but nothing in Bridge currently subscribes to it (the sidebar badge polls separately). A future pass should wire up the notification bell.
