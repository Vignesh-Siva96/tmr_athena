# Athena Testing Framework

A four-layer test framework built around one principle: **catch the silent data-shape and runtime bugs that type-checks can't see.**

This README is two documents in one:
1. **Framework overview** — what's here, what each layer does, what infra it needs ([§1–§4](#1-the-four-layers))
2. **Author guide** — how to add or update a test when you change code ([§5–§9](#5-decision-tree--what-test-do-i-write))

If you've never touched the framework before, read top-to-bottom. If you just want to write a test, jump to [§5](#5-decision-tree--what-test-do-i-write).

---

## 1. The four layers

| Layer | Runner | What it tests | Infra needed | Typical runtime |
|---|---|---|---|---|
| **Unit** | Vitest | Pure functions, helpers, React hooks | none | < 1s |
| **Contract** | Vitest | Doc/code/schema drift (atlas snapshots, Zod parity) | none | ~3s |
| **Integration** | Jest | Service methods + controllers against a real DB, queue, and Nest app | Docker (Testcontainers) | ~2 min |
| **E2E** | Playwright | Real browsers driving portal + bridge + API end-to-end | Docker + Chromium | ~10 min |

Plus dedicated buckets — `tests/security/`, `tests/migrations/`, `tests/concurrency/`, `tests/parsing/`, `tests/external/` — scaffolded but currently empty. Add tests there as the relevant code areas mature.

### How each layer's harness works

- **Unit**: standard Vitest. `jsdom` environment auto-applied to files under `tests/unit/portal/**` or `tests/unit/bridge/**`. No DB, no HTTP, no real timers.
- **Contract**: standard Vitest. Tests shell out to `pnpm atlas:gen` and diff the result against committed files; or load Zod schemas and assert them against API responses.
- **Integration**: Jest boots Postgres + MinIO via Testcontainers (one container set per `pnpm test:integration` run), applies the schema via `prisma db push`, then per-file boots a real Nest app via `Test.createTestingModule({ imports: [AppModule] })`. Each test starts with TRUNCATEd tables. External HTTP calls (Gmail, Graph, Gemini, GitHub, OAuth) are intercepted by MSW. SMTP is replaced with an in-memory capture (see [`MailCaptureService`](../apps/api/src/modules/test-utils/mail-capture.service.ts)).
- **E2E**: Playwright `globalSetup` boots its own Postgres + MinIO via Testcontainers, runs `prisma db push` + `prisma db seed`, and exposes the resulting DB URL via `process.env`. Three `webServer` entries then boot `apps/api`, `apps/portal`, `apps/bridge` against that test DB. Real Chromium drives both customer (portal) and agent (bridge) browser sessions in parallel.

---

## 2. Current state (honest inventory)

This section gets updated as coverage grows. Treat anything not listed here as **not yet implemented**.

| Layer | Files | Working tests | Notes |
|---|---|---|---|
| Unit | 1 | 9 | Only `stripSubjectPrefixes` — proves the runner works |
| Contract | 2 | 5 | Atlas drift guard is functional; will catch undocumented route changes |
| Integration | 3 | 10 | Health smoke, ticket visibility, mail capture — proves the harness is real |
| E2E | 2 | 2 (F1 + F2 — selectors wired, ready for first run) | Run with `pnpm test:e2e`; `--headed` for visual; `--ui` for trace viewer. Traces on failure → `coverage/playwright-report/` |
| Security / Migration / Concurrency / Parsing / External | 0 | 0 | Empty directories, configs only |

The plan calls for ~150 more tests across all layers. Each follows one of the patterns in [§6–§8](#6-worked-example--unit-test).

### Bugs discovered while building tests (tracked in [regression-catalogue.md](regression-catalogue.md))

- `stripSubjectPrefixes` doesn't trim leading whitespace before the regex — leading whitespace defeats it
- `TicketsController.list()` response is double-wrapped (`{ data: { data: [...], meta } }`)
- `DELETE /tickets/:id` followed by `GET /tickets/:id` returned 200 instead of expected 404 (cause not yet investigated)

---

## 3. Prerequisites

| Need | Required for | How to install |
|---|---|---|
| Node 20+ + pnpm 10+ | everything | `corepack enable && pnpm install` |
| Docker daemon running | integration, E2E | `docker info` should succeed |
| Chromium for Playwright | E2E only | `pnpm exec playwright install chromium` |

If you only run `pnpm test:unit` and `pnpm test:contract`, you need zero Docker.

If `playwright install --with-deps` fails on a system-package step (e.g. broken third-party apt repo), use `pnpm exec playwright install chromium` instead — that skips the system-deps step. Chromium will still launch on any reasonably modern Linux desktop.

---

## 4. Quick start

```bash
# Fast feedback — no infra
pnpm test:unit                 # ~1s
pnpm test:contract             # ~3s
pnpm test:watch                # Vitest watch mode (unit suite)

# Needs Docker
pnpm test:integration          # ~2 min
pnpm test:e2e                  # ~10 min — full flows

# Everything, sequentially
pnpm test                      # unit → contract → integration → e2e

# Run a single test file
pnpm test:integration tests/integration/tickets.create.spec.ts
pnpm test:e2e tests/e2e/flows/F1.spec.ts

# Coverage report
pnpm test:coverage
```

Outputs:
- Coverage reports → `coverage/{unit,integration,playwright-report}/`
- Playwright traces (on failure) → `coverage/playwright-report/` and `test-results/`

---

## 5. Decision tree — what test do I write?

When you change code, walk this tree top-down:

```
What did you change?
│
├── A pure function / utility / hook (no DB, no HTTP)
│   → unit test → tests/unit/<area>/<file>.spec.ts          (see §6)
│
├── A NestJS service method, controller route, or anything
│   that touches DB / queue / SSE / SMTP / external HTTP
│   → integration test → tests/integration/<module>.<action>.spec.ts  (see §7)
│
├── A Prisma schema field, an enum, a relation
│   → run pnpm atlas:gen (auto-regens ERD doc) +
│     write integration test asserting the field's behavior
│
├── A controller endpoint (added/renamed/removed)
│   → run pnpm atlas:gen (auto-regens api-routes doc) +
│     write integration test asserting the route's contract
│
├── A user-visible flow across portal + bridge + API
│   (browser-side state, SSE pushes, OAuth callbacks, real DOM)
│   → E2E test → tests/e2e/flows/F<N>.spec.ts                (see §8)
│
└── A bug fix
    → ALL of the above, PLUS:
      1. Write a test that fails on the pre-fix code FIRST
      2. Fix the code
      3. Confirm the test now passes
      4. Add a row to regression-catalogue.md
```

**When in doubt, write integration.** It's the highest-ROI layer — fast enough to run on every PR, real enough to catch data-shape bugs.

---

## 6. Worked example — unit test

You added a helper `truncateBody(text, maxChars)` in `apps/api/src/<some-module>/util/truncate-body.ts`.

**Step 1.** Create `tests/unit/api/truncate-body.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { truncateBody } from '../../../apps/api/src/<some-module>/util/truncate-body'

describe('truncateBody', () => {
  it.each([
    ['short', 10, 'short'],                       // shorter than max → unchanged
    ['exactly ten', 11, 'exactly ten'],           // boundary
    ['way longer than ten', 10, 'way longer…'],   // truncates with ellipsis
    ['', 10, ''],                                 // empty input
    ['anything', 0, '…'],                         // zero max
  ])('truncates %j at %d to %j', (input, max, out) => {
    expect(truncateBody(input, max)).toBe(out)
  })
})
```

**Step 2.** Run it:

```bash
pnpm test:unit tests/unit/api/truncate-body.spec.ts
```

That's it. No factories, no harness, no mocks.

### Worked unit pattern for React hooks (jsdom)

For a hook like `useBackfillStatus`:

```ts
// tests/unit/bridge/useBackfillStatus.spec.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useBackfillStatus } from '../../../apps/bridge/src/lib/useBackfillStatus'

describe('useBackfillStatus', () => {
  it('Math.max prevents stale poll from rolling back SSE-set count', async () => {
    const { result } = renderHook(() => useBackfillStatus('fake-token'))
    act(() => result.current.handleSseEvent({ seen: 100 }))
    act(() => result.current.handlePoll({ archiveTotalSeen: 50 }))
    expect(result.current.archiveTotalSeen).toBe(100) // not 50
  })
})
```

Vitest auto-applies the `jsdom` environment because the file is under `tests/unit/bridge/**`.

---

## 7. Worked example — integration test

You added `POST /tickets/:id/merge`.

**Step 1.** Create `tests/integration/tickets.merge.spec.ts`:

```ts
import { harness } from './harness'
import { makeUser, makeAgent, makeTicket, makeMessage, signJwt } from './factories'
import './setup'

describe('POST /tickets/:id/merge', () => {
  it('reparents messages from source to target and soft-deletes source', async () => {
    const user = await makeUser()
    const admin = await makeAgent({ role: 'ADMIN' })
    const source = await makeTicket({ userId: user.id })
    const target = await makeTicket({ userId: user.id })
    await makeMessage({ ticketId: source.id, body: 'orphan reply', authorUserId: user.id })

    const token = await signJwt({ id: admin.id, role: 'agent' })
    const res = await harness.request()
      .post(`/api/v1/tickets/${source.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ targetId: target.id })

    expect(res.status).toBe(200)

    // Direct DB assertions — bypass the controller to verify the side-effects.
    const sourceAfter = await harness.prisma.ticket.findUnique({ where: { id: source.id } })
    expect(sourceAfter?.deletedAt).not.toBeNull()

    const messagesOnTarget = await harness.prisma.message.findMany({ where: { ticketId: target.id } })
    expect(messagesOnTarget.map((m) => m.body)).toContain('orphan reply')
  })
})
```

**Step 2.** Run it:

```bash
pnpm test:integration tests/integration/tickets.merge.spec.ts
```

The first time you run this, Testcontainers pulls the Postgres + MinIO images (~30s). Subsequent runs are fast (~5s for the whole file).

### What the harness gives you

| Symbol | Source | What it does |
|---|---|---|
| `harness.request()` | [harness.ts](integration/harness.ts) | Returns a fresh supertest agent against the booted Nest HTTP server |
| `harness.prisma` | same | The Nest-managed `PrismaService` — use for assertions |
| `harness.get<T>(token)` | same | Resolve any Nest provider — e.g. `harness.get<MailCaptureService>(MailCaptureService)` |
| `makeUser/Agent/Ticket/Message` | [factories/index.ts](integration/factories/index.ts) | Insert rows with sensible defaults; pass overrides for edge cases |
| `signJwt({ id, role })` | same | Mint a token matching `AuthService.issueToken()` — pass to `.set('Authorization', ...)` |
| MSW (lazy) | [integration/msw/](integration/msw/) | Per-test handler overrides for Gmail/Graph/Gemini/GitHub/OAuth |
| Mail capture | [test-utils/mail-capture.service.ts](../apps/api/src/modules/test-utils/mail-capture.service.ts) | Outbound email goes here instead of SMTP — assert via `capture.list()` |

### Common gotchas

These are real things found while building the framework — read before debugging.

1. **Response shape is wrapped exactly once by `TransformResponseInterceptor`.** A controller that returns `{ ticket }` becomes `{ data: { ticket } }`. A controller that returns `{ data: [...], meta }` becomes `{ data: { data: [...], meta } }` (double-wrap — bug at the controller, not the interceptor). Inspect with `console.log(res.body)` when shape mismatch surprises you.

2. **In-memory test-only state survives `beforeEach`.** The DB is TRUNCATEd between tests, but singletons like `MailCaptureService` aren't. `setup.ts` resets known in-memory services for you; if you add a new one, reset it explicitly inside the relevant test.

3. **MSW is lazy-imported.** Top-level `import { setupServer } from 'msw/node'` breaks Jest's CJS resolution. Use `const { setupServer } = await import('msw/node')` inside `beforeAll` if you need it.

4. **Use `harness.prisma`, never `new PrismaClient()`.** The harness reuses the Nest-managed Prisma connection; making your own client can cause connection-pool exhaustion + visibility issues across the supertest call.

5. **`maxWorkers: 1` for the whole integration suite.** All integration tests share one DB schema. Don't try to parallelize — you'll see TRUNCATE races.

---

## 8. Worked example — E2E test

You added a "merge tickets" feature visible to agents. F32 (next free number) is yours.

**Step 1.** Create `tests/e2e/flows/F32.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const BRIDGE = 'http://localhost:3002'
const ADMIN = { email: 'admin@twominutereports.com', password: 'admin123' }

