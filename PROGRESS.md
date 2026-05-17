# PROGRESS.md — TMR Support Platform

This file is updated by Claude Code at the end of every session.
Read this first at the start of every new session.

---

## Checkpoint Status

### FOUNDATION
- ✅ CP-01 — Monorepo scaffold
- ✅ CP-02 — Shared config packages
- ✅ CP-03 — Database setup
- ✅ CP-04 — Shared UI package scaffold

### BACKEND — CORE
- ✅ CP-05 — NestJS app scaffold
- ✅ CP-06 — Auth module
- ✅ CP-07 — Org module
- ✅ CP-08 — Tickets module
- ✅ CP-09 — Messages module
- ✅ CP-10 — File upload module
- ✅ CP-11 — Email module
- ✅ CP-12 — GitHub module
- ✅ CP-13 — Agents module

### CUSTOMER PORTAL
- ✅ CP-14 — Portal Next.js scaffold
- ✅ CP-15 — Page 1: Submit Ticket
- ✅ CP-16 — Page 2: Sign In / Sign Up
- ✅ CP-17 — Page 3: My Tickets list
- ✅ CP-18 — Page 4: Single Ticket View (customer)

### AGENT DASHBOARD
- ✅ CP-19 — Dashboard Next.js scaffold
- ✅ CP-20 — Page 5: Inbox
- ✅ CP-21 — Page 6: Ticket Detail (agent)
- ✅ CP-22 — Page 7: Customer Profile panel
- ✅ CP-23 — Page 8: Settings

### INTEGRATION & POLISH
- ✅ CP-24 — Wire portal to API (all portal pages call real API via api.ts)
- ✅ CP-25 — Wire dashboard to API (all dashboard pages call real API via api.ts)
- ⏳ CP-26 — Email flow end-to-end test (requires live PostgreSQL + SMTP)
- ⏳ CP-27 — Multi-tenancy smoke test (requires live database + two orgs)
- ✅ CP-28 — Docker Compose setup
- ✅ CP-29 — Seed data script

---

## Session Log

### Session 1 — 2026-05-16
**Completed:** CP-01, CP-02, CP-03, CP-04
**Decisions made:**
- Added `pnpm.onlyBuiltDependencies` to root `package.json`
- Prisma client generated successfully (v5.22.0); no DB connection required for generation
**Blockers / Questions:** —

### Session 2 — 2026-05-16
**Completed:** CP-05, CP-06, CP-07, CP-08, CP-09, CP-10, CP-11, CP-12, CP-13
**Decisions made:**
- Auth uses Node.js built-in `crypto` (scrypt for passwords, HMAC-SHA256 for JWT)
- Google OAuth: native `https` module for token exchange, no googleapis package
- MinIO: uses named `Client` import; `minio` package added to @tmr/api
- Email: `nodemailer` + `smtp-server` + `mailparser` added; inbound SMTP on port 2525
- GitHub: `@octokit/rest` added; OAuth code exchange via native https
- File upload: memory storage via multer; presigned MinIO URLs (7 days)
- Auto status transitions on messages: OPEN→IN_PROGRESS on first agent reply, IN_PROGRESS→WAITING on subsequent, WAITING→IN_PROGRESS on customer reply
- All 11 modules compile cleanly; `dist/modules/` has all 11 directories
**Blockers / Questions:** —

### Session 3 — 2026-05-16
**Completed:** CP-14 through CP-25, CP-28, CP-29
**Decisions made:**
- tsconfig.json for both apps made standalone (no @tmr/config extend) — Next.js moduleResolution=bundler incompatible with workspace-linked TS config files
- tailwind.config.ts inlined (same reason — @tmr/config/tailwind can't be imported as TS file without compilation)
- auth.ts and brand.ts renamed to .tsx (they contain JSX for context providers)
- Portal auth: localStorage-based JWT (simple, no cookie-session complexity for Phase 1)
- Dashboard auth: same pattern, separate localStorage keys
- CP-26/27: marked ⏳ — these are runtime integration tests requiring live Docker stack; code is wired and ready, tests must be run manually
- Seed script at packages/db/src/seed.ts — run with `pnpm --filter @tmr/db db:seed` after DB is up
- Docker Compose in docker/ with Dockerfiles for all three apps + nginx + postgres + redis + minio
**Blockers / Questions:** —

---

## To run the full stack

```bash
# 1. Start infrastructure
cd docker && docker compose up postgres redis minio -d

# 2. Run DB migration
cd /home/vignesh/Development/athena
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tmr_support \
  pnpm --filter @tmr/db exec prisma migrate dev --name init

# 3. Seed data
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tmr_support \
  pnpm --filter @tmr/db db:seed

# 4. Start API
cp .env.example .env  # fill in SMTP credentials
pnpm --filter @tmr/api dev

# 5. Start portal
NEXT_PUBLIC_API_URL=http://localhost:3001 NEXT_PUBLIC_ORG_ID=<org-id-from-seed> \
  pnpm --filter @tmr/portal dev

# 6. Start dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001 NEXT_PUBLIC_ORG_ID=<org-id-from-seed> \
  pnpm --filter @tmr/dashboard dev
```

Dashboard login: admin@twominutereports.com / admin123
Portal login:    jordan@acmecorp.com / customer123

---

## QUESTIONS (blocking — needs human answer before proceeding)

_None._

---

## DECISIONS LOG

See session notes above.
