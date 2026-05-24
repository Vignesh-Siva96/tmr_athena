# Plan: Import Chatwoot conversations as mock tickets

## Context

We have a 2 MB JSON export of 468 real Chatwoot support conversations
(`/home/vignesh/tmr_chatwoot_conversations_apr0126_to_may1926.json`,
dated Mar 31 → May 18 2026, 290 unique contact emails). Goal is to seed
the Athena dev DB with this history so the Bridge UI has realistic
demo data — meaningful customer pages, populated analytics charts,
varied ticket statuses.

The source has no titles, statuses, categories, priorities, or agent
identities. We synthesize those.

## Locked decisions (from clarifying questions)

| Topic | Choice |
|---|---|
| Title | First user message, trimmed to ≤ 80 chars at a sentence/word boundary |
| Status | Age + activity heuristic (see §5) |
| Agent attribution | All agent messages → `admin@twominutereports.com` |
| Timestamps | Preserve original `createdAt` / `updatedAt` from Chatwoot |

## Defaults chosen without asking

| Field | Default | Why |
|---|---|---|
| `Ticket.source` | `EMAIL` | Chatwoot was their email inbox channel |
| `Ticket.category` | Keyword-based heuristic (see §6), fallback `OTHER` | Makes analytics charts richer |
| `Ticket.priority` | Keyword-based heuristic (see §7), fallback `NORMAL` | Same |
| `User.name` | Derived from email local-part (`jordan.smith` → "Jordan Smith") | Source has no name |
| `User.source` | `EMAIL` | Matches our new email-origin convention |
| `User.isVerified` | `false` | They never signed in to our portal |
| Message types 2 + 3 | Skipped | Automation + CSAT prompts, per request |
| Conversations with 0 user messages (3 of them) | Skipped | No customer side to import |

---

## 1. Pre-flight

- **Clear existing DB seed** first — the script refuses to run if any
  ticket already has a Chatwoot conversation ID recorded (see §10
  idempotency). Recommended order:
  1. `pnpm --filter @tmr/api dev` is running (so IMAP supervisor can't be
     ingesting fresh mail mid-import).
  2. Pause IMAP: toggle inbound off in Settings → Email, **or** stop the
     API for the duration of the import to be safe.
  3. Run the import script.
  4. Re-enable inbound when done.

## 2. Script location

New file: `packages/db/src/import-chatwoot.ts`

Run with: `pnpm --filter @tmr/db tsx src/import-chatwoot.ts <path-to-json> [--dry-run]`

Dry-run prints the parsed counts and the first 3 tickets it would create
(title, user, category, priority, status, message count) without
touching the DB.

## 3. Schema changes

**None.** Idempotency, rollback, and re-runs are handled at the script
level (see §10) without touching the schema.

## 4. User resolution

For each unique `contact_email`:

```ts
// Pseudocode
const existing = await db.user.findUnique({ where: { email } })
if (existing) return existing
return db.user.create({
  data: {
    email,
    name: humanizeFromEmail(email),   // "jordan.smith" → "Jordan Smith"
    source: 'EMAIL',
    isVerified: false,
    createdAt: earliestConversationDate,
  },
})
```

`humanizeFromEmail(email)`:
- Take local-part before `@`.
- Replace `.`, `_`, `-` with space.
- Strip trailing digits (`vignesh.s2` → `Vignesh S`).
- Title-case each word.
- If the local-part is just `noreply` / `info` / similar, fall back to
  the email itself as the name.

## 5. Status assignment

Per conversation, compute:

```ts
const ageDays = (now - conversation_created_at) / 86_400_000
const lastMsg = messages.filter(m => m.message_type === 0 || m.message_type === 1).at(-1)
const lastFromAgent = lastMsg?.message_type === 1

if (ageDays > 14)               status = 'RESOLVED'
else if (ageDays > 3 && lastFromAgent) status = 'RESOLVED'
else if (ageDays > 3 && !lastFromAgent) status = 'IN_PROGRESS'
else if (lastFromAgent)         status = 'WAITING'   // recent, waiting for customer
else                            status = 'OPEN'      // recent customer message
```

Given the date range ends May 18 and today is May 21, almost everything
will land as `RESOLVED` — which is realistic for a historical import.
~5–10% will be in the active statuses, giving the Inbox a real-feeling
working queue.

## 6. Category heuristic

Run on the **first user message body**, lowercased:

| Keywords | Category |
|---|---|
| `bug`, `broken`, `error`, `not working`, `revoked`, `fails`, `crash`, `wrong data` | `BUG` |
| `feature`, `request`, `please add`, `can you add`, `would like`, `support for` | `FEATURE_REQUEST` |
| `invoice`, `billing`, `subscription`, `refund`, `plan`, `price`, `pay` | `BILLING` |
| `how do i`, `how to`, `what is`, `where can i`, ends with `?` and < 200 chars | `QUESTION` |
| anything else | `OTHER` |

Cheap, but produces a reasonable spread for the analytics donut.

## 7. Priority heuristic

| Keywords (case-insensitive) | Priority |
|---|---|
| `urgent`, `asap`, `critical`, `production down`, `not working at all`, `losing money`, `clients are` | `URGENT` |
| `important`, `priority`, `affecting multiple`, `whole team` | `HIGH` |
| everything else | `NORMAL` |

## 8. Message mapping

For each message in `messages` array where `message_type ∈ {0, 1}`:

