# Pre-Deployment Full Regression — Testing Plan

**Release:** Pre-Deployment Full Regression · **Date:** 2026-06-21
**Scope:** Every feature and flow across Portal + Bridge — all 27 features, **175 cases**.
This is the final manual pass before deploy.

## How to run it

1. Open `checklist.html` (this folder) in **Chrome or Edge**.
2. Click **🔗 Connect report folder** → pick **this folder** → it loads `report.json` and autosaves.
3. Work **top-to-bottom** — cases are in journey order (Setup → Portal → Dashboard → Email → Bot →
   Analytics), so prerequisites are done before the flows that need them.
4. Set each row ☐ Pending / ✅ Pass / ❌ Fail / ⏭️ N/A and add notes. Commit the folder when done.

> `DO` cases should work. `DONT` cases should **fail gracefully** (clear error, no crash/hang) — a
> `DONT` "passes" when the app correctly refuses/validates.

## Time estimate

| Phase | Area | Cases | Est. time |
|---|---|---:|---:|
| 1 | Setup & configuration | 60 | ~4.3 h |
| 2 | Customer · Portal | 32 | ~1.8 h |
| 3 | Agent · Dashboard | 60 | ~3.2 h |
| 4 | Email channel | 9 | ~1.2 h |
| 5 | Bot & automation | 8 | ~1.1 h |
| 6 | Analytics & insights | 6 | ~0.3 h |
| | **Focused total** | **175** | **~11.8 h** |
| | **+ env setup, test data, context-switching (~20%)** | | **~14 h** |
| | **+ breaks (realistic wall-clock)** | | **~15–16 h** |

**Plan for ~2 working days** (or split across 2 testers ≈ 1 day). Phases 4–5 cost the most *per case*
because each involves a real email round-trip / poll cycle / bot response — budget waiting time there.

### Suggested split across sessions
- **Session A (~4–5h):** Phase 1 — connect Google **and** Microsoft mailboxes, GitHub, KB crawl,
  shifts, tags, canned responses, SSO, branding. Everything downstream depends on this.
- **Session B (~3h):** Phase 2 portal (auth, recovery, submit, tickets) — incl. guest + SSO arrival.
- **Session C (~3.5h):** Phase 3 dashboard (inbox, ticket detail, customers, TMR, GitHub queue, domain view).
- **Session D (~2.5h):** Phase 4 email + Phase 5 bot — run these together (shared email round-trips).
- **Session E (~0.5h):** Phase 6 analytics — do last, once data exists from earlier phases.

## Coverage notes (what to be deliberate about)

- **Tickets vs converted email:** exercise *both* origins. Portal-submitted tickets **and**
  email-originated conversations that you **Convert to ticket** — reply to each and confirm the
  customer gets correctly-threaded email (`email-channel.portal-vs-email`, `ticket-handling.convert`).
- **Both mail providers:** connect Gmail and Microsoft and confirm inbound/outbound on each.
- **Async waits:** bot answers, escalations, archive progress, and CSAT emails are not instant —
  allow a poll cycle before marking Fail.
- **Negative/edge cases** are first-class here: oversize files, bad URLs, invalid tokens, malformed
  CC/links, empty required fields, expired reset/verify links, non-admin gating.
- **Permission gating:** run the `DONT … as a non-admin` cases signed in as a non-admin agent.

## Pre-flight (before you start)

- [ ] Fresh/representative data in the DB (seed if needed: `pnpm --filter @tmr/db db:seed`).
- [ ] API, Portal, Bridge all running (`pnpm dev`); Postgres + MinIO up.
- [ ] A real test inbox for **Gmail** and one for **Microsoft** you can send to/from.
- [ ] A throwaway customer email + a second one for the bounce test.
- [ ] Gemini API key set, and a docs site URL for the KB crawl.
- [ ] GitHub test repo (for issue-linking + webhook label cases).
