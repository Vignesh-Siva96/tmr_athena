# API Contracts — TMR Support Platform

All API endpoints, request shapes, and response shapes.
Base URL: `/api/v1`
All endpoints require `X-Org-ID` header unless marked [public].

---

## Auth

### POST /auth/signup
Create a new customer account.
```typescript
// Request
{ email: string, password: string, name?: string }

// Response 201
{ user: User, token: string }

// Errors
400: validation | 409: email already exists
```

### POST /auth/signin
```typescript
// Request
{ email: string, password: string }

// Response 200
{ user: User, token: string }

// Errors
400: validation | 401: invalid credentials
```

### POST /auth/google
Google OAuth token exchange.
```typescript
// Request
{ code: string, redirectUri: string }

// Response 200
{ user: User, token: string, isNew: boolean }
```

### POST /auth/guest
Create a guest session (no account required).
```typescript
// Request
{ email: string }

// Response 201
{ guestToken: string, email: string }
// guestToken is a short-lived JWT for submitting one ticket
```

### POST /auth/magic-link
Send magic link to guest email for ticket tracking.
```typescript
// Request
{ email: string, ticketId: string }

// Response 200
{ sent: true }
```

### POST /auth/agent/signin
Agent sign in (separate from customer auth).
```typescript
// Request
{ email: string, password: string }

// Response 200
{ agent: Agent, token: string }
```

### POST /auth/agent/google
Agent Google OAuth.
```typescript
// Request
{ code: string }
// Response 200
{ agent: Agent, token: string }
```

---

## Orgs

### GET /orgs/current
Get current org (resolved from X-Org-ID header).
```typescript
// Response 200
{ org: Org, brandConfig: BrandConfig }
```

### PATCH /orgs/current [Admin only]
Update org settings.
```typescript
// Request (all optional)
{
  name?: string
  brandConfig?: {
    orgName?: string
    logoUrl?: string
    portalTagline?: string
    primaryColor?: string
    accentColor?: string
    emailDisplayName?: string
  }
}

// Response 200
{ org: Org, brandConfig: BrandConfig }
```

### POST /orgs/current/logo [Admin only]
Upload org logo. Multipart form data.
```typescript
// Request: multipart/form-data, field: "logo"
// Response 200
{ logoUrl: string }
```

---

## Tickets

### GET /tickets
List tickets. For customers: returns their own tickets only. For agents: returns all.
```typescript
// Query params
{
  status?: TicketStatus
  category?: TicketCategory
  assigneeId?: string
  search?: string
  limit?: number  // default 25, max 100
  offset?: number
  sortBy?: 'createdAt' | 'updatedAt'  // default updatedAt
  sortOrder?: 'asc' | 'desc'          // default desc
}

// Response 200
{
  data: TicketListItem[]
  meta: { total: number, limit: number, offset: number }
}

// TicketListItem
{
  id: string
  number: number              // raw number
  displayId: string           // e.g. "TMR-1042"
  title: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory
  product?: string
  connector?: string
  assignee?: { id: string, name: string, avatarUrl?: string }
  user: { id: string, name?: string, email: string }
  tags: Tag[]
  lastMessage?: { body: string, createdAt: string }
  hasUnreadReply: boolean     // for customers: unread agent reply
  createdAt: string
  updatedAt: string
}
```

### POST /tickets
Create a new ticket.
```typescript
// Request
{
  title: string              // required, max 120 chars
  category: TicketCategory   // required
  product?: string
  connector?: string
  description?: string       // becomes first message body
  attachmentIds?: string[]   // pre-uploaded attachment IDs
  linkUrl?: string           // Loom / Sheets link
  // Guest only:
  guestEmail?: string
}

// Response 201
{
  ticket: Ticket
  displayId: string          // "TMR-1042"
}
```

### GET /tickets/:id
Get single ticket with full thread.
```typescript
// Response 200
{
  ticket: {
    ...TicketListItem,
    emailThreadId: string
    githubIssue?: GithubIssue
    messages: Message[]
    attachments: Attachment[]
  }
}

// Errors
404: not found | 403: wrong org or not ticket owner
```

### PATCH /tickets/:id
Update ticket metadata. Agents only (except customers can add replies via messages endpoint).
```typescript
// Request (all optional)
{
  title?: string
  status?: TicketStatus
  priority?: TicketPriority
  assigneeId?: string | null
  category?: TicketCategory
  product?: string
  connector?: string
  tagIds?: string[]
}

// Response 200
{ ticket: Ticket }
// Side effect: creates SYSTEM_EVENT message for status/assignee changes
```

### DELETE /tickets/:id [Admin only]
Soft delete.
```typescript
// Response 200
{ success: true }
```

---

## Messages

### POST /tickets/:id/messages
Add a message to a ticket thread.
```typescript
// Request
{
  body: string               // Markdown
  type?: 'REPLY' | 'INTERNAL_NOTE'  // default REPLY
  attachmentIds?: string[]
  // Agent only:
  sendVia?: 'PORTAL' | 'EMAIL' | 'PORTAL_AND_EMAIL'  // default PORTAL_AND_EMAIL
}

// Response 201
{ message: Message }
// Side effects:
//   - If type=REPLY and agent: sends email to customer
//   - If type=REPLY and customer: notifies agents
//   - If status should change (e.g. agent replies → WAITING): auto-updates ticket
```

