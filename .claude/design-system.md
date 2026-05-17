# Design System — TMR Support Platform

Extracted directly from Claude Design output (tokens.css + visual analysis of all 8 screens).
This is the source of truth for all visual decisions.
Never invent values — only use what is defined here.

---

## Typography

| Role | Font | Weight | Size | Usage |
|---|---|---|---|---|
| Display | System / DM Sans | 800 | 40px | Portal page headings ("How can we help?", "My tickets") |
| Heading L | Same | 700 | 28–32px | Dashboard ticket titles, portal ticket title |
| Heading M | Same | 600 | 20–22px | Section headings, card titles |
| Heading S | Same | 600 | 16–18px | Subsection labels |
| Body | Same | 400 | 14–15px | All body copy |
| Body Small | Same | 400 | 13px | Meta, secondary info |
| Label | Same | 500 | 11–12px | Tags, badges, timestamps, uppercase labels |
| Mono | Geist Mono / monospace | 400 | 13px | Ticket IDs (TMR-1042), code snippets |

---

## Color Tokens

### Portal (Light Theme)

```css
/* Backgrounds */
--portal-bg:           #FFFFFF;
--portal-surface:      #F9FAFB;
--portal-surface-2:    #F4F4F5;

/* Borders */
--portal-border:       #E4E4E7;
--portal-border-focus: #2563EB;

/* Text */
--portal-text:         #09090B;
--portal-text-secondary: #71717A;
--portal-text-muted:   #A1A1AA;

/* Accent (primary blue) */
--portal-accent:       #2563EB;
--portal-accent-hover: #1D4ED8;
--portal-accent-light: #EFF6FF;

/* Status */
--status-open:         #2563EB;   /* blue */
--status-in-progress:  #F59E0B;   /* amber */
--status-waiting:      #8B5CF6;   /* purple */
--status-resolved:     #22C55E;   /* green */
--status-urgent:       #EF4444;   /* red */

/* Status backgrounds (light) */
--status-open-bg:      #EFF6FF;
--status-in-progress-bg: #FFFBEB;
--status-waiting-bg:   #F5F3FF;
--status-resolved-bg:  #F0FDF4;
--status-urgent-bg:    #FEF2F2;

/* Category tags */
--tag-bug:             #FEF2F2;  /* light red bg */
--tag-feature:         #F0FDF4;  /* light green bg */
--tag-question:        #EFF6FF;  /* light blue bg */
--tag-billing:         #FFFBEB;  /* light amber bg */
--tag-other:           #F4F4F5;  /* light gray bg */
```

### Dashboard (Dark Theme)

```css
/* Backgrounds */
--dash-bg:             #0A0A0A;
--dash-surface:        #141414;
--dash-surface-2:      #1C1C1E;
--dash-surface-3:      #232323;

/* Borders */
--dash-border:         #27272A;
--dash-border-focus:   #3B82F6;

/* Text */
--dash-text:           #FAFAFA;
--dash-text-secondary: #A1A1AA;
--dash-text-muted:     #71717A;

/* Accent */
--dash-accent:         #2563EB;
--dash-accent-hover:   #3B82F6;
--dash-accent-light:   rgba(37, 99, 235, 0.15);

/* Internal note */
--internal-note-bg:    #1C1A17;
--internal-note-border: #A16207;
--internal-note-text:  #FDE68A;

/* Sidebar active */
--sidebar-active-bg:   rgba(37, 99, 235, 0.15);
--sidebar-active-border: #2563EB;
```

### Shared Semantic Colors

```css
--color-success:  #22C55E;
--color-warning:  #F59E0B;
--color-danger:   #EF4444;
--color-info:     #3B82F6;
```

---

## Spacing Scale

Based on 4px base unit. Use Tailwind spacing scale.

| Token | Value | Tailwind |
|---|---|---|
| xs | 4px | p-1 |
| sm | 8px | p-2 |
| md | 12px | p-3 |
| base | 16px | p-4 |
| lg | 20px | p-5 |
| xl | 24px | p-6 |
| 2xl | 32px | p-8 |
| 3xl | 48px | p-12 |

