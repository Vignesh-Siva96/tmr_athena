# DEPLOY.md — Deployment Guidebook (PM2)

How to deploy and operate the TMR Support Platform in production. Docker is **not** used to deploy —
the three Node apps run under **PM2** on the host. Jump to your scenario:

- [Architecture at a glance](#architecture-at-a-glance)
- [The golden rule (what to run when something changes)](#the-golden-rule)
- [Prerequisites (one-time)](#prerequisites-one-time)
- **Scenario A — [Fresh deployment](#scenario-a--fresh-deployment)**
- **Scenario B — [Deploy new code (release update)](#scenario-b--deploy-new-code-release-update)**
- **Scenario C — [Backend env var change](#scenario-c--backend-env-var-change)**
- **Scenario D — [Frontend env var change](#scenario-d--frontend-env-var-change)**
- **Scenario E — [Database schema change](#scenario-e--database-schema-change)**
- **Scenario F — [Rollback](#scenario-f--rollback)**
- [PM2 cheat-sheet](#pm2-cheat-sheet)
- [Health checks & troubleshooting](#health-checks--troubleshooting)
- [Local development infra](#local-development-infra)

---

## Architecture at a glance

| PM2 process     | App           | Port | Run command          |
| --------------- | ------------- | ---- | -------------------- |
| `athena-api`    | `apps/api`    | 3001 | `node dist/main.js`  |
| `athena-portal` | `apps/portal` | 3000 | `next start -p 3000` |
| `athena-bridge` | `apps/bridge` | 3002 | `next start -p 3002` |

- **Inbound email is poll-based, not an SMTP listener.** The API fetches mail over the Gmail/Graph
  REST APIs on a timer and parses VERP reply-to threading from those messages — there is no SMTP
  server in the app and no port 2525 to expose (`INBOUND_SMTP_PORT` is vestigial).
- **Infra is external**: PostgreSQL (with `pgvector`) + an S3-compatible object store, both wired via
  the **repo-root `.env`**. pg-boss (job queue) lives inside Postgres — no Redis.
- A **reverse proxy + TLS** (nginx/Caddy) sits in front of ports 3000/3001/3002 — configured at the
  server level, outside this repo.
- Process definitions live in [`ecosystem.config.cjs`](ecosystem.config.cjs).

---

## The golden rule

Everything below reduces to **how each input reaches the running app**:

| What changed | Reaches the app via | Therefore run |
| --- | --- | --- |
| **Backend env** (`DATABASE_URL`, `S3_*`, `SMTP_*`, secrets, `GEMINI_API_KEY`, …) | API reads root `.env` **at startup** | restart the API → [Scenario C](#scenario-c--backend-env-var-change) |
| **Frontend env** (any `NEXT_PUBLIC_*`) | inlined into the JS bundle **at build time** | rebuild that app + restart → [Scenario D](#scenario-d--frontend-env-var-change) |
| **Backend code** (`apps/api`, `packages/*`) | compiled into `apps/api/dist` | build API + restart → [Scenario B](#scenario-b--deploy-new-code-release-update) |
| **Frontend code** (`apps/portal` / `apps/bridge`) | compiled into `.next` | build that app + restart → [Scenario B](#scenario-b--deploy-new-code-release-update) |
| **Prisma schema** (new migration) | applied to the live DB | `prisma migrate deploy` + restart → [Scenario E](#scenario-e--database-schema-change) |

**Two facts that explain all of it:**
1. The **API reads the root `.env` live on boot** (`ConfigModule envFilePath: ['../../.env', '.env']`)
   — a restart is enough.
2. **`NEXT_PUBLIC_*` vars are baked into the browser bundle at build time** — the portal/bridge only
   ever read `NEXT_PUBLIC_*`, so *any* frontend env change needs a rebuild, not just a restart.

> Build only what changed. A backend-only change does not require rebuilding the frontends, and a
> change to one frontend's env doesn't require rebuilding the other.

---

## Prerequisites (one-time)

On the production host:

- **Node ≥ 20** + **pnpm ≥ 9** — `corepack enable && corepack prepare pnpm@10.11.1 --activate`
- **PM2** — `pnpm add -g pm2` (or `npm i -g pm2`)
- **PostgreSQL 15+ with `pgvector`** — reachable via `DATABASE_URL`. Holds app data, pg-boss queue,
  and bot vector index.
- **S3-compatible object storage** for attachments — reachable via the `S3_*` env. Set
  `S3_ENDPOINT` to the storage URL **including the scheme** (`https://…` in prod = TLS;
  `http://localhost:9000` for local MinIO); transport is taken from that scheme — there is **no**
  separate `S3_USE_SSL`/`S3_PORT`. MinIO itself is dev-only.
- **Reverse proxy + TLS** in front of 3000/3001/3002.

---

## Scenario A — Fresh deployment

First time on a clean server.

```bash
# 1. Clone
git clone <repo-url> athena
cd athena

# 2. Install dependencies (exact lockfile)
pnpm install --frozen-lockfile

# 3. Configure environment — fill in EVERY value
cp .env.example .env
$EDITOR .env
#   DATABASE_URL, S3_* (S3_ENDPOINT must be an https:// URL in prod), BETTER_AUTH_SECRET, EMAIL_CREDS_KEY,
#   PORTAL_URL / BRIDGE_URL / OAUTH_CALLBACK_BASE, SMTP_*, GEMINI_API_KEY, GITHUB_*, GOOGLE_*,
#   TMR_DATA_*, and all NEXT_PUBLIC_* (these get baked into the build in step 5).

# 4. Database — generate client + apply all committed migrations
pnpm --filter @tmr/db exec prisma generate
pnpm --filter @tmr/db exec prisma migrate deploy
#   NOTE: do NOT run `db:seed` in production — it injects demo data and a weak `admin123`
#   login (it now refuses to run when NODE_ENV=production). Create the first admin manually:
#   see "Create the first admin (production)" below.

# 5. Build all apps. Source .env first so Next inlines NEXT_PUBLIC_* values.
set -a; . ./.env; set +a
pnpm build

# 6. Start under PM2 and persist
pm2 start ecosystem.config.cjs
pm2 save                                # remember the process list across reboots
pm2 startup                             # one-time: prints the systemd command to enable boot-start

# 7. Verify
pm2 status                              # all three → online
curl -fsS http://localhost:3001/api/v1/health && echo " API OK"
```

### Create the first admin (production)

The app has no self-service admin signup — `/auth/signup` only creates customer accounts, and
agent invites need an existing admin. On a fresh install, create exactly one admin directly in the
database. Do **not** use `db:seed` (it injects demo data + a weak `admin123` login and refuses to
run when `NODE_ENV=production`).

```bash
# 1. Generate a password hash in the format the login verifier expects (scrypt → "salt:hexkey").
#    Replace YOUR_STRONG_PASSWORD; copy the printed value.
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');c.scrypt(process.argv[1],s,64,(e,k)=>console.log(s+':'+k.toString('hex')))" 'YOUR_STRONG_PASSWORD'
```

```sql
-- 2. Insert the admin. Agent.id and Agent.updatedAt have no DB default, so supply both.
--    gen_random_uuid() needs the pgcrypto extension (already present with pgvector); any unique
--    string works for id if pgcrypto is unavailable.
INSERT INTO "Agent" (id, "createdAt", "updatedAt", email, name, password, role, "isActive", "inviteAccepted")
VALUES (gen_random_uuid()::text, now(), now(), 'you@company.com', 'Your Name', '<hash-from-step-1>', 'ADMIN', true, true);
```

Then sign in at the dashboard (or `POST /api/v1/auth/agent/signin`) with that email + password.

---

## Scenario B — Deploy new code (release update)

Pulling a new version of the app. This is the everyday "ship a release" path.

```bash
cd athena
git pull

pnpm install --frozen-lockfile         # in case dependencies changed
pnpm --filter @tmr/db exec prisma migrate deploy   # safe even if no new migrations (no-op)

set -a; . ./.env; set +a               # so any NEXT_PUBLIC_* are inlined
pnpm build                             # turbo builds all three (cached — only changed apps rebuild)

pm2 reload ecosystem.config.cjs        # zero-downtime reload of all three
pm2 status
```

> `pm2 reload` restarts gracefully (waits for the new process before killing the old). Use
> `pm2 restart` if you want a hard restart.
>
> **Build before reload.** `next start` / `node dist/main.js` serve the last good build, so always
> let `pnpm build` finish successfully before reloading — a failed build leaves the old version
> running, which is the safe outcome.

If you know only one app changed, you can narrow the build + reload:

```bash
pnpm --filter @tmr/api build   && pm2 reload athena-api
pnpm --filter @tmr/portal build && pm2 reload athena-portal
pnpm --filter @tmr/bridge build && pm2 reload athena-bridge
```

---

## Scenario C — Backend env var change

Changed a **backend** value in `.env` (`DATABASE_URL`, `S3_*`, `SMTP_*`, `BETTER_AUTH_SECRET`,
`EMAIL_CREDS_KEY`, `GEMINI_API_KEY`, `GITHUB_APP_*`, `GOOGLE_*`, `OAUTH_CALLBACK_BASE`,
`TMR_DATA_*`, `PORT`).

```bash
$EDITOR .env                # change the value
pm2 restart athena-api      # API re-reads root .env on boot — no rebuild needed
```

No build step. No frontend restart.

---

## Scenario D — Frontend env var change

Changed any **`NEXT_PUBLIC_*`** value (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`,
`NEXT_PUBLIC_GITHUB_CLIENT_ID`, `NEXT_PUBLIC_ASSETS_URL`, `NEXT_PUBLIC_PORTAL_URL`). These are
**baked into the bundle at build time**, so a restart alone does nothing — you must rebuild.

```bash
$EDITOR .env
set -a; . ./.env; set +a               # expose NEXT_PUBLIC_* to the build

# Rebuild + reload only the frontends that use the changed var:
pnpm --filter @tmr/portal build && pm2 reload athena-portal
pnpm --filter @tmr/bridge build && pm2 reload athena-bridge
```

> Most `NEXT_PUBLIC_*` vars (e.g. `NEXT_PUBLIC_API_URL`) are used by **both** frontends, so rebuild
> both. `NEXT_PUBLIC_GITHUB_CLIENT_ID` is bridge-only; `NEXT_PUBLIC_GOOGLE_CLIENT_ID` /
> `NEXT_PUBLIC_PORTAL_URL` are portal-side. When unsure, rebuild both — it's safe.

---

## Scenario E — Database schema change

Migrations are **authored in development** (`pnpm --filter @tmr/db db:migrate`, which runs
`prisma migrate dev`) and **committed to the repo** under `packages/db/prisma/migrations/`.
**Production never authors migrations** — it only applies committed ones.

After pulling code that includes new migration files:

```bash
cd athena
git pull

pnpm --filter @tmr/db exec prisma generate         # regenerate the typed client
pnpm --filter @tmr/db exec prisma migrate deploy    # apply pending migrations forward-only

set -a; . ./.env; set +a
pnpm --filter @tmr/api build && pm2 reload athena-api   # code that uses the new columns
```

- `migrate deploy` is the **production** command: it applies committed migrations in order, never
  prompts, and never resets. Do **not** run `migrate dev`, `db push`, or `migrate reset` against
  production — those are dev-only and can drop data.
- **Back up the database before applying migrations.** A migration is the one operation here that
  can't be undone with a redeploy.
- If a migration adds raw-SQL artifacts (e.g. a generated FTS column), the API self-heals the
  `tsv` column on boot (`RetrievalService.onModuleInit`) — restarting the API after deploy is enough.

---

## Scenario F — Rollback

**Code rollback** (no schema change involved):

```bash
cd athena
git checkout <previous-good-tag-or-sha>
pnpm install --frozen-lockfile
set -a; . ./.env; set +a
pnpm build
pm2 reload ecosystem.config.cjs
```

**If the bad release included a migration:** code rollback alone is not enough — the DB is already
migrated. Either restore the pre-migration database backup, or write and deploy a new forward
migration that reverses the change. Never hand-edit `_prisma_migrations`.

---

## PM2 cheat-sheet

```bash
pm2 status                       # process list + health
pm2 logs                         # tail all logs
pm2 logs athena-api              # one process
pm2 restart athena-api           # hard restart one
pm2 reload  ecosystem.config.cjs # graceful zero-downtime reload of all
pm2 stop all                     # stop (keep in list)
pm2 delete all                   # remove from PM2
pm2 save                         # persist current list (run after add/remove)
pm2 monit                        # live CPU/memory dashboard
pm2 flush                        # clear PM2 log files
```

PM2 process names: `athena-api`, `athena-portal`, `athena-bridge`.

---

## Health checks & troubleshooting

```bash
# API health
curl -fsS http://localhost:3001/api/v1/health

# App logs (structured JSON, rotated daily)
tail -f apps/api/logs/app-$(date +%Y-%m-%d).log \
  | jq -r '"\(.ts) [\(.level)] \(.context): \(.msg)"'
```

- **A process keeps restarting** → `pm2 logs <name>` for the crash reason. Common causes: bad
  `DATABASE_URL`, unreachable object store, or a missing required env var.
- **Frontend shows an old API URL / client ID** → you changed a `NEXT_PUBLIC_*` var but didn't
  rebuild. See [Scenario D](#scenario-d--frontend-env-var-change).
- **`migrate deploy` errors on an already-applied migration** → the DB and the migrations folder are
  out of sync; check `_prisma_migrations` and the backup before forcing anything.
- **Port already in use** → another process (or an orphaned PM2 entry) holds 3000/3001/3002:
  `pm2 delete all` then re-`start`, or find the holder with `lsof -i :3001`.

---

## Local development infra

The old `docker/docker-compose.yml` was removed. For local `pnpm dev`, run Postgres + MinIO as
standalone containers:

```bash
docker run -d --name athena-pg -p 5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tmr_support \
  pgvector/pgvector:pg16

docker run -d --name athena-minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

Then follow `STATE.md` → Quick Reference → "Start the stack". (The Docker daemon is also used by the
test suite via Testcontainers — unrelated to deployment.)
