# Portal — Page Specifications

Reference design files: `design/screens/01-Submit.jsx` through `04-TicketCustomer.jsx`
Design tokens: `design/tokens.css` and `.claude/design-system.md`

---

## Shared Portal Layout

All portal pages share:
- White background (#FFFFFF)
- Top nav: 56px height, white bg, 1px bottom border #E4E4E7
- Nav left: Logo (square icon + "Acme Corp Support" — org name from brand config)
- Nav right: "My Tickets" link + "Submit a Ticket" link + user avatar (if logged in) OR sign-in button (if guest)
- Max content width: 860px centered
- Body padding: 48px top, 24px horizontal (mobile: 16px)
- Font: system sans-serif (DM Sans if loaded)

---

## CP-15 — Page 1: Submit Ticket

**Route:** `/submit` (redirect from `/`)
**Auth:** Public (guest or logged in)
**Reference:** `design/screens/01-Submit.jsx`

### Layout
Single column, centered, max-width 680px.

### Page Header
- H1: "How can we help?" — 40px bold, #09090B
- Subtitle: "Describe your issue and we'll get back to you as soon as possible. Most tickets get a first response in under 2 hours." — 15px #71717A

### Form Fields

**Issue Category (required)**
- Label: "Issue category"
- 5 card options in a horizontal row: Bug Report | Feature Request | Question | Billing | Other
- Each card: 8px radius border, icon (top) + label (bottom)
- Icons: Bug=🪲, Feature=✨, Question=❓, Billing=🪙, Other=📋 (use Lucide icons)
- Selected state: blue border (#2563EB) + light blue bg (#EFF6FF)
- Unselected: #E4E4E7 border, white bg
- Mobile: wrap to 2-3 per row

**Title (required)**
- Label: "Title"
- Character counter top-right: "62 / 120" (shown after typing)
- Input placeholder: empty (user sees their typed text)
- Max 120 chars

**Product + Connector Row (optional)**
- Two inputs side by side (50/50)
- Left: "Which product are you using?" — dropdown: Hub, Google Sheets, Google Data Studio, Looker Studio, Power BI, Other
- Right: "Connector (optional)" — searchable text input with search icon prefix
- Connector placeholder: "GA4 — Google Analytics"

**Description (optional)**
- Label: "Description" + "(optional)" muted
- Textarea, min-height 160px, resizable vertical only
- Below textarea: markdown toolbar (B | I | `code` | link | list) + "Markdown supported" right-aligned muted

**Attachments (optional)**
- Label: "Attachments" + "(optional)"
- Drop zone: dashed border, upload icon, "Drag files here, or click to browse" bold + "Supports images, PDFs, and links · Max 10MB each" muted
- Uploaded files: green dot + filename + size (KB) + × button — shown below dropzone
- Below dropzone: link input "Or paste a link (Loom, Sheets, Data Studio…)" with link icon prefix

**Guest Email (conditional)**
- Only shown if user is NOT authenticated
- Shown between Description and Attachments
- Label: "Your email address"
- Helper: "We'll email you updates and you can reply directly from your inbox."

**Submit Button**
- Full width, blue, "Submit ticket"
- Loading: spinner replaces label, disabled
- On success: crossfade to confirmation state (no page nav)

### Confirmation State
Replaces form content with:
- ✓ animated checkmark (blue, 40px)
- "Your ticket has been submitted." — 24px bold
- Ticket ID pill: monospaced "TMR-1042", blue, copyable
- "We'll be in touch shortly. Check your email for updates." — 14px muted
- Button: "View your ticket →" (primary, links to /tickets/TMR-1042)
- Ghost link: "Submit another ticket" (resets form)
- Guest only: "Create an account to track all your tickets in one place" + Google button

### States
- Default (guest): form + email field
- Default (logged in): form, no email field, user avatar in nav
- Submitting: button loading, form disabled
- Success: confirmation state
- Validation error: inline below each field, red border on input

---

## CP-16 — Page 2: Sign In / Sign Up

**Route:** `/auth`
**Auth:** Public (redirect to /tickets if already authed)
**Reference:** `design/screens/02-Auth.jsx`

### Layout
Split: Left panel (55%) dark | Right panel (45%) white form.
Mobile: single column, left panel collapses to logo strip.

### Left Panel (dark)
- Background: #0D1117 with subtle dark grid pattern overlay (very low opacity lines)
- Top-left: white square logo icon + "Acme Corp Support" white text
- Bottom section (vertically centered):
  - Eyebrow: "CUSTOMER SUPPORT" — 11px uppercase, muted white (#A1A1AA)
  - Headline: "Support that actually works." — 40px bold, white, tight line-height
  - Subtext: "Create a ticket in seconds, track every reply in one place, and get answers from a team that knows your stack." — 16px, #A1A1AA
  - 3 checkmarks: blue circle check icon + text (white)
    - "Email updates on every reply"
    - "Track all of your tickets in one place"
    - "Fast, human support — usually under 2 hours"
- Bottom testimonial:
  - Quote: "First support tool that doesn't feel like a 2010 helpdesk."
  - Avatar + "Mia Chen / Marketing Lead · Northwind"

### Right Panel (white form)
- Tab switcher at top: pill toggle "Sign in" | "Create account"
- Content changes based on active tab

**Sign In Tab:**
- H2: "Welcome back" — 28px bold
- Subtitle: "Sign in to view and reply to your tickets." — 14px muted
- Google button: full width, white bg, 1px border, Google G logo, "Continue with Google"
- Divider: "or sign in with email" — centered, 1px lines either side
- Email input: label "Email address"
- Password input: label "Password" + "Forgot password?" right-aligned link + show/hide eye icon
- Sign in button: full width blue "Sign in"
- Footer link: "Don't have an account? Sign up"
- Guest card at bottom: "Just need to submit a ticket?" + "Continue as guest →" link

**Create Account Tab:**
- H2: "Create your account"
- Same Google button
- Email + Password + Confirm Password inputs
- "Create account" button
- "Already have an account? Sign in"
- Terms text: "By creating an account, you agree to our Terms of Service." — 11px muted

### States
- Tab switching: smooth crossfade (no page nav)
- Loading: button spinner
- Error: inline red text above submit button
- Success Sign In: redirect to /tickets
- Success Sign Up: redirect to /tickets with welcome toast
- Forgot password: show email input + "Send reset link" inline within the form

---

## CP-17 — Page 3: My Tickets

**Route:** `/tickets`
**Auth:** Required (redirect to /auth if not logged in)
**Reference:** `design/screens/03-MyTickets.jsx`

### Layout
Full page, max-width 860px centered.

### Nav
Standard portal nav. "My Tickets" active (underline). User avatar top-right with dropdown: org name, sign out.

### Page Header Row
- Left: H1 "My tickets" — 40px bold
- Below title: "3 open · 4 resolved · last activity 2 hours ago" — 14px muted
- Right: "+ New ticket" button (blue, links to /submit)

### Filter Tabs + Search Row
- Left: pill tabs: "All 7" | "Open 2" | "In Progress 1" | "Waiting 1" | "Resolved 3"
  - Active tab: darker text, underline or filled style
  - Count badge inline in tab label
- Right: search input "Search tickets..." with ⌘K badge

### Ticket List
Each row (click → /tickets/[id]):

```
[Status Badge]  [ID]     [Title + unread dot]     [Tag]    [Time]    [→]
                          [Connector meta below]
```

- Status badge: left-aligned, fixed ~120px, pill shape, color-coded
  - "Waiting on you" — purple pill
  - "In progress" — amber pill
  - "Open" — blue pill
  - "Resolved" — green pill
- Ticket ID: monospaced, 12px, muted
- Title: 15px medium, primary color; **bold** if unread; blue dot left if unread
- Below title: connector meta "Google Sheets · GA4" — 12px muted
- Category tag: small pill right of title "Bug Report", "Feature Request", etc.
- Time: right-aligned, "2h ago" / "Yesterday" / "May 9"
- → chevron: right edge

### Empty States
- No tickets: "No tickets yet." + "Submit your first ticket →" CTA
- No results (search): "No tickets match your search." + clear link
- No results (filter): "No Open tickets." + "View all tickets" link

### Footer
"Showing 7 of 7 tickets" · "Export as CSV" link (blue)

---

## CP-18 — Page 4: Single Ticket View (Customer)

**Route:** `/tickets/[id]`
**Auth:** Required OR magic link (guest token)
**Reference:** `design/screens/04-TicketCustomer.jsx`

### Layout
Two column: Thread (65%) + Sidebar (35%). On mobile: single column.

### Page Header
- Breadcrumb: "My Tickets ›  TMR-1042" — links to /tickets
- Ticket title: 28px bold, wraps max 2 lines
- Status badge + "Copy link" button (top right)
- Meta row: status pill · "Opened May 12, 2025" · "Last activity 2 hours ago"

### Thread (left column)

**Customer message (right-aligned):**
- Label: "You" + timestamp right-aligned
- Avatar: initials circle, right side
- Card: light purple/blue tint bg, 8px radius, right-aligned
- Body: rendered markdown
- Attachments: file chips below body (filename + size)

**Agent reply (left-aligned):**
- Agent name + "from TMR Support" + timestamp
- Optional: "via email" badge (small muted pill)
- Card: white bg, 1px border, 8px radius
- Body: rendered markdown with bold/code support
- CTA chip shown if agent included one (e.g. "I'll test now →")

**System events (centered):**
- "Ticket marked as Open" — centered, 12px muted
- "Linked to GitHub issue #234 · tmr/connectors" — centered, with GitHub icon, linkable
- "Status changed Open → In Progress" — centered, 12px muted

### Reply Composer (bottom of thread)
- Header: "Reply" label left + "Markdown supported" right (muted)
- Textarea: "Write a reply..." placeholder, resizable
- Toolbar: B | I | `code` | link | attach (paperclip)
- Bottom right: "Send" button (blue, icon)
- Disabled if textarea empty

### Sidebar (right column)
Card sections, separated by dividers:

**Section 1 (no label)**
- Status: full badge
- Ticket ID: monospaced, copy icon
- Opened: date
- Category: emoji + label (e.g. "🪲 Bug Report")
- Product: "Google Sheets"
- Connector: "GA4 — Google Analytics"

**Section 2 — Linked Issue**
- Label: "LINKED ISSUE"
- If linked: GitHub icon + "GA4 connector retry burst" + "tmr/connectors#234" + "Open" orange badge
- If not linked: nothing (agents link from dashboard)

**Section 3 — Assigned To**
- Label: "ASSIGNED TO"
- Agent avatar + name + team/role

### States
- Loading: skeleton shimmer for thread and sidebar
- No agent reply yet: thread shows only customer message + "Ticket marked as Open" system event
- Resolved: composer replaced by "This ticket has been resolved. Need more help? Reopen →"
- Magic link (guest): no portal nav, minimal header, "Create account" soft prompt