---

## Border Radius

| Element | Radius |
|---|---|
| Cards / panels | 8px (rounded-lg) |
| Buttons | 6px (rounded-md) |
| Inputs / selects | 6px (rounded-md) |
| Tags / badges / pills | 4px (rounded) — or fully rounded for status pills |
| Avatars | 9999px (rounded-full) |
| Category selector cards | 8px (rounded-lg) |
| Modals / slide-overs | 12px (rounded-xl) |

---

## Shadows

```css
/* Cards on light bg */
--shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);

/* Elevated (dropdowns, panels) */
--shadow-elevated: 0 4px 16px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);

/* Dark theme cards — no shadow, use border instead */
```

---

## Component Specifications

### Buttons

```
Primary:
  bg: #2563EB | hover: #1D4ED8 | text: white
  height: 40px | padding: 0 16px | radius: 6px
  font: 14px medium
  active: scale(0.97) 80ms

Secondary:
  bg: white | border: 1.5px #E4E4E7 | text: #09090B
  hover: bg #F9FAFB

Ghost:
  bg: transparent | text: #2563EB
  hover: bg #EFF6FF

Danger:
  bg: #EF4444 | text: white
  hover: bg #DC2626

Disabled (all): opacity 0.5, cursor not-allowed

Loading state: replace label with spinner (16px, same color as text)

Dashboard primary button: same blue, works on dark bg
"Send & Keep Open" button: blue with dropdown arrow on right side
```

### Inputs & Textareas

```
Portal:
  height: 40px | radius: 6px
  border: 1px #E4E4E7 | bg: white
  focus: border 2px #2563EB, no outline
  placeholder: #A1A1AA | text: #09090B
  font: 14px

Dashboard:
  same but bg: #1C1C1E | border: #27272A
  text: #FAFAFA | placeholder: #71717A

Error state: border red #EF4444, error text below 12px red
```

### Status Badges (Portal)

```
Shape: pill (rounded-full), 4px vertical padding, 10px horizontal
Font: 12px medium

Waiting on you:  bg #F5F3FF, text #7C3AED, dot #8B5CF6
In progress:     bg #FFFBEB, text #B45309, dot #F59E0B
Open:            bg #EFF6FF, text #1D4ED8, dot #2563EB
Resolved:        bg #F0FDF4, text #15803D, dot #22C55E
```

### Status Badges (Dashboard — inline)

```
Same colors but slightly different: text + colored dot only
No background pill — just dot + text in dashboard table rows
Exception: Quick preview panel shows full pill badges
```

### Category Tags

```
Small pills: 11px, 4px radius
Bug Report:       bg #FEF2F2, text #991B1B
Feature Request:  bg #F0FDF4, text #166534
Question:         bg #EFF6FF, text #1E40AF
Billing:          bg #FFFBEB, text #92400E
Other:            bg #F4F4F5, text #3F3F46
```

### Avatars

```
Sizes: 24px (inline), 32px (messages), 40px (profile), 56px (profile panel)
Shape: circle (rounded-full)
Fallback: initials (1-2 chars), colored background
Colors: rotate through accent palette based on name hash
Font: white, 500 weight, proportional to avatar size
```

### Ticket ID Display

```
Font: monospace (Geist Mono or system mono)
Size: 12–13px
Color: muted secondary
Format: TMR-1042
Copyable on click: show "Copied!" tooltip 1.5s
```

---

## Portal Layout

```
Max content width: 860px (ticket list) / 680px (forms)
Nav height: 56px
Nav bg: white, border-bottom 1px #E4E4E7
Nav items: Logo left | Links center-right | Avatar/CTA right
Body padding: 48px top, 24px horizontal (mobile: 16px)
```

## Dashboard Layout

```
Left sidebar: 220px fixed, full height, bg #0A0A0A, border-right 1px #27272A
Main content: flexible
Right panel: 320px fixed (ticket detail) / 360px (customer profile slide-over)
All panels independently scrollable
Top nav within dashboard: 48px height within main content area
```

---

## Dashboard Sidebar Structure

