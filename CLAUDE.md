# CLAUDE.md — TMR Support Platform

You are building **TMR Support Platform** — a multi-tenant customer support ticketing system
for Two Minute Reports (TMR). Read this file fully before doing anything else.

> **STATE.md is the living source of truth.** Read `STATE.md` at the start of every session
> to understand the current state of the app, architecture decisions, and known issues.
> Update `STATE.md` at the end of every session — feature statuses, decisions made, issues found.

---

## 1. What You Are Building

A self-hosted, white-label support platform with two surfaces:
- **Customer Portal** — where TMR customers submit and track tickets (light theme)
- **Agent Dashboard** — where TMR support agents manage tickets (dark theme)

This is a multi-tenant SaaS platform. Every data record belongs to an `org`.
TMR is the first and only org for now, but the architecture must support multiple orgs.

**Phase 1 scope only.** Do not build anything outside Phase 1. See checkpoint list below.

---

## 2. Always Read These First

Before writing any code for a feature, read the relevant spec file:

| What you need | Read this file |
|---|---|
| Tech stack, dependencies, why each was chosen | `.claude/stack.md` |
| Database schema, all tables and relationships | `.claude/data-model.md` |
| All API endpoints, request/response shapes | `.claude/api-contracts.md` |
| Folder structure, naming, code style rules | `.claude/conventions.md` |
| Design tokens, colors, fonts, spacing | `.claude/design-system.md` |
| Architecture, how services connect | `.claude/architecture.md` |
| Portal page specs (all 4 pages) | `apps/portal/SPECS.md` |
| Dashboard page specs (all 4 pages) | `apps/dashboard/SPECS.md` |
| Design reference screens | `design/screens/` (JSX files) |
| Design tokens source of truth | `design/tokens.css` |

---

## 3. Non-Negotiable Rules

- **Never invent dependencies.** Only use packages listed in `.claude/stack.md`.
- **Never invent colors or fonts.** Only use tokens from `design/tokens.css`.
- **Never build Phase 2 features.** If something is marked Phase 2, skip it entirely.
- **Always check the data model** before creating any database query or migration.
- **Always check the API contract** before creating any endpoint or API call.
- **Always use shared UI components** from `packages/ui` — never duplicate components.
- **Never hardcode org-specific values.** Everything org-related comes from the org config.
- **Write TypeScript strictly.** No `any` types. No ts-ignore unless absolutely necessary with comment.
- **Follow the checkpoint system.** Mark checkpoints complete in `PROGRESS.md` as you finish them.

---

## 4. Checkpoint System

Work is divided into checkpoints. Each checkpoint is a self-contained unit of work
that can be completed in one Claude Code session.

**At the start of every session:**
1. Read `PROGRESS.md` to see which checkpoints are done
2. Read this `CLAUDE.md` fully
3. Read the spec files relevant to your current checkpoint
4. Start from the first incomplete checkpoint

**At the end of every session:**
1. Update `PROGRESS.md` — mark completed checkpoints with ✅
2. Write a brief note about what was done and any decisions made
3. Note any blockers or questions for the next session

**If you hit an ambiguity not covered in the spec files:**
- If minor: make the most logical decision and note it in `PROGRESS.md`
- If major: stop, write the question in `PROGRESS.md` under "QUESTIONS", and wait

---

## 5. Phase 1 Checkpoints — Master List

### FOUNDATION
- [ ] **CP-01** — Monorepo scaffold (Turborepo + pnpm workspaces, all apps and packages created)
- [ ] **CP-02** — Shared config packages (TypeScript, ESLint, Tailwind configs)
- [ ] **CP-03** — Database setup (PostgreSQL connection, Prisma schema from data-model.md, first migration)
- [ ] **CP-04** — Shared UI package scaffold (install shadcn/ui base, import tokens.css, verify design tokens load)