```ts
{
  ticketId,
  body: stripHtml(content).trim(),
  bodyRaw: content,
  type: 'REPLY',
  isInternal: false,
  authorUserId: message_type === 0 ? user.id : null,
  authorAgentId: message_type === 1 ? adminAgent.id : null,
  sentVia: 'EMAIL',
  createdAt: message.created_at,
  updatedAt: message.created_at,
  // messageId left null — these are imports, not real RFC 5322 messages
}
```

Note: `content` may contain newlines but appears to be plain text in the
sample (no HTML tags spotted in the first 30 conversations). We still
run a defensive `stripHtml` pass.

## 9. Ticket mapping

```ts
{
  title: deriveTitle(firstUserMessage),
  userId: user.id,
  category: deriveCategory(firstUserMessage),
  priority: derivePriority(firstUserMessage),
  status: deriveStatus(conversation_created_at, messages),
  source: 'EMAIL',
  number: <autoincrement>,                       // schema default
  emailThreadId: <cuid()>,                       // schema default
  createdAt: conversation_created_at,
  updatedAt: lastMessage.created_at,
  // No assignedAgentId — the historical "an agent replied" doesn't map to a real assignment
}
```

`deriveTitle`:
1. Take the first user-type message's content.
2. Strip HTML, collapse whitespace.
3. Take the first sentence (up to first `. ?  !  \n`), else first 80 chars.
4. Trim trailing punctuation, strip leading "Hi/Hey/Hello, " greeting if
   present. Capitalize first letter.
5. Fallback if empty: `"Support request from {humanized name}"`.

## 10. Idempotency

Before inserting any ticket, the script:

1. Counts existing rows where `source = 'EMAIL'` AND `createdAt`
   falls inside the import file's date range. If > 0, prints a warning
   with the count and refuses to proceed without a `--force` flag. This
   protects against accidental double-imports.
2. With `--force`: wipes the prior import (using the rollback SQL in
   §14 scoped to the import date range) before re-inserting. Re-runs
   are wipe-and-replace rather than per-row dedup — simpler and the
   right semantics for a one-shot demo seed.

## 11. Performance

468 conversations × ~10 messages = ~5k DB writes. To keep it fast:

- Wrap each conversation in a `prisma.$transaction([...])` so the user
  upsert, ticket create, and message createMany happen atomically.
- Skip Prisma logging during the run (`new PrismaClient({ log: [] })`).
- Process serially (concurrency 1) — no race on user uniqueness.
- Expected runtime: 20–60 seconds on local Postgres.

## 12. Dry-run output (what you'll see when you run `--dry-run`)

```
[dry-run] Parsed 468 conversations
[dry-run] After filtering (≥1 user msg, has 0|1 messages): 465
[dry-run] Will create: 290 users, 465 tickets, ~2412 messages
[dry-run]
[dry-run] Sample of first 3 tickets:
[dry-run]
[dry-run] ─────────────────────────────────────────────
[dry-run] title:      "LinkedIn page connections showing as revoked in Looker Studio"
[dry-run] user:       Intoworkaustralia <intoworkaustralia@gmail.com> (new)
[dry-run] category:   BUG
[dry-run] priority:   NORMAL
[dry-run] status:     RESOLVED  (51 days old, last msg from agent)
[dry-run] messages:   8  (5 user, 3 agent)
[dry-run] createdAt:  2026-03-31T18:49:28.010Z
[dry-run] ...
```

## 13. Verification after running

- `count(*) FROM "Ticket"` should be ~465.
- `count(*) FROM "Message" WHERE ticketId IN (...) AND type = 'REPLY'`
  should be ~2400.
- Bridge Inbox loads in <500 ms, filters work, search works, analytics
  charts have a 7-week area shape.
- The Customer Profile slide-over shows multi-ticket history for the
  ~80 customers with multiple imported conversations.
- A few tickets in `OPEN` / `WAITING` show up at the top of the Inbox.

## 14. Rollback

Scoped by `source = 'EMAIL'` plus the import's date range so we don't
touch any real email-originated tickets that arrive later:

```sql
WITH imported AS (
  SELECT id FROM "Ticket"
  WHERE source = 'EMAIL'
    AND "createdAt" BETWEEN '2026-03-31' AND '2026-05-19'
)
DELETE FROM "Message" WHERE "ticketId" IN (SELECT id FROM imported);
DELETE FROM "Ticket"  WHERE id IN (SELECT id FROM imported);
DELETE FROM "User" WHERE source = 'EMAIL'
  AND NOT EXISTS (SELECT 1 FROM "Ticket" WHERE "Ticket"."userId" = "User".id);
```

The script's `--force` flag runs this scoped delete automatically
before re-inserting.

## 15. Files touched

| File | Change |
|---|---|
| `packages/db/src/import-chatwoot.ts` | **New** — the import script |
| `packages/db/package.json` | + `"import:chatwoot": "tsx src/import-chatwoot.ts"` script |

No application code changes. Bridge / Portal / API stay untouched.

## 16. Out of scope (intentionally)

- Attachments: Chatwoot export doesn't include them, none in our sample.
- Tags / labels: not in the export.
- Internal notes: not in the export (would be a different `private` flag in Chatwoot anyway).
- Real agent assignment / per-agent attribution: collapsed to admin.
- GitHub issue links: not in the export.
- Routing the imported tickets through the inbound email pipeline (we
  insert directly to DB — bypassing the queue is intentional for a
  one-shot bulk seed).
