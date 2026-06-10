# Ticket Lifecycle — Current Flow Reference

> Authoritative description of how tickets move through the system, from creation to resolution.
> Key files: `tickets.service.ts`, `messages.service.ts`, `thread-ingestion.service.ts`,
> `email.service.ts`, `bot.service.ts`.
> See also: [tickets.md](tickets.md), [messages.md](messages.md), [email.md](email.md).

---

## A. Identity & Data Model Invariants

- One `Ticket` table serves both **conversations** (`isTicket=false`, status `NEW`/`DISMISSED`) and **tickets** (`isTicket=true`, other statuses). Invariant: `isTicket=false ⇔ status ∈ {NEW, DISMISSED}`.
- `ref` — 7-char Crockford base32, generated at creation (both paths), displayed only for tickets as `displayId`.
- `emailThreadId` — CUID per ticket; the synthetic email thread anchor `<ticket-{emailThreadId}@domain>`.
- `externalThreadId` — Gmail/Graph thread id (unique), stamped on email-originated tickets at ingest and back-stamped onto portal tickets the first time an email reply is matched.
- `User.category` (`CUSTOMER`/`MARKETING`/`PROMOTIONAL`) — set once on user creation from the first email's bulk signals; agent-editable via the customer profile panel.

---

## B. Portal Ticket Creation (Case 1)

1. `POST /tickets` (guest or user JWT) → transaction: Ticket (`OPEN`, `isTicket=true`, ref) + description Message + attachment claiming (only unclaimed files — IDOR-safe).
2. `activateTicket()`: enqueues `email:send-confirmation` (3× retry, writes `confirmation_sent:` SYSTEM_EVENT on success or `email_delivery_failed:Confirmation email…` on final failure) + `bot:respond-to-ticket` enqueue. SSE `ticket-created`; AI sentiment enqueued for the description.
3. **Bot (Athena)**: idempotent per ticket (one `BotInteraction` ever). Hybrid RAG retrieval; five gates (dense ≥0.55, can_answer, confidence ≥0.7, citations present, same-origin). Pass → bot REPLY (`sentVia=PORTAL_AND_EMAIL`, emailed via the same threading path), status → `WAITING`. Fail → `escalateToHuman()`: assigns on-shift primary agent (atomic `assigneeId=null` guard), status `OPEN`, `escalated:` SYSTEM_EVENT.

---

## C. Status Machine

Transitions are applied via `applyReplyTransition()` (`tickets/util/apply-reply-transition.ts`) — called from both `MessagesService.create()` (portal/Bridge API) and `ThreadIngestionService` (inbound email, live only, real tickets only):

```
agent reply:    OPEN → IN_PROGRESS;  IN_PROGRESS → WAITING
customer reply: WAITING → IN_PROGRESS
customer reply on RESOLVED/CLOSED → IN_PROGRESS  (+reopenCount++, reopenedAt)
```

Every transition writes a `status_changed:FROM:TO` SYSTEM_EVENT. Manual override via `PATCH /tickets/:id`. `RESOLVED` triggers `ai:classify-ticket` + `ai:request-csat` (30-min delayed CSAT email with `/rate/:token` link; idempotent via `csat_requested` SYSTEM_EVENT marker).

- **Agent reply** → outbound email job (`email:send-reply`, 3× retry, failure → `email_delivery_failed` SYSTEM_EVENT). Outbound Message-ID stored back on the Message for future threading.
- **Customer portal reply** → optionally mirrored into the support mailbox as a self-addressed copy (when `AppConfig.mirrorPortalRepliesToEmail=true`, default). The copy uses From/To=support, Reply-To=customer, body prefix `[Portal reply from …]`, threaded to the ticket. The returned Message-ID is stored on the portal Message row so the inbound poller deduplicates it on the next poll. Portal/Bridge still see the reply directly.
- **Bot reply** → portal + email.

---

## D. Inbound Email Ingestion (Case 2 + Ongoing Sync)