### BACKEND — CORE
- [ ] **CP-05** — NestJS app scaffold (modules structure, global config, health check endpoint)
- [ ] **CP-06** — Auth module (Better Auth, Google OAuth + email/password, JWT sessions, multi-tenant middleware)
- [ ] **CP-07** — Org module (CRUD, brand config, org middleware that injects org into every request)
- [ ] **CP-08** — Tickets module (create, read, update, list — all endpoints from api-contracts.md)
- [ ] **CP-09** — Messages module (thread messages, internal notes, system events)
- [ ] **CP-10** — File upload module (MinIO integration, presigned URLs, attachment records)
- [ ] **CP-11** — Email module (Nodemailer + Gmail SMTP outbound, inbound webhook parser, reply-to-ticket routing)
- [ ] **CP-12** — GitHub module (OAuth connect, create issue, link issue to ticket)
- [ ] **CP-13** — Agents module (invite, list, assign, roles)

### CUSTOMER PORTAL
- [ ] **CP-14** — Portal Next.js app scaffold (routing structure, layout, nav, brand config loading)
- [ ] **CP-15** — Page 1: Submit Ticket (form, guest flow, category selector, file upload, confirmation state)
- [ ] **CP-16** — Page 2: Sign In / Sign Up (Google SSO, email+password, guest continue flow)
- [ ] **CP-17** — Page 3: My Tickets list (filter tabs, search, ticket rows, empty states)
- [ ] **CP-18** — Page 4: Single Ticket View — customer (thread, reply composer, metadata sidebar, all states)

### AGENT DASHBOARD
- [ ] **CP-19** — Dashboard Next.js app scaffold (routing, dark theme layout, persistent sidebar nav)
- [ ] **CP-20** — Page 5: Inbox (ticket list table, filters, quick preview panel, bulk actions)
- [ ] **CP-21** — Page 6: Ticket Detail — agent (thread, internal notes, reply composer, GitHub sidebar)
- [ ] **CP-22** — Page 7: Customer Profile slide-over panel (account overview, ticket history, internal notes)
- [ ] **CP-23** — Page 8: Settings (General, Branding with live preview, Agents, GitHub integration)

### INTEGRATION & POLISH
- [ ] **CP-24** — Wire portal to API (all portal pages fully connected to real backend data)
- [ ] **CP-25** — Wire dashboard to API (all dashboard pages fully connected to real backend data)
- [ ] **CP-26** — Email flow end-to-end test (submit ticket → email sent → reply → appears in thread)
- [ ] **CP-27** — Multi-tenancy smoke test (two orgs, verify data isolation, brand config switching)
- [ ] **CP-28** — Docker Compose setup (all services: api, portal, dashboard, postgres, minio, nginx)
- [ ] **CP-29** — Seed data script (create default org, admin agent, sample tickets for dev)

---

## 6. Project Structure

```
/
├── CLAUDE.md                  ← You are here
├── PROGRESS.md                ← Checkpoint tracking (create this on CP-01)
├── .claude/
│   ├── stack.md
│   ├── data-model.md
│   ├── api-contracts.md
│   ├── conventions.md
│   ├── design-system.md
│   └── architecture.md
├── apps/
│   ├── portal/                ← Customer portal (Next.js)
│   │   └── SPECS.md
│   ├── dashboard/             ← Agent dashboard (Next.js)
│   │   └── SPECS.md
│   └── api/                   ← Backend (NestJS)
├── packages/
│   ├── ui/                    ← Shared React components
│   ├── db/                    ← Prisma schema + client
│   ├── types/                 ← Shared TypeScript types
│   ├── email/                 ← Email templates (React Email)
│   └── config/                ← Shared ESLint, TS, Tailwind configs
├── design/
│   ├── tokens.css             ← Source of truth for all design tokens
│   └── screens/               ← Reference JSX from Claude Design
│       ├── 01-Submit.jsx
│       ├── 02-Auth.jsx
│       ├── 03-MyTickets.jsx
│       ├── 04-TicketCustomer.jsx
│       ├── 05-AgentInbox.jsx
│       ├── 06-AgentTicket.jsx
│       ├── 07-CustomerProfile.jsx
│       └── 08-Settings.jsx
└── docker/
    ├── docker-compose.yml
    └── nginx.conf
```

---

## 7. Current Phase

**Phase 1** — Core ticketing platform with email + GitHub integration.
No AI features. No customer analysis. No churn detection. Those are Phase 2.
