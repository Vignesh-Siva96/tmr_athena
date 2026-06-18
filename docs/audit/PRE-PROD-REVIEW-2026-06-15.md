# Pre-Production Review — TMR Support Platform (2026-06-15)

> One-off external audit artifact. Deliberately kept out of `STATE.md` / `docs/atlas/` so it is not
> subject to the atlas-drift CI check. **Report only** — no code, schema, config, or docs were
> changed in producing it (see §Verification).

---

## 1. Executive summary

**Overall readiness verdict: NOT good to go yet.** The product is genuinely feature-complete and the
application code is, on the whole, careful and well-built — auth crypto, OAuth-token encryption,
SSRF defenses, webhook HMAC, worker guards, and HTML sanitization are all real and mostly correct.
The blockers are **not** in the business logic; they are in the **deployment/operational layer and a
set of default-credential / transport gaps** that would expose a real instance on day one.

**Top 5 risks (must address before launch):**

1. **🔴 Dashboard image does not build** — the Docker build references `apps/dashboard` / `@tmr/dashboard`, which do not exist (the app is `apps/bridge` / `@tmr/bridge`). The agent dashboard cannot be deployed as configured.
2. **🔴 No TLS** — nginx serves HTTP on `:80` only; auth credentials and all ticket/customer PII travel in cleartext.
3. **🔴 Default admin credentials** — `pnpm db:seed` creates `admin@twominutereports.com / admin123` with **no production guard**; running it against a reachable DB is an instant full takeover.
4. **🔴 DB migrations are never run automatically** — no entrypoint/CMD/compose step runs `prisma migrate deploy`; the API boots against an unmigrated schema unless an operator runs it by hand.
5. **🔴 CI coverage gate is dead** — the unit config emits no `coverage-summary.json`, so the advertised 60% line-coverage gate always silently passes. The safety net CLAUDE.md relies on does nothing.

**P0 count per area:** Security 3 · Functionality 0 · Code-quality 1 · Deployment 3 (one deployment
P0 — default creds — overlaps the security seed finding; counted once in §3).

**Bottom line:** estimate roughly **1–2 days of focused hardening** (TLS, secrets injection, fix the
dashboard Dockerfile, add a migrate step, remove/guard the seed, fix the coverage reporter) to reach
launch-ready. The deeper functionality is sound.

---

## 2. Methodology & scope

- **Reviewed commit SHA:** `200b672b28f6ec8861add6d289a15c959ef2b244` (branch `master`).
- **Method:** read-only review per the plan — read source, ran read-only `grep`/`git`, ran
  `pnpm lint` / `pnpm type-check` / `pnpm test:unit` / `pnpm test:coverage` to *observe* (not fix),
  and read deploy/CI config. Findings were fanned out across six parallel investigations
  (auth+crypto · transport/logging/seed · external integrations · functionality gaps · code-quality
  · deployment) and consolidated here. ~5 top findings were independently re-verified (see §8).
- **In scope:** Steps 1–4 of the plan — security (deepest pass), functionality gaps, code quality,
  and deployment procedure/checklist.
- **NOT reviewed / limitations:** full `pnpm test:integration` and `test:e2e` were not run (need
  Postgres + MinIO / Testcontainers and are slow) — integration coverage is asserted from the spec
  inventory, not a live run. No live penetration testing, no dependency-CVE/SCA scan, no load/perf
  testing. The working tree had pre-existing uncommitted changes at review time; findings cite the
  on-disk state.
- **Authoritative sources used (per CLAUDE.md):** code → `docs/atlas/` + `_generated/` → `STATE.md`.

---

## 3. Security findings

**Count: 3 P0 · 2 P1 · 11 P2 · 4 Note** (the seed-credentials P0 is shared with the deployment area).

### 🔴 P0