### PATCH /tickets/:id/messages/:messageId [Agent only]
Edit a message (within 5 minutes of creation).
```typescript
// Request
{ body: string }
// Response 200
{ message: Message }
```

---

## Agents

### GET /agents
List all agents in org.
```typescript
// Response 200
{
  data: {
    id: string
    email: string
    name: string
    avatarUrl?: string
    role: AgentRole
    isActive: boolean
    lastActiveAt?: string
    inviteAccepted: boolean
  }[]
}
```

### POST /agents/invite [Admin only]
Invite a new agent.
```typescript
// Request
{ email: string, name: string, role: AgentRole }
// Response 201
{ agent: Agent }
// Side effect: sends invite email with invite link
```

### PATCH /agents/:id [Admin only]
Update agent role or status.
```typescript
// Request
{ role?: AgentRole, isActive?: boolean }
// Response 200
{ agent: Agent }
```

### DELETE /agents/:id [Admin only]
Remove agent from org.
```typescript
// Response 200
{ success: true }
```

---

## Users (Customer profiles — agents only)

### GET /users/:id
Get customer profile with stats and ticket history.
```typescript
// Response 200
{
  user: User,
  stats: {
    totalTickets: number
    openTickets: number
    avgReplyTime?: number   // minutes — null if < 2 tickets
    satisfaction?: number   // Phase 2
  },
  recentTickets: TicketListItem[]  // last 12
  notes: CustomerNote[]
}
```

### POST /users/:id/notes [Agent only]
Add an internal note about a customer.
```typescript
// Request
{ body: string }
// Response 201
{ note: CustomerNote }
```

### PATCH /users/:id/notes/:noteId [Agent only]
```typescript
// Request
{ body: string }
// Response 200
{ note: CustomerNote }
```

### DELETE /users/:id/notes/:noteId [Agent only]
```typescript
// Response 200
{ success: true }
```

---

## File Uploads

### POST /files/upload
Upload a file. Returns attachment ID for use in ticket/message creation.
```typescript
// Request: multipart/form-data
// Field: "file" (max 10MB)
// OR: { linkUrl: string } for link attachments

// Response 201
{
  attachment: {
    id: string
    filename: string
    mimeType: string
    size: number
    url: string
    isLink: boolean
  }
}
```

---

## GitHub

### GET /github/status
Check if GitHub is connected for this org.
```typescript
// Response 200
{
  connected: boolean
  username?: string
  defaultRepo?: string
}
```

### POST /github/connect [Admin only]
Connect GitHub via OAuth.
```typescript
// Request
{ code: string }
// Response 200
{ connected: true, username: string }
```

### DELETE /github/connect [Admin only]
Disconnect GitHub.
```typescript
// Response 200
{ success: true }
```

### PATCH /github/config [Admin only]
```typescript
// Request
{ defaultRepo: string }
// Response 200
{ config: GithubConfig }
```

### POST /tickets/:id/github/issues
Create a new GitHub issue from a ticket.
```typescript
// Request
{ repo?: string }  // overrides defaultRepo
// Response 201
{ issue: GithubIssue }
```

### POST /tickets/:id/github/link
Link an existing GitHub issue to a ticket.
```typescript
// Request
{ repo: string, issueNumber: number }
// Response 200
{ issue: GithubIssue }
```

### DELETE /tickets/:id/github/link
Unlink GitHub issue.
```typescript
// Response 200
{ success: true }
```

---

## Canned Responses [Agent only]

### GET /canned-responses
```typescript
// Response 200
{ data: CannedResponse[] }
```

### POST /canned-responses [Admin only]
```typescript
// Request
{ name: string, body: string }
// Response 201
{ response: CannedResponse }
```

---

## Shared Types

```typescript
// From packages/types

interface Ticket {
  id: string
  orgId: string
  number: number
  displayId: string
  title: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory
  product?: string
  connector?: string
  source: TicketSource
  userId: string
  assigneeId?: string
  emailThreadId: string
  createdAt: string
  updatedAt: string
}

interface Message {
  id: string
  ticketId: string
  type: MessageType
  body: string
  bodyHtml?: string
  authorUserId?: string
  authorAgentId?: string
  isInternal: boolean
  sentVia?: MessageSentVia
  attachments: Attachment[]
  createdAt: string
  updatedAt: string
  // Populated relations
  authorUser?: Pick<User, 'id' | 'name' | 'email' | 'avatarUrl'>
  authorAgent?: Pick<Agent, 'id' | 'name' | 'email' | 'avatarUrl'>
}

interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  url: string
  isLink: boolean
  linkUrl?: string
}

interface GithubIssue {
  id: string
  ticketId: string
  issueNumber: number
  repo: string
  issueUrl: string
  title: string
  state: 'open' | 'closed'
  reviewers: number
  daysOpen: number
}
```
