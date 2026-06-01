---
title: Portal — Ticket Detail & Ticket List
stack: [Next.js, React, CSS-in-JS (inline styles + style blocks)]
status: working
last-reviewed: 2026-05-28
---

# Portal — Ticket Detail & Ticket List

## What it does

Two pages in the customer portal (`apps/portal`):

| Page | Route | Purpose |
|---|---|---|
| My Tickets | `/tickets` | Lists all tickets owned by the signed-in customer |
| Ticket Detail | `/tickets/[id]` | Shows the full thread for one ticket; allows customer to reply |

## Layout

Both pages use **1180px max-width** containers, matching the wider Zendesk-style feel. Portal is a light-theme app.

### Ticket Detail (`/tickets/[id]`)

```
┌─ Breadcrumb ────────────────────────────────────────────┐
│ ← My Tickets                                            │
├─ Page header ───────────────────────────────────────────┤
│ [H1 title 30px/700]          [Copy link] [#TMR-0001 📋] │
│ ● Open  📋 Question  Opened May 1  ·  Last activity 2h  │
│ ─────────────────────────────────────────────────────── │
├─ Thread column (flex: 1) ──── Sidebar (300px sticky) ───┤
│                               ┌──────────────────────┐  │
│  [36px avatar] Name  Support  │ STATUS eyebrow        │  │
│                        May 28 │ ● In Progress         │  │
│  Body text padded-left 48px   │ ────────────────────  │  │
│  [📎 file.pdf 1.2MB]          │ 28px agent avatar     │  │
│  ─────────────────────────    │ Agent name            │  │
│                               │ Your support rep      │  │
│  [36px avatar] You            └──────────────────────┘  │
│                        May 27 ┌──────────────────────┐  │
│  Body text padded-left 48px   │ DETAILS eyebrow       │  │
│                               │ Category / Product …  │  │
│  ────── status changed ────── └──────────────────────┘  │
│                               ┌──────────────────────┐  │
│  [Reply composer]             │ LINKED ISSUE eyebrow  │  │
│                               │ ⚙ Issue title (2 ln) │  │
│                               │ repo#42  open         │  │
│                               └──────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

Below 1024px: sidebar stacks above thread; sidebar cards render in a 2-column grid (`grid-template-columns: 1fr 1fr`). Below 640px: single column.

### Thread — Zendesk-style uniform cards

Every message (customer or agent) shares the same structure:

```
padding: 20px 0, borderBottom: 1px solid var(--p-border-2)
  row 1: [36px avatar] [Name] [Support badge — agents only] [spacer] [timestamp 12px text-4]
  body: paddingLeft 48px, fontSize 14.5, lineHeight 1.7, pre-wrap
  attachments: paddingLeft 48, flex wrap, gap 6
```

Avatar colors:
- Customer → `var(--p-accent)` fill, white initials
- Agent → `#3F3F46` fill, white initials
- Image (`avatarUrl`) takes precedence

No bubble backgrounds, no asymmetric layout, no colored card borders. The accent color is reserved for the customer avatar and the Support badge.

### Attachment chip (uniform)

```tsx
<a href={att.url} target="_blank" rel="noreferrer" style={{
  display:'inline-flex', alignItems:'center', gap:6,
  padding:'4px 8px', background:'#fff',
  border:'1px solid var(--p-border)', borderRadius:4,
  fontSize:12.5, color:'var(--p-text)', textDecoration:'none',
}}>
  <Paperclip size={12} style={{ color:'var(--p-text-3)' }} />
  {att.filename}
  <span style={{ fontSize:11, color:'var(--p-text-4)' }}>{formatSize(att.size)}</span>
</a>
```

Same chip used for both customer and agent messages.

### System events

Centered borderless text: `11px var(--p-text-4)`, optional GitHub icon, flanked by `1px solid var(--p-border-2)` rule lines. No background, no pill border.

### Reply composer

```
[Reply label]                    [Markdown supported]
┌─────────────────────────────────────────────────────┐
│ Textarea (minHeight: 120px)                         │
├─────────────────────────────────────────────────────┤
│ B I <> 🔗 ≡ 📎          [Send reply accent button] │
└─────────────────────────────────────────────────────┘
Card: borderRadius var(--r-lg), soft box-shadow (no heavy border)
```

Paperclip icon renders in the toolbar; upload wiring is not yet implemented (see Known gaps).

### Sidebar cards

Three cards, all: `background #fff`, `border 1px solid var(--p-border)`, `borderRadius var(--r-lg)`, `padding 16px 18px`.

- **Status** — eyebrow `STATUS`, dot + label in status color, assignee row below (or "Reviewing your request" muted)
- **Details** — eyebrow `DETAILS`, key/value rows; no Ticket row (displayId moved to page header)
- **Linked Issue** (conditional) — eyebrow `LINKED ISSUE`, GitHub icon + title (2-line clamp), repo#N + open/closed pill; whole card is a link with `.linked-issue-card:hover { background: var(--p-surface) }`

### Ticket List (`/tickets`)

Container: `maxWidth: 1180`, `padding: '48px 32px 80px'`.

Row layout (CSS class `.ticket-row`):
- `margin: 0 -12px; padding: 16px 12px; border-radius: 6px` — extends hover background edge-to-edge
- `transition: background 120ms ease`
- On hover: `background: var(--p-surface)` + ChevronRight fades in (`.row-chevron { opacity: 0 → 1 }`)

Row columns (left → right):
1. **Unread dot slot** — 12px wide, dot only when `hasUnreadReply`; always reserves space so titles align
2. **Avatar** — 32px circle from ticket title initials (neutral grey, no author API needed)
3. **Status badge** — 120px wide pill
4. **Display ID** — 80px mono
5. **Title + preview** — `flex: 1`, title one line with ellipsis; last message body preview below in 12.5px `var(--p-text-3)` if available
6. **Category tag** — colored pill
7. **Time** — Clock icon + relative time
8. **Chevron** — `row-chevron` class, opacity 0, visible on row hover

## Key files

| File | Role |
|---|---|
| [`apps/portal/src/app/tickets/[id]/page.tsx`](../../apps/portal/src/app/tickets/[id]/page.tsx) | Ticket detail — thread, composer, sidebar; all inline-styled |
| [`apps/portal/src/app/tickets/page.tsx`](../../apps/portal/src/app/tickets/page.tsx) | Ticket list — filters, row layout, hover styles |

## Helper functions (in-file, not shared)

| Helper | File | Purpose |
|---|---|---|
| `getInitials(name, email)` | `[id]/page.tsx` | Extracts 1–2 initials for avatar |
| `formatSize(bytes)` | `[id]/page.tsx` | Converts bytes to KB/MB string |
| `formatDate(iso)` | `[id]/page.tsx` | Full datetime (e.g. "May 28, 5:36 PM") |
| `timeAgo(iso)` | both | Relative time ("2h ago", "Yesterday") |
| `parseSystemEvent(body)` | `[id]/page.tsx` | Decodes `status_changed:A:B` body to human text |
| `ticketInitials(title)` | `page.tsx` | 2-letter initials from ticket title for row avatar |

## Known gaps

- `TicketListItem.lastMessage` has no author field, so the row avatar falls back to ticket title initials rather than the actual author's avatar. Extend the API select if per-author avatars on the list are needed.
- No optimistic UI on reply send — message appears only after the API round-trip completes.
- Reply composer allows one file per upload click (no multi-select); additional files can be attached by clicking the Paperclip again.