| # | Title | Evidence | Why it matters | Suggested direction |
|---|---|---|---|---|
| S1 | No TLS at the proxy (HTTP-only nginx) | `docker/nginx.conf:9,26` `listen 80;` only — no `443`/`ssl_certificate`/redirect | Auth cookies/credentials and all ticket/customer PII traverse the network in cleartext | Terminate TLS at nginx (443 + cert, 80→443 redirect) or mandate an upstream TLS LB |
| S2 | Hard-coded weak default admin/agent/customer passwords | `packages/db/src/seed.ts:69` `admin123` → `admin@twominutereports.com` (ADMIN); `:77` `agent123`; `:86` `customer123` | A known admin login is full account takeover if seed touches any reachable DB | Generate random/env-supplied passwords; force reset on first login |
| S3 | Seed has no production guard | `seed.ts` has no `NODE_ENV`/`production` check; `main()` runs unconditionally (`seed.ts:295`); `db:seed` is a plain script (`packages/db/package.json:15`) | `pnpm db:seed` against a prod `DATABASE_URL` injects the default-cred admin + fixtures | Abort in `main()` when `NODE_ENV==='production'` unless `ALLOW_PROD_SEED` is set |

### 🟠 P1

| # | Title | Evidence | Why it matters | Suggested direction |
|---|---|---|---|---|
| S4 | No security-header middleware (Helmet absent) | no `helmet` in `apps/api` deps or `main.ts`; nginx adds no HSTS/`X-Content-Type-Options`/`X-Frame-Options`/CSP | Missing HSTS/clickjacking/MIME-sniffing protections | Add Helmet in `main.ts` and/or `add_header` directives in nginx |
| S5 | GitHub access token stored plaintext in DB | `packages/db/prisma/schema.prisma:469` `accessToken String` (no enc); raw at `github.service.ts:102,104,122,166,206,371` | A DB dump leaks a live GitHub token with repo/issue write scope — inconsistent with the AES-GCM-encrypted email tokens | Encrypt at rest via the existing `credentials-cipher` |

### 🟡 P2

| # | Title | Evidence | Why it matters | Suggested direction |
|---|---|---|---|---|
| S6 | Proxy doesn't forward client IP; rate-limit keys on proxy IP | `nginx.conf:15` sets `X-Real-IP` but **no** `X-Forwarded-For`; `main.ts` never sets `trust proxy`; `rate-limit.guard.ts:36` uses `request.ip` | All clients share one rate-limit bucket → easy bypass or self-DoS; per-IP throttling ineffective | Set `app.set('trust proxy', 1)`, read forwarded IP, add `X-Forwarded-For` in nginx |
| S7 | Rate limiting only on auth + rating routes | `@RateLimit` only in `auth.controller.ts` and `analytics/rating.controller.ts`; no global guard | Public write paths (portal ticket create, file upload, email webhook) are unthrottled → spam/DoS | Apply a default global rate-limit guard with per-route exceptions |
| S8 | OAuth `state` not bound to initiating session (mailbox-connect CSRF) | `email-oauth.service.ts:176-204` signs only `provider:timestamp`, no per-session nonce; callback unauthenticated (`email-oauth.controller.ts:44-69`) | Classic OAuth CSRF — no binding to the admin who started the flow (forgery hard: HMAC key is secret) | Embed a random nonce in `state`, stash in a short-lived signed cookie, match in callback |
| S9 | GitHub webhook secret stored plaintext | `schema.prisma:27` `githubWebhookSecret String?`; raw at `github.service.ts:243,286,293` | Leak lets an attacker forge valid webhook deliveries (e.g. fake fix-deployed events) | Encrypt at rest, or accept+document as low-impact |
| S10 | `EMAIL_CREDS_KEY` not validated at boot | `validate-env.ts:9-16` validates only `BETTER_AUTH_SECRET`; key read lazily, throws only on first use (`credentials-cipher.ts:7-15`) — also keys the OAuth-CSRF HMAC | App boots fine then fails deep in a worker instead of failing fast like the JWT secret | Add length-checked `EMAIL_CREDS_KEY` to `validateEnv` |
| S11 | Agent attribution trusts the `From` header (no DKIM/SPF) | `thread-ingestion.service.ts:208,228-233`; `gmail.provider.ts:90` derives `fromEmail` from raw header | A spoofed-but-delivered mail matching a mailbox alias is misattributed as agent-authored | Gate agent attribution on authentication-results (DKIM/SPF pass) + alias match |
| S12 | Prompt-injection exposure (crawled KB + customer question) | `bot.prompts.ts:17-41` interpolates `question` + `chunk.text` with no delimiter hardening | Poisoned KB/crafted question can steer answer text (blast radius limited: text-only, links same-origin-validated, output sanitized) | Wrap untrusted passages in explicit delimiters; mark them as data, not instructions |
| S13 | Crawler SSRF guard solid but DNS-rebinding TOCTOU | `assert-public-url.ts` validates host, then `fetch` resolves independently (`:97`) | Hostile DNS could return a public IP to the check, private IP to the fetch | Pin the validated IP into the fetch (custom `lookup`/agent) |
| S14 | `sanitizeHtml` allows `<img src>` / non-`javascript:` `data:`; client-only | `packages/ui/src/sanitize.ts:45-66` keeps `<img src>` (`:58`), doesn't block `data:`; returns input unchanged server-side (`:46`) | Inbound email HTML can embed tracking `<img>` (agent IP leak) / `data:`; future SSR would emit unsanitized | Neutralize remote `img`, disallow `data:`, add a server-side sanitize pass |
| S15 | No MIME/type allowlist on uploads; client-controlled Content-Type | `files.service.ts:43-72` stores any buffer, sets Content-Type from client (`:57`); `files.controller.ts:54-55` | Arbitrary HTML/SVG stored + served inline could enable stored-XSS; only size is validated | Allowlist MIME types; force `Content-Disposition: attachment` + `nosniff` on serve |
| S16 | Long-lived presigned URL persisted as a bearer capability | `files.service.ts:60` 7-day presigned GET stored on `Attachment.url` | Anyone with the URL (or DB read) fetches the object for 7 days regardless of ticket ACL; links also go stale | Generate short-lived presigned URLs on demand behind an authz check |
| S17 | Bounce handler matches body-text tokens → can mark victim BOUNCING | `thread-ingestion.service.ts:371-416` scans bounce body for `ticket-…@` tokens then sets `emailStatus: BOUNCING` | A crafted mail from a daemon-style local-part with a guessed/leaked token suppresses a victim's email (low-sev DoS) | Require the token in real DSN headers, not arbitrary body text |
| S18 | No log retention/rotation cleanup | `file-logger.ts` rotates by daily filename only; no `unlink`/`maxFiles`/retention; `apps/api/logs/` holds 16 days (one 5.8 MB) | Logs (IDs + operator email) accumulate indefinitely → disk exhaustion + growing PII trove | Add age-based pruning or a rotating logger with `maxFiles` |

