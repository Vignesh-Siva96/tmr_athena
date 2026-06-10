# Dashboard — Page Specifications

> Historical spec. The `design/screens/*.jsx` reference files were removed once the frontend was
> built — the implemented app is now the reference. Design tokens live in `apps/bridge/src/globals.css`
> (documented in `.claude/design-system.md`).

---

## Shared Dashboard Layout

All dashboard pages share:
- Dark background: #0A0A0A
- Left sidebar: 220px fixed, full height, bg #0A0A0A, 1px right border #27272A
- Main content area: flex, independently scrollable
- Font: same as portal (DM Sans / system)
- All text on dark: #FAFAFA primary, #A1A1AA secondary

### Persistent Left Sidebar Structure

```
┌─────────────────────┐
│ ■ TMR Support        │  ← logo + org name, 20px, white bold
│   Acme Corp · workspace │  ← 12px muted
├─────────────────────┤
│ 🔍 Search tickets... ⌘K │  ← search input, #1C1C1E bg
├─────────────────────┤
│ VIEWS               │  ← 11px uppercase label, #71717A
│ ✉ Inbox        24   │  ← active: left 2px blue border + #2563EB/15 bg
│   Mine          7   │
│ ○ Unassigned   11   │
│ ⊞ All tickets 248   │
├─────────────────────┤
│ STATUS              │
│ ● Open         18   │  ← blue dot
│ ● In Progress   9   │  ← amber dot
│ ● Waiting       4   │  ← purple dot
│ ● Resolved    186   │  ← green dot
├─────────────────────┤
│ LABELS              │
│ ● Bug Report   42   │  ← red dot
│ ● Feature Req  28   │  ← blue dot
│ ● Question     15   │  ← green dot
│ ● Billing       8   │  ← yellow dot
├─────────────────────┤
│ [SK] Sarah Kim  ⚙   │  ← agent avatar + name + settings icon
│      Connector eng  │
└─────────────────────┘
```

Section labels: 11px uppercase, #71717A, 16px padding-top
Nav items: 14px, #A1A1AA, 32px height, 8px padding horizontal, 4px radius
Active item: #FAFAFA text, left 2px solid #2563EB border, bg rgba(37,99,235,0.12)
Count badges: right-aligned, 12px, #71717A

---

## CP-20 — Page 5: Agent Inbox

**Route:** `/inbox`
**Auth:** Agent required

### Three-Column Layout
- Col 1: sidebar (220px, shared, described above)
- Col 2: ticket table (flex, min 600px)
- Col 3: quick preview panel (320px, shown when ticket row clicked)

### Table Header Row
- Left: "Inbox" (20px bold, white) + "24 open · 7 mine" (13px muted)
- Right: "Filter" button (icon) + "Newest ↓" sort dropdown + "+ New ticket" button

### Active Filters Bar (when filters applied)
- Chips below header: "Status: Open, In Progress ×" + "Assignee: Anyone ×" + "+ Add filter"
- Small, dismissible chips

### Table Column Headers
```
□  |  ID  |  SUBJECT (flex)  |  STATUS  |  ASSIGNEE  |  UPDATED
```
- Checkbox header: select all
- Headers: 11px uppercase, #71717A

### Ticket Table Rows (48px height)
```
□ ●  TMR-1042  [●unread] GA4 connector failing... [Bug][GA4][·Acme Corp]  ●Waiting  [SK]  3m
```

Left to right:
- Checkbox (16px, appears on hover or when others selected)
- Priority dot: 8px, red=urgent, amber=high, grey=normal
- ID: monospaced, 12px, #71717A, fixed ~80px width
- Unread dot: 6px blue dot, shown if customer replied unread
- Subject: 14px, white if unread/bold, #A1A1AA if read. Truncated 1 line
- Below subject: "· Acme Corp" in muted (customer org)
- Tags: Bug, GA4 connector — small inline pills
- Status badge: right section, dot + text
- Assignee: 24px avatar circle
- Updated: "3m" / "2h" / "Yest", 12px #71717A, right-most

Selected row: left 2px blue border + subtle blue tint bg
Hover: bg lifts to #1C1C1E

### Quick Preview Panel (right, 320px)
Shown on single-click of a row. Hidden by default.

**Header:**
- Ticket ID pill (e.g. "TMR-1042 · Bug") + "Open full →" link

**Status badges:**
- "● Waiting" + "⚑ Urgent" — side by side

**Customer section:**
- "CUSTOMER" label
- Avatar (40px) + name + email + "Pro" badge
- Stats: Tickets 12 | Open 3 | Avg Reply 1.4h — 3-column grid

**Last Message:**
- "LAST MESSAGE · 2H AGO" label
- Message preview text (3 lines, truncated)

**Quick Reply:**
- Textarea: "Type a reply or / for templates..."
- Action row: paperclip icon | code icon | github icon | "Send & keep open" button (blue with dropdown ▼)