test.describe('F32 — Agent merges two tickets', () => {
  test('merge replaces source row with consolidated thread', async ({ page }) => {
    await page.goto(`${BRIDGE}/auth`)
    await page.getByLabel(/email/i).fill(ADMIN.email)
    await page.getByLabel(/password/i).fill(ADMIN.password)
    await page.getByRole('button', { name: /sign in/i }).click()

    await page.goto(`${BRIDGE}/inbox`)
    // ... open source ticket, click merge, select target, confirm
    // ... assert source row no longer in inbox
    // ... assert target ticket shows the merged message body
  })
})
```

**Step 2.** Run it:

```bash
pnpm test:e2e tests/e2e/flows/F32.spec.ts
```

### E2E gotchas

1. **Use the seeded accounts.** [packages/db/src/seed.ts](../packages/db/src/seed.ts) creates `admin@twominutereports.com / admin123`, `agent@twominutereports.com / agent123`, `jordan@acmecorp.com / customer123`. The seed runs in `globalSetup` via `prisma db seed`.

2. **`process.env.DATABASE_URL` is set dynamically.** The Testcontainers Postgres in `globalSetup` decides its port at runtime; `playwright.config.ts` deliberately does **not** hardcode it (a hardcoded fallback would override globalSetup). Don't add a `DATABASE_URL` line to `webServer.env` — let it inherit from the process env that globalSetup mutates.

3. **Two browser contexts for cross-app flows.** Customer-on-portal + agent-on-bridge needs two independent browser contexts. `browser.newContext()` twice — see F1.spec.ts.

4. **Mail capture endpoint is your "did we send the right email?" oracle.** `await fetch('http://localhost:3001/api/v1/__test/captured-mail?to=jordan@acmecorp.com')` returns all captured outbound mail for that recipient. Headers, subject, body, `In-Reply-To` chain — everything.

5. **First run after a code change can fail on stale dev-server cache.** Both Next apps run `rm -rf .next && next dev` on startup; the API doesn't. If the API behaves unexpectedly, kill it and let Playwright re-spawn.

6. **Selectors will be wrong on the first run.** The plan-derived F1 uses generic role-based selectors (`getByRole('button', { name: /reply/i })`). Real UI may use different labels. Run the test, read the Playwright trace's failed selector, copy the actual selector from the trace, repeat. Budget 30 minutes per new flow's first green run.

---

## 9. Bug fix workflow (with regression catalogue)

The catalogue at [regression-catalogue.md](regression-catalogue.md) is the source of truth that says "this can't silently break again." Every PR that fixes a bug must add a row plus a test.

**Order of operations:**

1. **Write the test first.** Reproduce the bug with the smallest possible failing test. Run it — confirm it fails for the right reason.
2. **Fix the code.** Run the test again — confirm it now passes.
3. **Add a row** to `regression-catalogue.md` with the test's exact name. Use the next free `R<N>` id (current highest is R60).
4. **Bonus — negative-path verification.** Revert your fix locally, re-run the test, confirm it fails. Restore the fix. This proves the test actually exercises the regression path.

The catalogue uses three status icons:
- ✅ — covered by a passing test
- 🟡 — test exists but asserts current (buggy) behavior; fix is tracked separately
- 🔴 — fix landed in code, test still TODO

---

## 10. Directory layout (reference)

```
tests/
├── unit/                       # Vitest, no infra
│   ├── api/                    # apps/api targets
│   ├── portal/                 # apps/portal targets (jsdom)
│   ├── bridge/                 # apps/bridge targets (jsdom)
│   └── setup.ts                # @testing-library/jest-dom matchers etc.
│
├── integration/                # Jest + Testcontainers + real Nest app
│   ├── global-setup.ts         # one-time: boot Postgres + MinIO, prisma db push
│   ├── global-teardown.ts      # stop containers
│   ├── setup.ts                # per-file: boot Nest, TRUNCATE between tests
│   ├── harness.ts              # the supertest agent + prisma + Nest module accessor
│   ├── factories/index.ts      # makeUser / makeAgent / makeTicket / makeMessage / signJwt
│   ├── msw/handlers.ts         # aggregated MSW handlers (lazy-loaded)
│   ├── msw/providers/          # gmail.ts, graph.ts, gemini.ts, github.ts, *-oauth.ts
│   └── *.spec.ts               # one file per module
│
├── contract/                   # Vitest, no infra
│   ├── routes-snapshot.spec.ts # pnpm atlas:gen && diff
│   └── sse-coverage.spec.ts    # SSE controller exists with @Sse + token
│
├── e2e/                        # Playwright
│   ├── global-setup.ts         # boot Postgres + MinIO + prisma db push + seed
│   ├── global-teardown.ts      # stop containers
│   ├── flows/                  # F1.spec.ts, F2.spec.ts, ...
│   └── fixtures/               # shared helpers
│
├── security/  migrations/  concurrency/  parsing/  external/   # scaffolded, empty
│
├── regression-catalogue.md     # the "no silent failures" register
├── jest.integration.config.js  # Jest config (integration only)
├── vitest.unit.config.ts       # Vitest unit
├── vitest.contract.config.ts   # Vitest contract
├── vitest.security.config.ts   # Vitest security (reuses integration harness)
├── playwright.config.ts        # Playwright config
└── README.md                   # ← you are here
```

---

## 11. CI

[`.github/workflows/test.yml`](../.github/workflows/test.yml) — nine jobs, all blocking merge:

1. **lint-and-typecheck** — `tsc --noEmit` across all workspaces
2. **unit** — `pnpm test:unit` + coverage artifact upload
3. **contract** — `pnpm test:contract` (atlas drift guard)
4. **integration** — `pnpm test:integration` (Docker via runner)
5. **security** — `pnpm test:security` (currently empty; non-blocking)
6. **e2e** — `pnpm test:e2e` (Playwright)
7. **atlas-drift** — `pnpm atlas:gen && git diff --exit-code`
8. **migration-safety** — applies every Prisma migration, asserts no schema drift
9. **coverage-gate** — refuses any drop > 0.5% on line coverage vs `main`

The atlas-drift job is the cheap, fast check that catches the most common documentation-code drift. The coverage-gate is the long-term mechanism that forces tests to ship alongside features.

---

## 12. Where to look when stuck

- **Plan + design rationale**: `~/.claude/plans/hi-i-am-flickering-whale.md`
- **What changed when**: [STATE.md](../STATE.md)
- **What every feature does today**: [docs/atlas/](../docs/atlas/)
- **What endpoints exist**: [docs/atlas/_generated/api-routes.md](../docs/atlas/_generated/api-routes.md)
- **What every test guards**: [tests/regression-catalogue.md](regression-catalogue.md)
- **Why a specific test exists**: read its `Rxx` regression tag and look it up in the catalogue