### ⚪ Notes

| # | Title | Evidence | Note |
|---|---|---|---|
| S19 | Notifications are global, not per-recipient | `notifications.service.ts:20-54` — list/unread-count/mark-read unscoped by agent | Every agent sees/marks every notification; acceptable in single-tenant trusted-staff model — decide & record |
| S20 | Any agent can mutate any ticket / read any customer | `tickets.controller.ts:65-94` (AgentGuard only), `users.controller.ts:14,23-24` | No agent-to-agent authz ceiling; fine for trusted staff but worth an explicit decision |
| S21 | Operator mailbox address logged repeatedly | `apps/api/logs/*.log` "transporter initialized … as vignesh.s@gox.ai" on every init | Minor PII + noise; **no tokens/passwords were found in logs** (verified, see §8) |
| S22 | Internal `HttpException` messages returned to clients | `all-exceptions.filter.ts:32-44` returns thrown message verbatim (500s correctly masked at `:29,45-46`) | Review thrown messages for sensitive detail; the generic-500 masking is already correct |

**Verified-good (no action) — assurance:** scrypt password hashing with per-password salt (`auth.service.ts:109-117`); timing-safe JWT verify, `alg:none`/alg-confusion not exploitable (`auth.guard.ts:34-58`); portal/agent/guest boundary enforced by guards with per-request DB principal reload; single-use TTL'd magic tokens + no user-enumeration on forgot-password (`auth.service.ts:129-147,344-351`); customer IDOR enforced on ticket read/reply, file-attach, attachment-claim, message-edit (`tickets.service.ts:173-179,219`, `messages.service.ts:45,78-86,152-157`); OAuth tokens + bot API key AES-256-GCM at rest (`credentials-cipher.ts:17-36`); GitHub webhook HMAC constant-time with length guard over raw body (`github.service.ts:293-301`); config write-whitelist prevents mass-assignment (`config.service.ts:10-18`); crawler SSRF guard blocks private/loopback/link-local/metadata IPs + re-validates every redirect (`assert-public-url.ts`); bot/email HTML sanitized before every `dangerouslySetInnerHTML` sink (`MessageCard.tsx:91`, portal `tickets/[id]/page.tsx:448-450`); worker guards prevent internal notes being emailed + idempotency (`send-reply.worker.ts:66-71`, `queue.service.ts:250`).

