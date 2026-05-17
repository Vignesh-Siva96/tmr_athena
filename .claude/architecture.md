# Architecture — TMR Support Platform

How all services connect, communicate, and deploy.

---

## Services Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Nginx (reverse proxy)                 │
│  support.tmr.com → portal:3000                              │
│  dash.tmr.com    → dashboard:3002                           │
│  api.tmr.com     → api:3001                                 │
└──────────────┬───────────────┬─────────────────────────────┘
               │               │
   ┌───────────▼──┐  ┌─────────▼────────┐  ┌──────────────┐
   │ Portal        │  │ Dashboard         │  │ API           │
   │ Next.js :3000 │  │ Next.js :3002     │  │ NestJS :3001  │
   │ (light theme) │  │ (dark theme)      │  │               │
   └───────────────┘  └──────────────────┘  └──────┬────────┘
                                                    │
                          ┌─────────────────────────┼──────────────────────┐
                          │                          │                       │
               ┌──────────▼──┐          ┌───────────▼──┐     ┌─────────────▼──┐
               │ PostgreSQL   │          │ MinIO         │     │ Redis           │
               │ :5432        │          │ :9000         │     │ :6379           │
               └─────────────┘          └──────────────┘     └────────────────┘
```

---

## Request Flow — Customer Creates a Ticket

```
1. Customer visits support.acmecorp.com
2. Nginx routes to portal (Next.js :3000)
3. Portal middleware reads subdomain → determines org slug → fetches brand config
4. Portal renders with org brand (logo, colors, name)
5. Customer fills form → POST /api/tickets
6. API validates request, checks auth (guest or user JWT)
7. API creates Ticket + Message in PostgreSQL (transaction)
8. API queues email job in Redis/Bull
9. Bull worker sends confirmation email via Nodemailer → Gmail SMTP
10. API returns ticket data to portal
11. Portal shows confirmation state with ticket ID (TMR-1042)
```

---

## Request Flow — Agent Replies

```
1. Agent in dashboard types reply → POST /api/tickets/:id/messages
2. API creates Message record
3. API queues email job: send reply to customer's email
4. Bull worker sends email via Nodemailer (from: support@tmr.com)
   Reply-To: reply+{emailThreadId}@support.tmr.com
5. Customer receives email, replies
6. Email arrives at SMTP listener (smtp-server on port 25 or 2525)
7. smtp-server receives email → mailparser parses it
8. Parser extracts emailThreadId from Reply-To address or subject
9. API looks up ticket by emailThreadId
10. Creates new Message record (authorUserId = ticket.userId)
11. Dashboard updates in real time (polling or websocket Phase 2)
```

---

## Multi-Tenancy Architecture

```
Request → Nginx → App
              ↓
         Extract subdomain
              ↓
         Look up Org by slug
              ↓
         Inject org into request context
              ↓
         All queries filter by orgId
```

### Org Resolution

- Portal/Dashboard: subdomain → org slug
  - `support.acmecorp.com` → slug `acmecorp`
  - `support.tmr.com` → slug `tmr` (default)
- API: reads `X-Org-ID` header (set by portal/dashboard) or extracts from JWT

### Data Isolation

Every table has `orgId`. The NestJS org middleware:
1. Resolves org from request
2. Attaches org to request context
3. All service methods receive `orgId` as first parameter
4. Prisma client is wrapped to always include `where: { orgId }`

---

## NestJS Module Structure

```
apps/api/src/
├── main.ts
├── app.module.ts
├── modules/
│   ├── auth/           ← Better Auth integration, JWT, Google OAuth
│   ├── orgs/           ← Org CRUD, brand config, org middleware
│   ├── tickets/        ← Ticket CRUD, status changes, search
│   ├── messages/       ← Thread messages, internal notes, system events
│   ├── agents/         ← Agent management, invites, roles
│   ├── users/          ← Customer user management
│   ├── files/          ← MinIO upload, presigned URLs
│   ├── email/          ← Outbound (Nodemailer), inbound (smtp-server)
│   ├── github/         ← OAuth, issue create/link, sync
│   └── queue/          ← Bull queue setup, job processors
└── common/
    ├── decorators/     ← @CurrentOrg, @CurrentAgent, @CurrentUser
    ├── guards/         ← AuthGuard, AgentGuard, OrgGuard
    ├── filters/        ← Global exception filter
    ├── interceptors/   ← Logging, transform response
    └── pipes/          ← Zod validation pipe