```
[TMR Support logo + org name]    ← top, 56px section
[Search: "Search tickets, customers..."]  ← Cmd+K shortcut badge

VIEWS
● Inbox          24
  Mine            7
  Unassigned     11
  All tickets   248

STATUS
● Open           18
● In Progress     9
● Waiting         4
● Resolved      186

LABELS
● Bug Report     42    (red dot)
● Feature Request 28   (blue dot)
● Question       15    (green dot)
● Billing         8    (yellow dot)

[Agent avatar + name]  ← bottom, settings gear icon
```

Active nav item: left blue border 2px + subtle blue bg tint

---

## Motion

```
Page transitions:   200ms ease-out, fade + translate Y(4px → 0)
Hover states:       120ms ease, color only
Modal open:         250ms ease-out, scale(0.97 → 1.0) + fade
Slide-over open:    300ms ease-out, translateX(100% → 0)
Toast:              200ms slide up + fade, auto-dismiss 4s
Button active:      80ms scale(0.97), 80ms release
Skeleton shimmer:   1.5s linear infinite, left-to-right gradient
Success checkmark:  400ms draw animation
```

---

## Specific Screen Notes

### Page 1 — Submit Ticket
- Category selector: large cards (not pills), icon + label, selected = blue border + blue bg tint
- Product: dropdown, Connector: searchable input side by side
- File chips show green dot + filename + size + ×
- Link paste input below dropzone
- Submit button: full width, blue

### Page 2 — Auth
- Left panel: dark bg (#0D1117) with subtle grid pattern overlay
- "Continue as guest" appears as a card below the form, not inline
- Tab switcher: pill-style, Sign in / Create account

### Page 3 — My Tickets
- Status filter: horizontal pills at top
- Ticket rows: status badge LEFT (fixed width ~140px) | ID | Title + connector meta | Category tag | Time
- Unread: bold title, blue dot left of title
- "Export as CSV" link bottom left

### Page 4 — Ticket View (Customer)
- Two-column: thread (65%) + sidebar (35%)
- Customer messages: right-aligned, light purple/accent tint bg
- Agent messages: left-aligned, white card
- System events: centered, muted, small
- Reply composer: always visible at bottom, B/I/code/link/list toolbar
- Sidebar: Status, Ticket ID, Opened, Category, Product, Connector, Linked Issue, Assigned to

### Page 5 — Agent Inbox
- Three panels: sidebar (220px) + table (flex) + quick preview (320px)
- Table columns: checkbox | priority dot | ID | title+meta | status | assignee avatar | time
- Selected row: blue left border
- Quick preview shows: ticket ID+title, status badges, customer card, last message, quick reply, action buttons
- Filter chips shown above table when active

### Page 6 — Agent Ticket Detail
- Header: breadcrumb + title + STATUS dropdown + PRIORITY dropdown + ASSIGNEE + CATEGORY + Add tag
- Thread: left=customer, right=agent, amber tint=internal note with "INTERNAL NOTE" badge
- "Sent via portal + email" badge on agent replies
- System events: centered pills
- Composer tabs: "Reply to customer" | "Internal note" | "/ templates"
- Composer toolbar: H B I code list link attach
- Send buttons: "Send & Resolve" (ghost) + "Send & Keep Open" (blue primary with dropdown)
- Right sidebar: CUSTOMER section (mini profile), TICKET section (meta), GITHUB section, ACTIONS section

### Page 7 — Customer Profile Slide-over
- Overlay panel, right side, 480px wide
- Stats grid: Total tickets | Open | Avg reply | Satisfaction (2x2 grid cards)
- Ticket history: rows with CURRENT badge on active ticket
- Internal notes at bottom

### Page 8 — Settings / Branding
- Settings nav (220px) within main content (not the global sidebar)
- Left: form | Right: live portal preview (browser chrome frame + phone toggle)
- Colour pickers show hex values + copy icon
- Contrast ratio validation shown as green checkmark
- GitHub shows "Connected" green badge
- "Billing" shows "Soon" chip (disabled)
- Auto-saved indicator: green dot + "Auto-saved 2s ago" top right