---

## 4. Functionality gaps

**Count: 0 P0 · 3 P1 · 3 P2 · 2 Note.** Every headline feature is genuinely wired end-to-end — no
stubbed RAG, no mocked analytics, no fake email send. Issues are doc-drift and polish gaps.

### 🟠 P1

| # | Title | Evidence | Why it matters | Suggested direction |
|---|---|---|---|---|
| F1 | Atlas docs reference retired AI models | `docs/atlas/bot.md:21`, `README.md:44,49` say `text-embedding-004` / `Gemini 2.0 Flash`; code uses `gemini-embedding-001` (`ai/embedding.constants.ts:1`) + `gemini-2.5-flash-lite` (`bot/generator.service.ts:11`) | Both named models are retired by Google; anyone reconfiguring from the docs hits failures | Update README.md + bot.md to match `ai.md` |
| F2 | Microsoft outbound uses SMTP XOAUTH2 but doc claims Graph; `sendViaGraph()` is dead | `docs/atlas/email.md:24` vs `email.service.ts:115-120`; `sendViaGraph()` (`:667`) never called | Doc/code mismatch + dead code; SMTP path also doesn't capture the assigned Message-ID like Gmail | Implement the Graph send path or delete `sendViaGraph()` and fix email.md |
| F3 | Transient Graph poll errors stall the whole poll cycle | `email-sync/live-poller.service.ts:70-79` only recovers from 410; 429/503 abort the poll, checkpoint doesn't advance | A flaky Graph response delays live inbound mail until the next clean tick | Wrap `pollChanges()` in the existing retry/backoff or catch transient errors |

### 🟡 P2

| # | Title | Evidence | Why it matters | Suggested direction |
|---|---|---|---|---|
| F4 | Atlas README test inventory understates coverage | `README.md:63-69` says "(none yet)" for analytics/GitHub/auth/notifications/settings/files, but specs exist (`analytics-rating.spec.ts`, `github.spec.ts`, `notifications.spec.ts`, `config.spec.ts`, `files-sync.spec.ts`, `users.customers.spec.ts`) | Misleads reviewers about coverage | Refresh the Quick-Navigation test column |
| F5 | `notification-created` SSE event broadcast but never consumed | emitted in `notifications.service.ts:16`; no `.on('notification-created')` in `apps/bridge/src` | New notifications lag up to 30s (bell polls); dead broadcast | Subscribe the sidebar to the event, or drop the unused broadcast |
| F6 | `aiSummary` computed/stored on every resolved ticket but never displayed | written `ai/workers/classify-ticket.worker.ts:105`; no read in analytics/customers/bridge | Pays Gemini token cost for an insight that never surfaces | Surface it on the CSAT view or stop requesting it |

### ⚪ Notes

| # | Title | Evidence | Note |
|---|---|---|---|
| F7 | `linkUrl` field in create-ticket DTO unused | `tickets.dto.ts:27` declared; never read in `tickets.service.ts:165-180` | Dead surface; portal link feature works via `/files/upload`. Remove the field |
| F8 | GitHub OAuth doesn't emit `OAUTH_CONNECTED` | `github.service.ts:56-108` (cf. `email-oauth.service.ts`) | Cosmetic asymmetry; harmless (no GitHub backfill to trigger) |

**Confirmed working:** the dead `apps/api/src/modules/orgs` is truly unwired (no `Org` model/`orgId`,
not in `app.module.ts:30-62`); bot RAG is real (pgvector HNSW + FTS + RRF + live Gemini embeddings,
`bot/retrieval.service.ts:62-116`); AI analysis is real and queue-triggered with `AiUsage` logging
(`ai/gemini.service.ts:92-134`); both analytics dashboards fetch real aggregates and degrade
gracefully; email 2-way sync, GitHub, files/MinIO, auth (signup+verify+Google OAuth), notifications,
SSE, settings all persist; **zero `TODO`/`FIXME`/`@ts-ignore`/`: any` in `apps/api/src`.**

