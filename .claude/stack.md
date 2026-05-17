# Stack — TMR Support Platform

Every technology decision is documented here with the reason.
Do not introduce any package not listed here without human approval.

---

## Monorepo

| Tool | Version | Why |
|---|---|---|
| Turborepo | latest | Fast builds, zero config, pnpm-native, free |
| pnpm | latest | Workspace support, faster than npm/yarn |

---

## Frontend (Both Apps)

| Tool | Version | Why |
|---|---|---|
| Next.js | 15 (App Router) | Battle-tested, large ecosystem, self-hostable with `next start`, SSR |
| React | 18 | Peer dep of Next.js |
| TypeScript | 5 | Strict typing throughout |
| Tailwind CSS | 3 | Utility-first, consistent with design tokens |
| shadcn/ui | latest | Unstyled component base, fully customisable, free |
| Framer Motion | latest | Premium animations and transitions |
| TanStack Query | v5 | Server state, caching, optimistic updates |
| Zustand | latest | Client state (UI state, modals, etc.) |
| React Hook Form | latest | Forms with validation |
| Zod | latest | Schema validation (shared with backend) |
| React Email | latest | Email template components |
| Lucide React | latest | Icon library |

---

## Backend

| Tool | Version | Why |
|---|---|---|
| NestJS | latest | Enterprise-grade, TypeScript-first, battle-tested, modules/DI |
| Node.js | 20 LTS | Stable runtime |
| Prisma | latest | Type-safe ORM, migrations, shared schema in packages/db |
| PostgreSQL | 15 | Robust, scalable, JSONB support for future AI layer |
| Zod | latest | Validation (same schemas shared with frontend via packages/types) |
| Nodemailer | latest | SMTP client — outbound email via Gmail SMTP in dev |
| smtp-server | latest | Inbound SMTP listener (from Nodemailer team) |
| mailparser | latest | Parse raw inbound emails to structured JSON |
| Better Auth | latest | Multi-tenant auth, Google OAuth + email/password, self-hosted |
| Multer | latest | File upload handling |
| MinIO JS SDK | latest | S3-compatible file storage client |
| @octokit/rest | latest | GitHub API client for issue management |
| Bull | latest | Job queue for async tasks (email sending, webhooks) |
| Redis | 7 | Queue backend for Bull |

---

## Infrastructure

| Tool | Why |
|---|---|
| PostgreSQL (Docker) | Primary database |
| MinIO (Docker) | Self-hosted S3-compatible file storage |
| Redis (Docker) | Queue and session backend |
| Nginx | Reverse proxy, routes portal/dashboard/api by subdomain |
| Docker Compose | Orchestrates all services locally and in production |

---

## Dev Tools

| Tool | Why |
|---|---|
| ESLint | Linting (shared config in packages/config) |
| Prettier | Formatting (shared config) |
| Vitest | Unit testing |
| Playwright | E2E testing (Phase 2) |

---

## What We Deliberately Did NOT Use

| Rejected | Reason |
|---|---|
| Vercel | Self-hosted requirement |
| Postmark / Resend / SendGrid | Paid services — using Nodemailer + Gmail SMTP |
| Postal | Overkill — Nodemailer + smtp-server is sufficient |
| Hono | Less mature than NestJS for enterprise structure |
| Remix | Identity uncertainty post-merger with React Router v7 |
| SQLite | No concurrent writes, no multi-user support |
| Cloudflare R2 | Paid — using self-hosted MinIO |
| Firebase / Supabase | External dependency, paid at scale |

---

## Environment Variables Required

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/tmr_support

# Auth
BETTER_AUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_URL=

# Email — Outbound (dev: Gmail SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=support@twominutereports.com

# Email — Inbound
INBOUND_SMTP_PORT=2525

# File Storage (MinIO)
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=tmr-support

# GitHub
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=

# Redis
REDIS_URL=redis://localhost:6379

# App
API_URL=http://localhost:3001
PORTAL_URL=http://localhost:3000
DASHBOARD_URL=http://localhost:3002
NODE_ENV=development
```