1. `LivePollerService` cron (30 s) → provider `pollChanges` (Gmail history API / Graph delta) → `fetchAndUpsertThread` per changed thread.
2. **Thread → ticket matching, 3 levels**: (1) `externalThreadId` fast path; (2) `In-Reply-To` ∈ stored `Message.messageId` (replies to agent emails); (3) synthetic `<ticket-{emailThreadId}@…>` pattern (replies to confirmation). Match → back-stamp `externalThreadId`. No match → new `NEW` conversation (orphans never crash or mis-attach).
3. **Message dedup**: by `externalMessageId` (provider id) and by RFC `messageId` (kills Gmail Sent-folder copies of our own outbound; also deduplicates the portal-reply mirror copy from G1).
4. Sender resolution: alias-only threads skipped entirely; from-agent-alias messages stored with `authorAgentId` (agent replying from their own Gmail shows as agent).
5. Attachments fetched **after** the DB transaction (≤25 MB each; per-file failures non-fatal). Both Gmail and Graph providers implement `fetchAttachmentBytes`.
6. Side effects (live only, skipped on backfill): AI sentiment enqueue, SSE broadcast, scenario-9 escalation check, **status transitions via `applyReplyTransition()`** (real tickets only, non-backfill, non-bot-answered).
7. Ticket timestamps derive from email `sentAt` (backfilled threads don't show "just now").
8. **Bounce detection**: sender local-part matching `mailer-daemon|postmaster` triggers bounce handling — the bounce body/headers are scanned for a known outbound `Message-ID` or the synthetic `<ticket-…@>` token. If found: writes `email_delivery_failed:bounce` SYSTEM_EVENT on that ticket, sets that ticket's user `emailStatus='BOUNCING'`. Unresolvable bounces fall through to a normal `NEW` conversation.

---

## E. Conversation Triage (Case 2 Actions)

- **Convert** (`POST /tickets/:id/convert`, agent-only): `isTicket=true`, `NEW→OPEN`, clears dismissal → `activateTicket()` (confirmation email + bot). Idempotent for already-real tickets.
- **Dismiss** (`POST /tickets/:id/discard`, agent-only): `NEW→DISMISSED` + audit (`dismissedAt/ById`); only NEW conversations. Disappears from default list; **resurrected to NEW** when the customer emails again.

---

## F. Bridge Inbox UI

- `GET /tickets` (agent view = conversations + tickets, DISMISSED excluded by default; filters for status/category/search). Items grouped by customer domain; unread indicator; PROMOTIONAL/MARKETING badge; `displayId` + status pill only for tickets.
- **Refresh strategy**: SSE (`ticket-created`, `ticket-updated`, `message-created` via `sseEventBus`) triggers a debounced background refetch (~300 ms). A 60 s fallback poll handles silently-dropped SSE connections. On tab-focus, an immediate refetch fires once. This replaces the prior 15 s poll-only approach.

---

## G. Additional Scenarios

### Case 3 — Bot First-Responder (Athena) on Every Activated Ticket
Trigger: `activateTicket()` — i.e. portal ticket creation OR agent converting an email conversation.
1. A `bot:respond-to-ticket` job is enqueued; the worker runs once per ticket ever (a `BotInteraction` row is the idempotency guard — retries/reopens never produce a second bot reply).
2. Bot builds the question from ticket title + first customer message, runs hybrid RAG retrieval (pgvector + FTS, RRF) over the crawled knowledge base.
3. Five gates must ALL pass: dense score ≥0.55 · model says `can_answer` · confidence ≥0.7 · citations present · citations same-origin with the KB.
4. **All pass** → posts a REPLY authored "Athena" with a deterministic `Learn more:` source link, `sentVia=PORTAL_AND_EMAIL`; status `OPEN→WAITING`.
5. **Any gate fails** → `escalateToHuman()`: resolves the on-shift primary agent (Shifts feature), atomically assigns if `assigneeId` is null, status stays `OPEN`, writes `escalated:` SYSTEM_EVENT.
6. Either way a `BotInteraction` audit row stores scores, citations, tokens, cost, latency.

Files: `tickets.service.ts:51-68` · `bot.service.ts:32-251` (gates 99-161) · `bot.service.ts:282-345`.

### Case 4 — Auto-Escalation After a Bot Answer ("Scenario 9")
Trigger: bot previously answered (`BotInteraction.didAnswer=true`), ticket is `WAITING`, and the customer replies — meaning the bot's answer didn't solve it.
1. Detection happens in BOTH channels: portal reply (`MessagesService.create`) and inbound email (`ThreadIngestionService`).
2. `escalateToHuman(notifyCustomer=true)`: assign on-shift agent (atomic, skipped if already assigned), status → `OPEN`, `escalated:` SYSTEM_EVENT.
3. The customer receives a courtesy email: their message was received and "a specialist will follow up".

Files: `messages.service.ts` · `thread-ingestion.service.ts` · `email.service.ts:323-348`.

### Case 5 — Reopen Flow
Trigger: customer replies on a `RESOLVED` or `CLOSED` ticket (portal or email, since G3 fix).
1. Status → `IN_PROGRESS`, `reopenCount++`, `reopenedAt` set, `status_changed:` SYSTEM_EVENT. (`firstResolvedAt` is immutable.)
2. CSAT is NOT re-sent on a later re-resolve (idempotency marker, Case 6).

Files: `messages.service.ts` · `apply-reply-transition.ts`.

### Case 6 — CSAT + AI Classification After Resolve
Trigger: agent sets status `RESOLVED` (button or PATCH).
1. Two jobs enqueue: `ai:classify-ticket` and `ai:request-csat` delayed **30 minutes**.
2. CSAT worker: checks the `csat_requested` SYSTEM_EVENT marker (send-once guard), creates a `ratingToken`, emails the customer a `/rate/:token` link.
3. Customer rates 1–5 + optional comment on a public page; result feeds the analytics dashboards.

Files: `tickets.service.ts` · `request-csat.worker.ts` · `rating.controller.ts`.

### Case 7 — Dismissed Conversation Resurrection
Trigger: agent dismissed a conversation (`NEW→DISMISSED`); the same sender emails the thread again.
1. Ingestion matches by `externalThreadId`, sees a non-agent message on a DISMISSED row → status back to `NEW`.
2. The conversation reappears in the Inbox with full prior history.

Files: `thread-ingestion.service.ts:241-254`.

### Case 8 — Orphan Replies Become New Conversations
Trigger: an inbound email carries an `In-Reply-To` that matches nothing.
1. All 3 matching levels fail → a brand-new `NEW` conversation is created.

Files: `thread-ingestion.service.ts:98-176`.

### Case 9 — Agent Mail from Their Own Mailbox
a) *Sent-copy dedup*: the copy is skipped because its RFC `Message-ID` is already stored on the originating Message row.
b) *Agent replies directly from Gmail*: stored with `authorAgentId` (renders as an agent reply in Bridge). Threads where ALL senders are aliases are skipped entirely.