---

## 5. Code-quality findings

**Count: 1 P0 · 3 P1 · 2 P2 · 2 Note.** Source quality is high; the problems are in the *test/quality
enforcement plumbing*, not the application code.

### 🔴 P0

| # | Title | Evidence | Why it matters | Suggested direction |
|---|---|---|---|---|
| Q1 | CI coverage gate is dead — never enforces 60% | `tests/vitest.unit.config.ts:26` reporter `['text','lcov','html']` (no `json-summary`); `.github/workflows/test.yml:166-173` gates on a `coverage-summary.json` that is never generated → always takes the "skipping" else-branch | The advertised enforced coverage-gate does nothing; coverage can silently rot | Add `json-summary` to the coverage reporter array |

### 🟠 P1

| # | Title | Evidence | Why it matters | Suggested direction |
|---|---|---|---|---|
| Q2 | `pnpm lint` broken for the API workspace | `pnpm lint` → `@tmr/api#lint` "ESLint couldn't find a configuration file"; no eslint config/dep in `apps/api`; CI runs only `type-check` (`test.yml:24`), not lint | The largest workspace (23 modules) is unlinted; the "no `any`/no `console`" rules are unenforceable | Wire `apps/api` to the existing `@tmr/config` ESLint preset + add the dep |
| Q3 | Regression catalogue overstates coverage (~61 rows reference nonexistent tests) | `tests/regression-catalogue.md` — 61 🔴 rows cite spec files that don't exist (`messages.create.spec.ts`, `gmail.provider.spec.ts`, `files.upload.spec.ts`, `thread-ingestion.spec.ts`, `live-poller.spec.ts`, …) | The "no silent failures backbone" is illusory for core email-sync/ingestion paths | Write the named tests or mark rows honestly as unguarded |
| Q4 | Thin unit coverage concentrated away from core logic | `pnpm test:coverage` → `5.19% Lines`; 156 unit tests skew to pure helpers; heavy modules rely on integration specs excluded from the number (and the gate is blind, Q1) | Most behavioral risk lives in ingestion/threading/analytics where unit coverage is lightest | After fixing Q1, measure merged unit+integration coverage and backfill |

### 🟡 P2

| # | Title | Evidence | Why it matters | Suggested direction |
|---|---|---|---|---|
| Q5 | `.claude/conventions.md` materially stale — mandates dropped multi-tenancy | `conventions.md:27,72-114,329` require `orgId` "first parameter", `OrgGuard`, `@CurrentOrg()` — contradicts single-tenant CLAUDE.md; obsolete `CP-XX` commit format (`:312`) | An agent following it would reintroduce dropped multi-tenancy | Rewrite to single-tenant reality |
| Q6 | Hand-rolled JWT codec instead of a vetted library | `auth.service.ts:149-157` + `auth.guard.ts:41-58`; no `jose`/`@nestjs/jwt`/`jsonwebtoken` dep; doesn't validate `alg` header (benign today) | Custom auth crypto is long-term debt | Migrate to `jose`/`@nestjs/jwt`; meanwhile pin/verify `alg` |

### ⚪ Notes

| # | Title | Evidence | Note |
|---|---|---|---|
| Q7 | Direct `console.error` + a few direct `process.env` reads | `messages.service.ts:111,118,125` `console.error` (in fire-and-forget `.catch()` on the live reply/escalation path → invisible to structured logs); `process.env` in `email-oauth.controller.ts:52`, `queue.service.ts:111`, `credentials-cipher.ts:8` | Swap the three `console.error` to Nest `Logger`; route env reads via `ConfigService` |
| Q8 | Response double-wrap (`body.data.data`) still open | `TicketsService.list` returns `{data,meta}` then `TransformResponseInterceptor` wraps again | Long-standing 🟡 in the catalogue; every ticket-list consumer special-cases it |

**Positive:** zero real `any`/`@ts-ignore` in source (124 raw hits all in generated `.next/types/`);
`pnpm type-check` clean (3/3 workspaces); DTO validation consistently Zod via a `ZodValidationPipe`;
the 12 `eslint-disable` comments are all benign; JWT verify uses constant-time comparison + expiry.

