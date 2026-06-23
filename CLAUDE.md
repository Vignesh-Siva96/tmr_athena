# CLAUDE.md — TMR Support Platform

**TMR Support Platform** is a self-hosted, **single-tenant** customer support ticketing system for
Two Minute Reports (TMR), with AI assistance (first-responder bot, ticket analysis, customer
intelligence). Two frontends — Customer **Portal** (`apps/portal`, light theme) and Agent
**Dashboard** (`apps/bridge`, dark theme; the directory is `bridge`). Backend is NestJS (`apps/api`).

Because it is single-tenant there is **no `Org` model and no `orgId`** on records — instance-wide
settings, branding, and integration credentials live in a single-row **`AppConfig`**
(`apps/api/src/modules/config`). Multi-tenancy was deliberately dropped (see the Decisions table in
[`STATE.md`](STATE.md)). A dead `apps/api/src/modules/orgs` directory still exists but is **not**
wired into `app.module.ts` — ignore it.

Authoritative references: [`docs/atlas/`](docs/atlas/) for per-feature detail (current) and
[`STATE.md`](STATE.md) for decision history.

---

## 🔴 Debugging rule — watch logs before guessing

When the user reports a runtime issue (email not arriving, poll not firing, API error, anything behavioural that isn't a compile error):

1. **Open the live log first** before reading code or forming a hypothesis:
   ```bash
   tail -f apps/api/logs/app-$(date +%Y-%m-%d).log | jq -r '"\(.ts) [\(.level)] \(.context): \(.msg)"'
   ```
2. Ask the user to reproduce the issue **while the log is tailing**.
3. Read what actually happened — then fix the real cause, not the assumed one.

Logs rotate daily: `apps/api/logs/app-YYYY-MM-DD.log`. Each line is a JSON record `{ts, level, context, msg}`.

---

## 🔴 Documentation rule — do this without being told

Two docs travel with the code. Keep both current as part of shipping a change.
**Treat them as part of "done." A task is not finished until they're updated.**

| File | What it captures | When to update |
|---|---|---|
| [`STATE.md`](STATE.md) | History — decisions, known issues, session-by-session changelog | At the end of every session (always) + when a decision is made |
| [`docs/atlas/`](docs/atlas/) | Present state — per-feature reference (stack, flow, key files) | When you materially change a feature (see triggers below) |

### Before reporting a task complete, run this 30-second checklist

1. **Touched any feature behavior, flow, or dependency?** → Edit the matching `docs/atlas/<feature>.md`.
2. **Added/renamed a controller endpoint, NestJS module, or Prisma model?** → Run `pnpm atlas:gen` to refresh `docs/atlas/_generated/`.
3. **Made an architecture decision or hit a non-obvious gotcha?** → Add a row to the Decisions table in STATE.md.
4. **About to say "done" or end the session?** → Append a Session Log entry to STATE.md summarizing what changed.
5. **Touched any service method, controller route, or schema field?** → Add or update the matching test in `tests/integration/`, `tests/e2e/`, or `tests/unit/`. If you fixed a bug, add a row to `tests/regression-catalogue.md` and a named test that fails on the pre-fix code. See [tests/README.md](tests/README.md) for the framework.
6. **Changed a `package.json` script, a port, or added/removed a top-level dir or module?** → Update §4 Commands / §5 Project Structure in this file.
7. **Touched any feature behavior, flow, module, table, route, queue, or external integration?** →
   update [`worldgraph/atlas.world.json`](worldgraph/atlas.world.json) (the node's dossier + its
   `index` entry + `connects`), then run `tsx worldgraph/validate.ts` (or `pnpm worldgraph:check`
   from the repo root). See [`worldgraph/README.md`](worldgraph/README.md) for the label grammar.

If none apply, say "no docs/tests needed" explicitly so it's clear you checked.

### What counts as a "material change" to a feature

- New endpoint, new NestJS module, new external dependency
- A change in data flow (added a queue, swapped a library, removed a service)
- A non-obvious decision someone will want to find later
- A new known gap or limitation

### What does NOT trigger a docs update

- Typos, formatting, internal renames with no external surface
- One-line bug fixes where the feature behaves the same after as before
- Reverting a change that hasn't shipped

`docs/atlas/_generated/` is never edited by hand — only `pnpm atlas:gen` writes there.

Keeping the hand-written docs (atlas feature pages + STATE.md) current is a discipline, not a
gate — **the user has explicitly asked not to have to remind us.** Note that two pieces of this
*are* enforced in CI (`.github/workflows/test.yml`): the generated atlas (`_generated/`) via an
atlas-drift check, and test coverage via a `coverage-gate` job that fails on a line-coverage drop
> 0.5% vs `master`. Run `pnpm atlas:gen` and add tests before pushing, or the build breaks.

---

## 1. Always Read These First

For "how it works now," trust this order: **(1) the code, (2) `docs/atlas/` + `_generated/`,
(3) `STATE.md` decisions.** Start at [`docs/atlas/README.md`](docs/atlas/README.md). `.claude/`
now holds only `conventions.md` + `design-system.md` (both current); the stale build-era specs
were deleted — architecture lives in `docs/atlas/architecture.md`.

| What you need | Read this file | Status |
|---|---|---|
| System overview (services, request flows, modules) | `docs/atlas/architecture.md` | ✅ current |
| Authoritative per-feature reference (stack, flow, key files) | `docs/atlas/<feature>.md` | ✅ current |
| All API endpoints (auto-generated) | `docs/atlas/_generated/api-routes.md` | ✅ current |
| Database schema / ERD (auto-generated) | `docs/atlas/_generated/erd.md` | ✅ current |
| Module import graph (auto-generated) | `docs/atlas/_generated/module-graph.md` | ✅ current |
| Folder structure, naming, code style rules | `.claude/conventions.md` | mostly accurate |
| Design tokens, colors, fonts, spacing | each app's `src/globals.css` + `.claude/design-system.md` | accurate |
| Portal / Dashboard page specs | `apps/portal/SPECS.md`, `apps/bridge/SPECS.md` | reference |
| AI-maintained app map + storyboard viewer | `worldgraph/atlas.world.json` (+ `worldgraph/README.md`) | ✅ current |

---

## 2. Non-Negotiable Rules

- **Never invent dependencies.** Use packages already in the relevant `package.json`; confirm one
  exists before importing it (confirm against the relevant `package.json`).
- **Never invent colors or fonts.** Only use the token variables defined in each app's
  `src/globals.css` (documented in `.claude/design-system.md`).
- **Always check the actual schema** (`packages/db/prisma/schema.prisma` / `_generated/erd.md`)
  before writing any query or migration.
- **Always check the actual routes** (`_generated/api-routes.md`) before adding or calling an endpoint.
- **Prefer shared UI components** from `packages/ui` where they exist (Badge, Button, Input,
  Textarea today). Most app UI is built locally in each app — match the patterns already there
  rather than duplicating.
- **Instance-wide settings come from `AppConfig`**, never hardcode them (single-tenant — see top of file).
- **Write TypeScript strictly.** No `any` types. No ts-ignore unless absolutely necessary with comment.
- **Keep the docs current** — see the Documentation rule above.

---

## 3. Working Rhythm

**Start of session:** read this `CLAUDE.md`, read the relevant `docs/atlas/<feature>.md`, and
skim recent `STATE.md` entries + its Decisions table for context.

**End of session:** run the Documentation checklist above (atlas + STATE.md + tests), append a
`STATE.md` Session Log entry, and record any new known gaps (STATE.md) or test scaffolds
(`tests/regression-catalogue.md`).

**Ambiguity:** if minor, decide and record it in the `STATE.md` Decisions table; if major, stop and ask.

---

## 4. Commands

Run from the repo root unless noted. Package manager is **pnpm** (Node ≥20); workspaces are
`@tmr/api`, `@tmr/portal`, `@tmr/bridge`, `@tmr/db`, `@tmr/ui`.

| Task | Command |
|---|---|
| Run all apps (turbo) | `pnpm dev` |
| Run one app | `pnpm --filter @tmr/api dev` (API → :3001) · `@tmr/portal` (→ :3000) · `@tmr/bridge` (→ :3002) |
| Lint / type-check (all) | `pnpm lint` · `pnpm type-check` |
| Build (all) | `pnpm build` |
| Tests — all layers | `pnpm test` |
| Tests — one layer | `pnpm test:unit` · `test:contract` · `test:integration` · `test:e2e` · `test:coverage` |
| Regenerate atlas | `pnpm atlas:gen` |
| Validate worldgraph / view worldgraph map+storyboard (:3003) | `pnpm worldgraph:check` · `pnpm worldgraph:view` |
| New release QA report (manual test checklist) | `pnpm qa:new "<release-name>" [--features a,b]` → `tests/manual/reports/<date>_<slug>/` (checklist composed from `tests/manual/_catalog/catalog.json`; see [tests/manual/README.md](tests/manual/README.md)) |
| DB migrate / push / seed / studio | `pnpm --filter @tmr/db db:migrate` · `db:push` · `db:seed` · `db:studio` |

Local infra (Postgres + MinIO) runs as standalone containers — see [`DEPLOY.md`](DEPLOY.md) →
"Local development infra". Production deploys via **PM2** (`ecosystem.config.cjs`), not Docker —
full runbook in [`DEPLOY.md`](DEPLOY.md).
Dev URLs — Portal http://localhost:3000 · API http://localhost:3001 · Bridge http://localhost:3002
· MinIO console http://localhost:9001. Seeded logins and full env details live in
`STATE.md` → Quick Reference.

---

## 5. Project Structure

```
/
├── CLAUDE.md                  ← You are here
├── PROGRESS.md                ← Phase 1 checkpoint history (all complete)
├── STATE.md                   ← Decision history + session log (read for "why")
├── .claude/                   ← conventions.md + design-system.md (current)
├── docs/atlas/                ← ✅ authoritative per-feature reference (start at README.md)
│   └── _generated/            ← never hand-edit; run `pnpm atlas:gen` (api-routes, erd, module-graph)
├── apps/
│   ├── portal/                ← Customer portal (Next.js, light theme) + SPECS.md
│   ├── bridge/                ← Agent dashboard (Next.js, dark theme) + SPECS.md
│   └── api/                   ← Backend (NestJS); 23 modules under src/modules/
│                                (see docs/atlas/_generated/module-graph.md; orgs/ is DEAD — not imported)
├── packages/
│   ├── ui/                    ← Shared React components (Badge, Button, Input, Textarea)
│   ├── db/                    ← Prisma schema + client + migrations + seed
│   ├── types/                 ← Shared TypeScript types
│   ├── email/                 ← Email templates (React Email)
│   └── config/                ← Shared ESLint, TS, Tailwind configs
├── scripts/                   ← atlas-gen.ts (`pnpm atlas:gen`), backfill-ai-analytics.ts
├── tests/                     ← unit / integration / e2e + regression-catalogue.md (see tests/README.md)
├── worldgraph/                ← AI-maintained app map (atlas.world.json) + viewer (:3003)
│                                fully decoupled: own package.json/install, not in pnpm-workspace.yaml
│                                or turbo — see worldgraph/README.md
├── ecosystem.config.cjs       ← PM2 process definitions (api/portal/bridge) for production
└── DEPLOY.md                  ← production deploy runbook (clone → PM2)
```

Design tokens live in each app's `src/globals.css` (the original `design/` reference folder was removed).

---

## 6. Current State

Everything below is built and wired:

- **Core ticketing** — tickets, messages/notes, file attachments, customers, agents, GitHub
  issue linking, in-app notifications, SSE real-time updates, settings/branding.
- **Email** — 2-way sync via Gmail REST + Microsoft Graph (polling, not SMTP), VERP reply-to
  threading, outbound via Nodemailer/Graph.
- **Bot** (`bot`, `knowledge-base`, `shifts`) — Athena first-responder: hybrid RAG retrieval
  (pgvector + Postgres FTS, RRF fusion) over a crawled knowledge base, shift-based escalation.
- **Ticket analysis** (`ai`) — Gemini sentiment, topic classification, CSAT, customer signals.
- **Analytics** (`analytics`) — operations dashboard + customer-intelligence dashboard.

Per-feature detail lives in `docs/atlas/`; the rationale for each major choice is in `STATE.md`.
