# Data Model — TMR Support Platform

This is the source of truth for the database schema.
All Prisma models must match this exactly.

---

## Design Principles

- Every table has `id` (cuid), `createdAt`, `updatedAt`
- Every data table has `orgId` — multi-tenancy at the row level
- Soft deletes on tickets and messages (`deletedAt`)
- All user-facing IDs are cuid (not sequential integers — except ticket number)
- Ticket numbers are human-readable sequential: TMR-1042 (sequential per org)

---

## Full Schema

```prisma
// packages/db/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── ORGANISATIONS ────────────────────────────────────────────────────────────

model Org {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  name      String
  slug      String   @unique   // used in URLs: support.slug.com
  domain    String?  @unique   // custom domain: support.acmecorp.com

  // Brand config (white-label portal)
  brandConfig   BrandConfig?

  // Relations
  users         User[]
  agents        Agent[]
  tickets       Ticket[]
  cannedResponses CannedResponse[]
  githubConfig  GithubConfig?

  @@index([slug])
}

model BrandConfig {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  orgId     String   @unique
  org       Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)

  // Identity
  orgName       String
  logoUrl       String?
  portalTagline String?

  // Colours
  primaryColor  String   @default("#2563EB")
  accentColor   String   @default("#0EA5E9")
  surfaceColor  String   @default("#FFFFFF")

  // Email
  emailDisplayName String  @default("Support")

  // Custom domain (Phase 2 — store now, activate later)
  customDomain  String?
}

// ─── USERS (customers) ────────────────────────────────────────────────────────

model User {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  orgId     String
  org       Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)

  email     String
  name      String?
  avatarUrl String?
  password  String?  // hashed — null if Google SSO only

  // Guest users have no password and no googleId
  // They are identified by email + magic link token
  isGuest      Boolean  @default(false)
  googleId     String?

  // Timestamps
  lastActiveAt DateTime?

  // Relations
  tickets       Ticket[]     @relation("TicketCustomer")
  messages      Message[]    @relation("MessageAuthorUser")
  magicTokens   MagicToken[]
  customerNotes CustomerNote[]

  @@unique([orgId, email])
  @@index([orgId])
  @@index([email])
}

model MagicToken {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  token     String   @unique
  expiresAt DateTime
  usedAt    DateTime?
}

// ─── AGENTS (internal team) ───────────────────────────────────────────────────

model Agent {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  orgId     String
  org       Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)

  email     String
  name      String
  avatarUrl String?
  password  String?  // hashed
  googleId  String?

  role      AgentRole @default(AGENT)

  // Status
  isActive  Boolean  @default(true)
  lastActiveAt DateTime?

  // Invite flow
  inviteToken   String?  @unique
  inviteAccepted Boolean @default(false)

  // Relations
  assignedTickets  Ticket[]   @relation("TicketAssignee")
  messages         Message[]  @relation("MessageAuthorAgent")
  customerNotes    CustomerNote[]

  @@unique([orgId, email])
  @@index([orgId])
}

enum AgentRole {
  ADMIN
  AGENT
}

// ─── TICKETS ──────────────────────────────────────────────────────────────────

model Ticket {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  orgId     String
  org       Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)

  // Human-readable ticket number (sequential per org)
  number    Int
  // Rendered as "TMR-1042" — prefix is org.slug uppercased

  // Core fields
  title     String
  status    TicketStatus  @default(OPEN)
  priority  TicketPriority @default(NORMAL)
  category  TicketCategory

  // Optional classification
  product   String?  // e.g. "Google Sheets", "Hub"
  connector String?  // e.g. "GA4 — Google Analytics"

  // Source tracking
  source    TicketSource  @default(PORTAL)  // PORTAL or EMAIL

  // Customer (owner)
  userId    String
  user      User     @relation("TicketCustomer", fields: [userId], references: [id])

  // Assigned agent
  assigneeId String?
  assignee   Agent?  @relation("TicketAssignee", fields: [assigneeId], references: [id])

  // Email threading
  // reply-to address: reply+{emailThreadId}@support.domain.com
  emailThreadId String  @unique @default(cuid())

  // GitHub
  githubIssue   GithubIssue?

  // Relations
  messages    Message[]
  attachments Attachment[]
  tags        Tag[]

  @@unique([orgId, number])
  @@index([orgId])
  @@index([orgId, status])
  @@index([orgId, userId])
  @@index([orgId, assigneeId])
  @@index([emailThreadId])
}

enum TicketStatus {
  OPEN
  IN_PROGRESS
  WAITING       // Waiting on customer
  RESOLVED
  CLOSED
}

enum TicketPriority {
  NORMAL
  HIGH
  URGENT
}

enum TicketCategory {
  BUG_REPORT
  FEATURE_REQUEST
  QUESTION
  BILLING
  OTHER
}

enum TicketSource {
  PORTAL
  EMAIL
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

model Message {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  ticketId  String
  ticket    Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  type      MessageType  @default(REPLY)
  body      String       // Markdown
  bodyHtml  String?      // Rendered HTML (for email sending)

  // Author — one of these is set, the other is null
  authorUserId  String?
  authorUser    User?   @relation("MessageAuthorUser", fields: [authorUserId], references: [id])

  authorAgentId String?
  authorAgent   Agent?  @relation("MessageAuthorAgent", fields: [authorAgentId], references: [id])

  // Source (for agent messages — were they sent via portal, email, or both?)
  sentVia   MessageSentVia?

  // Internal notes are NOT sent to the customer
  isInternal Boolean  @default(false)

  // Attachments
  attachments Attachment[]

  @@index([ticketId])
  @@index([ticketId, createdAt])
}

enum MessageType {
  REPLY           // Normal reply (customer or agent)
  INTERNAL_NOTE   // Agent-only note
  SYSTEM_EVENT    // Status change, assignment, github link etc.
}

enum MessageSentVia {
  PORTAL
  EMAIL
  PORTAL_AND_EMAIL
}

// ─── SYSTEM EVENTS ────────────────────────────────────────────────────────────
// Stored as Messages with type=SYSTEM_EVENT
// The body field contains a structured string:
// e.g. "status_changed:OPEN:IN_PROGRESS:agent_id"
// e.g. "github_linked:tmr/connectors:#234"
// e.g. "assigned:agent_id"
// Frontend parses and renders these as event pills in the thread

// ─── ATTACHMENTS ──────────────────────────────────────────────────────────────

model Attachment {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  // Belongs to a ticket and optionally a specific message
  ticketId  String
  ticket    Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  messageId String?
  message   Message? @relation(fields: [messageId], references: [id])

  // File info
  filename  String
  mimeType  String
  size      Int      // bytes
  url       String   // MinIO presigned or public URL

  // Link attachments (Loom, Sheets, etc.)
  isLink    Boolean  @default(false)
  linkUrl   String?
}

// ─── TAGS ─────────────────────────────────────────────────────────────────────

model Tag {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  orgId     String
  name      String
  color     String   @default("#71717A")

  tickets   Ticket[]

  @@unique([orgId, name])
}

// ─── GITHUB ───────────────────────────────────────────────────────────────────

model GithubConfig {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  orgId     String   @unique
  org       Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)

  // OAuth
  accessToken   String   // encrypted
  githubUsername String
  githubUserId  String

  // Default repo for new issues
  defaultRepo   String?  // e.g. "tmr/connectors"
}

model GithubIssue {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  ticketId  String   @unique
  ticket    Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  issueNumber Int
  repo        String   // e.g. "tmr/connectors"
  issueUrl    String
  title       String
  state       String   @default("open")  // "open" | "closed"
  reviewers   Int      @default(0)
  daysOpen    Int      @default(0)

  // Last synced from GitHub
  lastSyncedAt DateTime?
}

// ─── CANNED RESPONSES ─────────────────────────────────────────────────────────

model CannedResponse {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  orgId     String
  org       Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)

  name      String   // shortcut name e.g. "rate-limit-fix"
  body      String   // Markdown template
}

// ─── CUSTOMER NOTES ───────────────────────────────────────────────────────────
// Agent-only notes about a specific customer (visible in profile panel)
// Persists across all tickets for that customer

model CustomerNote {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // The customer this note is about
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // The agent who wrote it
  agentId   String
  agent     Agent    @relation(fields: [agentId], references: [id])

  body      String
}
```