---

## 6. Deployment procedure (self-hosted single VM, Docker Compose)

**Stack** (`docker/docker-compose.yml`): `postgres` (`5432`), `minio` (`9000`/`9001`), `api`
(`3001` + `2525`), `portal` (`3000`), `dashboard` (`3002`), `nginx` (`80`). Queue is
**Postgres-backed (pg-boss), not Redis** (`queue.service.ts:82,102`) — compose correctly omits Redis.

> ⚠️ **Two blockers (§5/§7) make this procedure fail as-is until fixed:** the dashboard image won't
> build (D1), and migrations don't run automatically (D3). Resolve those first.

1. **Provision the VM.** Linux + Docker Compose v2; Node ≥20 / pnpm ≥9 on the host if running
   migrations from there (`package.json:49-53`). Plan to expose only `80`/`443` externally.
2. **Inject secrets** (`.env` is gitignored — inject, don't de-commit; template at `.env.example`).
   Compose hardcodes only dev defaults and **omits every real secret** — set `DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `EMAIL_CREDS_KEY` (≥32 bytes — `openssl rand -hex 32`), `MINIO_*`,
   `GOOGLE_OAUTH_*`, `MICROSOFT_OAUTH_*`, `OAUTH_CALLBACK_BASE`, `BRIDGE_URL`/`DASHBOARD_URL`,
   `PORTAL_URL`, `GITHUB_APP_*`, `GEMINI_API_KEY`, `NODE_ENV=production`. **Replace** the dev literals
   `BETTER_AUTH_SECRET: dev-secret-change-in-prod` (compose:48), `postgres/postgres` (:8),
   `minioadmin/minioadmin` (:24-25).
3. **Build images:** `docker compose -f docker/docker-compose.yml build`. (API build runs
   `prisma generate` + builds `@tmr/api`, `Dockerfile.api:16-17`.) **D1 blocker:** `Dockerfile.dashboard`
   and compose service `dashboard` (compose:82) reference `apps/dashboard`/`@tmr/dashboard`, which
   don't exist — repoint to `apps/bridge`/`@tmr/bridge` first.
4. **Run migrations BEFORE the API starts — not automated (D3).** No Dockerfile/entrypoint/compose
   step runs it; API CMD is `node apps/api/dist/main.js` (`Dockerfile.api:28`). 11 migrations under
   `packages/db/prisma/migrations/`. Bring up data services, then:
   ```
   docker compose -f docker/docker-compose.yml up -d postgres minio
   DATABASE_URL=<prod-url> pnpm --filter @tmr/db exec prisma migrate deploy
   ```
   (`migrate deploy` is the prod-safe command CI uses — `test.yml:144`.)
5. **Bootstrap AppConfig.** No manual step strictly required — `AppConfigService.get()` lazily
   `create()`s the single row on first read (`config.service.ts:80-89`); MinIO bucket auto-creates on
   first file op (`files.service.ts:31-35`). **Do not run `pnpm db:seed` in prod** (injects fixtures +
   the weak default admin, §S2/S3). Configure branding/flags via the dashboard afterward.
6. **Bring up:** `docker compose -f docker/docker-compose.yml up -d`. API `depends_on` postgres+minio
   `service_healthy` (compose:61-65).
7. **Smoke test.** `GET /api/v1/health` exists (`health.controller.ts:4,8` under prefix `main.ts:13`),
   returns `{status, db, timestamp}` — **monitor the `db` field**, since it returns `status:'ok'`
   even when the DB is unavailable (`health.controller.ts:12-14`). Verify portal/dashboard/nginx,
   log in, connect OAuth, send a test email; tail `apps/api/logs/app-$(date +%F).log`.

### Deployment gap findings

**Count (deployment-specific): 3 P0 · 3 P1 · 3 Note** (D2 = S2/S3 default-creds, counted in §3).

| # | Sev | Title | Evidence |
|---|---|---|---|
| D1 | 🔴 P0 | Dashboard image won't build | `Dockerfile.dashboard:10,13-14,19-21` + `compose:82` reference `apps/dashboard`/`@tmr/dashboard`; real dir is `apps/bridge`/`@tmr/bridge` (`ls apps/` → `api bridge portal`) |
| D2 | 🔴 P0 | Dev secrets hardcoded in compose | `compose:8,24-25,48` (`postgres/postgres`, `minioadmin/minioadmin`, `dev-secret-change-in-prod`) |
| D3 | 🔴 P0 | DB migrations not run automatically | no entrypoint/CMD/compose `migrate` step; `Dockerfile.api:28` CMD = `node dist/main.js`; `grep "prisma migrate" docker/` empty |
| D4 | 🟠 P1 | No TLS (= S1) | `nginx.conf:9,26` `listen 80` only |
| D5 | 🟠 P1 | Over-exposed ports | DB/MinIO/app/SMTP all published to host (`compose:11,27-28,59-60,75,87`) — expose only 80/443 |
| D6 | 🟠 P1 | API logs not persisted | `apps/api/logs` is in-container, unmounted → lost on recreate; no rotation (= S18) |
| D7 | ⚪ | Health endpoint always returns `status:ok` even with DB down | `health.controller.ts:12-14` — monitor the `db` field |
| D8 | ⚪ | No api/portal/dashboard healthchecks in compose | only postgres (`compose:14`) + minio (`:31`) have them |
| D9 | ⚪ | Port 2525 / `INBOUND_SMTP_PORT` is vestigial | no SMTP listener in source; ingestion is REST-poll only (`email.service.ts:335`) — don't expose 2525 |

---

## 7. Deployment checklist

**TLS / proxy**
- [ ] Add TLS terminator (443 + real cert, 80→443 redirect) — nginx is HTTP-only today (D4/S1). 🔴-blocking-equivalent
- [ ] Replace placeholder `server_name` `support.tmr.com`/`dash.tmr.com` (`nginx.conf:10,27`) with prod domains.
- [ ] Add `X-Forwarded-Proto`/`X-Forwarded-For` + `Upgrade` headers in nginx (needed for SSE + correct rate-limit IPs, S6).

**Secrets & rotation** (`.env` gitignored — inject, don't de-commit)
- [ ] Rotate every dev default in compose: `BETTER_AUTH_SECRET`, Postgres pw, MinIO creds (D2). 🔴
- [ ] `EMAIL_CREDS_KEY` ≥32 bytes; rotating it invalidates stored encrypted OAuth tokens (plan re-auth).
- [ ] Encrypt the GitHub access token + webhook secret (S5/S9) or accept-and-document.

**DB (migrate + backup/restore)**
- [ ] Run `prisma migrate deploy` manually before API start — **not automated** (D3). 🔴
- [ ] `pg_dump` backups of the `postgres_data` volume; restore → re-run `migrate deploy`.
- [ ] Confirm prod Postgres has the `vector` extension (pgvector/FTS migrations assume it) and that it survives restore.

**MinIO**
- [ ] Set `MINIO_BUCKET` consistently (bucket auto-creates, `files.service.ts:31-35`); back up `minio_data`.
- [ ] Change root creds from `minioadmin`; restrict console `:9001` exposure (D5).

**Logging / rotation / retention**
- [ ] Mount a host volume for `apps/api/logs` (D6) and add age-based pruning/rotation (S18).

**Health checks**
- [ ] `GET /api/v1/health` exists — alert on the `db` field, not HTTP status (D7).
- [ ] Add an api healthcheck in compose so orchestration can gate on it (D8).

**Firewall / port exposure**
- [ ] Expose only 80/443; bind `5432/9000/9001/3000/3001/3002` to `127.0.0.1` or drop host mappings (D5).
- [ ] Do not open `2525` — vestigial, no SMTP listener (D9).
- [ ] Apply a default global rate-limit + confirm `trust proxy` so throttling works behind nginx (S6/S7).

**OAuth redirect URIs (prod domains)**
- [ ] `OAUTH_CALLBACK_BASE` → external API URL; register `…/api/v1/config/email/oauth/{google,microsoft}/callback` (`email-oauth.service.ts:55-56`); Azure scopes `Mail.ReadWrite Mail.Send offline_access`.
- [ ] GitHub OAuth callback `{DASHBOARD_URL}/settings/github/callback`; Portal Google sign-in `{portal-origin}/auth/google/callback`.
- [ ] Set `BRIDGE_URL`, `DASHBOARD_URL`, `PORTAL_URL` (CORS allowlist `main.ts:15-18`) to prod origins.

**Pre-flight gates** (match CI `test.yml`)
- [ ] `pnpm type-check` (✅ passes today). `pnpm lint` (⚠️ broken for api — Q2; not in CI).
- [ ] `pnpm test:unit` + **fix the coverage gate first** (Q1) so the 60% threshold is real.
- [ ] `pnpm test:contract` (atlas drift), `pnpm test:integration` (needs Docker), migration drift check (`test.yml:121-152`).
- [ ] `pnpm build` + image build manually (no CI build/lint job exists). Run `pnpm test:e2e` manually (not in CI).

---

## 8. Appendix — commands run, evidence & dismissed false alarms

**Independently re-verified (spot-check):**
```
$ git rev-parse HEAD                       → 200b672b28f6ec8861add6d289a15c959ef2b244
$ git ls-files | grep -E '\.env'           → .env.example, packages/db/.env.example  (no real .env tracked)
$ ls apps/                                  → api  bridge  portal   (no apps/dashboard → confirms D1)
$ grep -n "dashboard" docker/Dockerfile.dashboard
    10: COPY apps/dashboard/package.json …  14: RUN pnpm --filter @tmr/dashboard build   (confirms D1)
$ grep -n "admin123" packages/db/src/seed.ts        → :69 hashPassword('admin123')          (confirms S2)
$ grep -n "NODE_ENV|production" packages/db/src/seed.ts → none                              (confirms S3)
$ grep -n "listen|ssl" docker/nginx.conf            → :9 listen 80;  :26 listen 80;  (no ssl) (confirms S1)
$ grep -n "reporter" tests/vitest.unit.config.ts    → :26 ['text','lcov','html']  (no json-summary)(confirms Q1)
$ grep -n "CMD" docker/Dockerfile.api               → :28 CMD ["node","apps/api/dist/main.js"] (confirms D3)
```

**Observed during review:** `pnpm type-check` PASS (3/3 workspaces); `pnpm lint` FAIL
(`@tmr/api` no ESLint config); `pnpm test:unit` PASS (16 files, 156 tests);
`pnpm test:coverage` → 5.19% lines, **no `coverage-summary.json` emitted**;
`grep -rn ": any|as any|@ts-ignore" apps packages` → 0 real source hits (124 all in `.next/`).

**False alarms investigated and dismissed (with proof):**
- *`.env` committed* — only `.env.example` is tracked; `.env` is gitignored (`git ls-files` above).
- *JWT `alg:none`/algorithm-confusion* — `verifyJwt` never trusts the header `alg`; always recomputes HMAC-SHA256 (`auth.guard.ts:41-52`).
- *Test controller `/__test/ingest-email` exposed in prod* — `TestUtilsModule` registered only when `NODE_ENV==='test'` (`app.module.ts:28,61`).
- *Secrets/customer-PII bodies in logs* — grep for `bearer`/`access_token`/`client_secret` matched only route-mapping strings; `@…` hits are RFC Message-IDs/VERP addresses, not raw addresses; `apps/api/logs/` is gitignored.
- *Config PATCH mass-assignment into OAuth columns* — blocked by `UPDATABLE_FIELDS` whitelist (`config.service.ts:10-18`).
- *Inbound thread spoofing into another ticket* — anchored on provider `threadId` + unguessable `cuid` thread ids; forging `From`/`Reply-To` does not move a message into another customer's thread (`thread-ingestion.service.ts:117,124-161`).
- *Portal description HTML lost / missing `sentVia`* — false; portal HTML is sanitized+rendered (`portal tickets/[id]/page.tsx:449-450`); `sentVia:null` is the intended portal-origin value relied on by the delta query (`email.service.ts:376-379`).
- *CSAT `TicketRating` upsert race wipes AI fields* — false; `request-csat.worker.ts:57-61` uses `update:{}` (no-op), preserving classify-ticket's AI fields.
- *`packages/email` React Email templates wired to outbound* — correctly NOT wired (API builds bodies inline); atlas already documents this.
- *Redis required for the queue* — no; pg-boss is Postgres-backed (`queue.service.ts:82,102`).
