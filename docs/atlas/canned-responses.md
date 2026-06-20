---
title: Canned Responses
stack: [NestJS, Prisma, Postgres, Zod]
status: working
last-reviewed: 2026-06-19
---

# Canned Responses

## What it does

Pre-written reply templates agents can insert into the ticket reply composer via a **slash command** (`/name`). Intended for common answers like billing FAQs, welcome messages, etc. The template body is stored as HTML and rendered directly into the `contentEditable` composer.

Canned responses are **agent-facing only** (never sent to the Portal). Any agent can create, edit, and delete templates — there is no owner column and no admin gate.

## Stack

| Layer | Library / service | Why |
|---|---|---|
| HTTP | NestJS controller + Zod validation | Same pattern as the rest of the API |
| Persistence | Prisma `CannedResponse { id, name, body, createdAt, updatedAt }` | Body stored as HTML |
| Auth | `AgentGuard` | Any authenticated agent can manage |

## API

`GET /canned-responses` — list all templates, ordered by name.  
`POST /canned-responses { name, body }` — create.  
`PATCH /canned-responses/:id { name?, body? }` — update.  
`DELETE /canned-responses/:id` — delete.

## Slash-command insertion

In the ticket reply/note composer (`apps/bridge/src/app/tickets/[id]/page.tsx`):

1. Canned responses are loaded once when the composer first opens.
2. On every editor input, the code scans backwards from the caret for a `/` that starts a token (at start-of-line or after whitespace).
3. If found, a floating picker (positioned near the caret via `getBoundingClientRect`) shows filtered templates matching the typed query.
4. The agent selects with mouse-click, Enter, or Tab. Arrow keys navigate the list; Escape closes the picker.
5. On selection: the `/query` text is deleted and `document.execCommand('insertHTML', false, template.body)` inserts the HTML at the caret.

Works for both reply and internal-note tabs.

## Key files

| File | Role |
|---|---|
| [`apps/api/src/modules/canned-responses/`](../../apps/api/src/modules/canned-responses/) | Backend module (dto, service, controller, module) |
| [`apps/bridge/src/app/settings/canned-responses/page.tsx`](../../apps/bridge/src/app/settings/canned-responses/page.tsx) | Settings UI — list, create, edit, delete with inline rich-text editor |
| [`apps/bridge/src/app/tickets/[id]/page.tsx`](../../apps/bridge/src/app/tickets/[id]/page.tsx) | Slash-command detection + picker in the reply composer |