**Bottom Actions:**
- "Assign me" | "✓ Resolve" | "⊏ Link issue" — ghost buttons in a row

### Empty States
- All clear: "✓ All clear" centered, "No open tickets. You're all caught up."
- No results: "No tickets match these filters." + "Clear filters" link

---

## CP-21 — Page 6: Ticket Detail (Agent)

**Route:** `/tickets/[id]`
**Auth:** Agent required

### Three-Column Layout
- Col 1: shared sidebar (220px)
- Col 2: main thread (flex, ~55%)
- Col 3: metadata sidebar (280px)

### Thread Header
- Breadcrumb: "← Inbox / TMR-1042" — clickable, 6px each
- Star icon + "..." more menu (right)
- Ticket title: 24px bold, white, wraps 2 lines
- Control row (below title):
  - STATUS dropdown: "● In Progress ▼" (amber)
  - PRIORITY dropdown: "⚑ Urgent ▼" (red flag icon)
  - ASSIGNEE: avatar + "Sarah Kim ▼"
  - CATEGORY: tag icon + "Bug Report ▼"
  - "+ Add tag" ghost button

### Thread Messages

**Customer message:**
- Left-aligned
- Avatar circle (32px) + name + email + timestamp
- Message card: #1C1C1E bg, 1px #27272A border, 8px radius
- Body: rendered markdown, monospace for inline code
- Attachments: file chips below (e.g. "📎 error-log-2025-05-13.txt" + "📎 ga4-sheets-screenshot.png")

**System events (centered):**
- "⊏ Linked to GitHub issue #234 · tmr/connectors" — centered, GitHub icon, blue link
- "Status changed Open → In Progress by Sarah Kim" — centered, muted