Files: `thread-ingestion.service.ts:182,192-208` · `customer-resolver.service.ts`.

### Case 10 — Email Delivery Failure Surfacing
Trigger: an agent/bot reply email fails to send.
1. pg-boss retries 3× with exponential backoff.
2. On final failure the worker writes an agent-visible SYSTEM_EVENT. The reply itself stays in the thread.

Files: `send-reply.worker.ts:69-88`.

### Case 11 — Backfill vs Live Ingestion
- Backfill: imports full history with original timestamps, skips AI analysis, bot, SSE, and status transitions.
- Live: everything enabled. Both paths share idempotency keys so overlap is harmless.

Files: `email-sync-backfill.service.ts` · `live-poller.service.ts` · `thread-ingestion.service.ts`.

### Case 12 — GitHub Issue Lifecycle on a Ticket
1. Agent creates or links a GitHub issue → `GithubIssue` row + `github_linked:` SYSTEM_EVENT.
2. `fix-deployed` label on the linked issue → HMAC-verified webhook → `GITHUB_FIX_DEPLOYED` notification for all agents + amber banner on the ticket.
3. Closing the loop with the customer is manual.

Files: `github.service.ts` · `github.controller.ts:105-125`.

### Case 13 — Churn-Risk Detection on Customer Messages
Trigger: every live customer REPLY (portal or email) runs `ai:analyze-message`.
1. Churn signal → `CustomerSignal(type=CHURN_RISK)` + `CHURN_RISK_DETECTED` notification + priority bump to HIGH.
2. Advocacy signal → passive `CustomerSignal(type=ADVOCACY)`.

Files: `analyze-message.worker.ts:55-90`.