---

## Key Relationships Diagram

```
Org
 ├── BrandConfig (1:1)
 ├── GithubConfig (1:1)
 ├── Users (1:many) — customers
 ├── Agents (1:many) — support staff
 ├── Tickets (1:many)
 │    ├── Messages (1:many)
 │    │    └── Attachments (1:many)
 │    ├── Attachments (1:many) — ticket-level attachments
 │    ├── GithubIssue (1:1)
 │    └── Tags (many:many)
 └── CannedResponses (1:many)

User
 ├── Tickets (as customer)
 ├── Messages (as author)
 ├── MagicTokens
 └── CustomerNotes (notes written ABOUT them)

Agent
 ├── Tickets (as assignee)
 ├── Messages (as author)
 └── CustomerNotes (notes written BY them)
```

---

## Ticket Number Generation

Ticket numbers are sequential per org. Implementation:

```sql
-- Get next number for an org
SELECT COALESCE(MAX(number), 0) + 1 as next_number
FROM "Ticket"
WHERE "orgId" = $1;
```

Use a database transaction when creating tickets to prevent race conditions.
The display format is: `{ORG_SLUG_UPPERCASE}-{number}`
e.g. org slug "tmr" → ticket number 1042 → displayed as "TMR-1042"

---

## Multi-Tenancy Rules

1. Every query MUST filter by `orgId` — no exceptions
2. The `orgId` is injected into every request by the org middleware (see architecture.md)
3. Never join across orgs
4. The org is determined by:
   - Subdomain matching (portal/dashboard subdomain → org slug lookup)
   - Or org ID in JWT for API requests