**Internal Note (agent-only):**
- Amber-tinted bg (#1C1A17), amber left border
- "SK Sarah Kim · 🔒 INTERNAL NOTE" header badge (orange text, orange border pill)
- Timestamp right
- Body text in warm white
- Mentions (@diego) highlighted in blue

**Agent Reply:**
- Right-aligned
- "✓ Sent via portal + email" badge — green check, muted text
- Timestamp + "Connector engineering · TMR" + agent name + avatar (right)
- Message card: slightly different bg from customer card
- Body: rendered markdown with bold support

### Reply Composer (fixed bottom)
- Tab row: "✉ Reply to customer" | "🔒 Internal note" | "⌘/ templates"
  - Active tab: white text, underline
- Rich text toolbar: H | B | I | <> | ≡ | 🔗 | 📎 (attach)
  - Right-aligned: "Sent via portal + email" muted label
- Textarea: "Hi Jordan — fix is scheduled for tomorrow's release..." editable
  - "— Sarah" signature visible
- Bottom action row:
  - Left: "Customer will receive this at jordan@acmecorp.com" muted
  - Right: "Send & Resolve" ghost button + "Send & Keep Open" blue primary with dropdown ▼

### Right Metadata Sidebar

**CUSTOMER section:**
- "View profile →" link right-aligned
- Avatar (40px) + name + email + copy icon
- "Pro Plan" badge + "Acme Corp" tag
- "Member since Jan 2024"
- "Tickets: 12 total · 3 open"
- "Last active: 2h ago"

**TICKET section:**
- Created: "May 12 · 10:14 AM"
- Last activity: "today · 9:41 AM"
- Product: "Google Sheets"
- Connector: "GA4 — Google Analytics"
- Source: "Portal + Email"

**GITHUB section:**
- Linked issue card: GitHub icon + "GA4 connector retry burst" + "tmr/connectors#234" + "Open" orange badge
- "● 3 reviewers · ⏱ 2 days"
- "+ Create new issue" ghost button below

**ACTIONS section:**
- "✓ Resolve ticket" — full width green button
- "✉ Send to customer" — ghost button
- "🗑 Archive ticket" — ghost button

---

## CP-22 — Page 7: Customer Profile Slide-over

**Route:** Slide-over panel, triggered from "View profile →" in ticket detail sidebar
**Auth:** Agent required

### Overlay Behavior
- Slides in from right, 480px wide
- Dark overlay behind (#000000 40% opacity)
- Close: × top-right OR Escape key
- Clicking overlay closes panel
- Does NOT navigate away from current ticket

### Panel Header
- Top row: "CUSTOMER PROFILE" label + edit icon + × close button
- Avatar: 56px circle, initials "JC", accent purple bg
- Name: "Jordan Chen" — 20px bold, white
- Email: "jordan@acmecorp.com" + copy icon — 14px muted
- Badges: "Pro Plan" (blue) + "Acme Corp" (dark gray)
- "Customer since Jan 2024" — 12px muted

### Account Overview Section
4-stat grid (2×2):
```
┌──────────┬──────────┐
│    12    │    3     │
│  Total   │   Open   │  ← amber tint bg for Open if > 0
│ tickets  │  (open)  │
├──────────┬──────────┤
│   1.4h   │ 9.6/10   │
│  Avg     │Satisfact-│  ← satisfaction score (show — if N/A)
│  reply   │  ion     │
└──────────┴──────────┘
```
- "Last active 2 hours ago · Hub workspace" — green dot + text below grid

### Ticket History Section
Label: "TICKET HISTORY" + "Show all 12 →" right link

Ticket rows (most recent first):
```
TMR-1042  [CURRENT badge]  GA4 connector failing...  ● In Progress  May 13
TMR-892                    Set up scheduled weekly d... ● Resolved    Apr 22
TMR-891                    Looker Studio data freshne... ● Resolved   Apr 04
TMR-890                    Cannot connect Facebook Ad... ● Resolved   Mar 18
TMR-823                    TikTok Ads spend column sh... ● Resolved   Feb 27
```
- CURRENT badge: blue pill inline with ID
- Each row clickable → navigates to that ticket (closes panel)
- Status dot + text right-aligned

### Internal Notes Section
Label: "INTERNAL NOTES"

Note cards:
```
[SK avatar] Sarah Kim    2 weeks ago
"Power user on the GA4 + Sheets path. Prefers technical replies — ok
to skip the explainer fluff. Has been on Pro since launch."
```
- Editable (pencil icon on hover)
- "Add a note..." textarea at bottom (appears on click/focus)

---

## CP-23 — Page 8: Settings

**Route:** `/settings` (redirects to `/settings/general`)
**Auth:** Agent required (admin features gated behind role check)

### Layout
- Shared left sidebar (same as all dashboard pages)
- Secondary settings nav (220px) within main content area
- Content area to the right of settings nav

### Settings Secondary Nav
- Header: "Settings" (24px bold) + "Acme Corp workspace" (12px muted) + "← Back to workspace" link
- Nav items:
  - WORKSPACE section:
    - General
    - **Branding** (active on this screen)
    - Agents (with count badge: 6)
    - Notifications
  - INTEGRATIONS section:
    - GitHub — "Connected" green badge
    - Email forwarding
    - Billing — "Soon" gray chip (disabled)

### Branding Page (default settings page shown in design)

**Header:**
- "Branding" — 28px bold, white
- "How your support portal looks to customers. Changes update the portal in real time." — 14px muted
- Auto-saved indicator: "● Auto-saved 2s ago" — green dot, top right

**Two-column layout:**
- Left: settings form (flex)
- Right: live preview panel (320px)

**Identity Card:**
- Card: #1C1C1E bg, 8px radius, 1px #27272A border
- "Identity" heading + description
- Organisation input: "Acme Corp"
- Portal tagline input: "Support that actually works." + char counter "27 / 80"

**Logo Card:**
- Logo preview (current logo square, 80px)
- Upload zone: "Drop a logo or browse" + "PNG or SVG · Max 2MB · Square recommended"
- "Remove" button

**Colours Card:**
- "Colours" heading + "Used for buttons, links and the brand panel of the sign-in page."
- Three colour swatches in a row:
  - Primary: blue swatch + "Royal Blue" + "#2563EB" + copy icon
  - Accent: sky swatch + "Sky" + "#0EA5E9" + copy icon
  - Surface: white swatch + "White" + "#FFFFFF" + copy icon
- Contrast validation below: "✓ Contrast ratio 7.4 : 1 · meets WCAG AAA on white surface" — green check, green text

**Email Card:**
- "Email" heading + "How outbound replies appear in your customer's inbox."
- Display name input: "Acme Corp Support"

**Live Preview Panel (right):**
- Header: "PORTAL PREVIEW" label + "Desktop | Mobile" toggle buttons
- Browser chrome frame (rounded, dark bg, with dot indicators + URL bar showing "support.acmecorp.com")
- Inside frame: mini portal preview showing:
  - Portal nav with logo + "Acme Corp Support" + "My Tickets" link + JC avatar
  - "How can we help?" heading (using current brand primary color)
  - "Support that actually works." tagline
  - Category selector row (Bug Report selected in blue)
  - Blank input fields
  - "Submit ticket" button (in primary colour)
- Bottom of frame: "Open live portal →" link + "Send preview to email" link

### Agents Page
- Table: Avatar | Name | Email | Role (Admin/Agent) | Last active | actions
- "+ Invite agent" button top right
- "Agents (6)" heading
- Pending invites section below active agents

### GitHub Integration Page
**When connected (as shown in screenshot):**
- "Connected" green badge next to GitHub in nav
- Connected state card: GitHub icon + username + "Connected" status
- Default repo selector
- "Disconnect" danger link

### General Settings Page
- Org name input
- Support email (read-only + copy)
- Timezone dropdown
- Language dropdown (English only, others "Coming soon")