```

---

## Next.js App Structure

```
apps/portal/src/
├── app/
│   ├── layout.tsx          ← Root layout, brand config provider
│   ├── page.tsx            ← Redirect to /submit
│   ├── submit/
│   │   └── page.tsx        ← Page 1: Submit ticket
│   ├── auth/
│   │   └── page.tsx        ← Page 2: Sign in / Sign up
│   ├── tickets/
│   │   ├── page.tsx        ← Page 3: My tickets list
│   │   └── [id]/
│   │       └── page.tsx    ← Page 4: Single ticket view
│   └── api/
│       └── [...]/route.ts  ← API routes (proxy to NestJS)
├── components/
│   ├── ui/                 ← Imported from packages/ui
│   └── portal/             ← Portal-specific components
├── lib/
│   ├── api.ts              ← API client (TanStack Query)
│   ├── auth.ts             ← Better Auth client
│   └── brand.ts            ← Brand config context
└── middleware.ts            ← Subdomain → org resolution

apps/dashboard/src/
├── app/
│   ├── layout.tsx          ← Root layout, dark theme, sidebar
│   ├── page.tsx            ← Redirect to /inbox
│   ├── inbox/
│   │   └── page.tsx        ← Page 5: Inbox
│   ├── tickets/
│   │   └── [id]/
│   │       └── page.tsx    ← Page 6: Ticket detail
│   └── settings/
│       ├── page.tsx        ← General settings
│       ├── branding/
│       │   └── page.tsx    ← Page 8: Branding
│       ├── agents/
│       │   └── page.tsx    ← Agents management
│       └── github/
│           └── page.tsx    ← GitHub integration
└── components/
    ├── ui/                 ← Imported from packages/ui
    ├── dashboard/          ← Dashboard-specific components
    │   ├── sidebar.tsx     ← Persistent left sidebar
    │   ├── ticket-table.tsx
    │   ├── quick-preview.tsx
    │   └── thread.tsx
    └── customer-profile/   ← Page 7: Slide-over
        └── profile-panel.tsx
```

---

## Shared Packages

```
packages/
├── ui/
│   ├── src/
│   │   ├── components/     ← All shadcn/ui components + custom
│   │   └── index.ts
│   └── package.json
├── db/
│   ├── prisma/
│   │   └── schema.prisma   ← Source of truth — see data-model.md
│   ├── src/
│   │   └── index.ts        ← Exports PrismaClient singleton
│   └── package.json
├── types/
│   ├── src/
│   │   ├── ticket.ts       ← Shared ticket types + Zod schemas
│   │   ├── user.ts
│   │   ├── agent.ts
│   │   ├── org.ts
│   │   └── index.ts
│   └── package.json
├── email/
│   ├── src/
│   │   ├── templates/
│   │   │   ├── ticket-confirmation.tsx
│   │   │   ├── agent-reply.tsx
│   │   │   └── agent-invite.tsx
│   │   └── index.ts
│   └── package.json
└── config/
    ├── eslint/
    ├── typescript/
    └── tailwind/
```

---

## Docker Compose Services

```yaml
services:
  postgres:   image: postgres:15, port 5432
  redis:      image: redis:7-alpine, port 6379
  minio:      image: minio/minio, ports 9000+9001
  api:        build ./apps/api, port 3001, depends: postgres, redis, minio
  portal:     build ./apps/portal, port 3000, depends: api
  dashboard:  build ./apps/dashboard, port 3002, depends: api
  nginx:      image: nginx, ports 80+443, depends: portal, dashboard, api
```

---

## Email Architecture Detail

### Outbound (agent → customer)

```
Agent sends reply
  → NestJS messages.service creates Message
  → Queues EmailJob in Bull
  → Bull worker: email.service.sendReply()
  → Nodemailer → Gmail SMTP
  → Sent from: "Acme Corp Support <support@tmr.com>"
  → Reply-To: reply+{ticket.emailThreadId}@support.tmr.com
  → Subject: "[TMR-1042] GA4 connector failing..."
```

### Inbound (customer email reply → ticket thread)

```
Customer hits Reply in Gmail
  → Email sent to reply+{emailThreadId}@support.tmr.com
  → smtp-server receives on port 2525 (behind MX record)
  → mailparser parses raw email
  → Extract emailThreadId from envelope To address
  → Look up ticket by emailThreadId
  → Extract text body (strip quoted previous messages)
  → Create new Message on ticket (authorUserId = ticket.userId)
  → Notify agents (queue notification job)
```
