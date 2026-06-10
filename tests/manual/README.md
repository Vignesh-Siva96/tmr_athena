# Manual QA — Delivery Quality Reports

The **release gate** for Athena. Before each release we compose a human testing checklist for the
features that release touches, run it, and archive the filled-in results as a durable, dated
**delivery-quality report**.

```
tests/manual/
├── README.md                 ← this file (the flow)
├── _catalog/
│   ├── catalog.json          ← THE canonical library of all test scenarios (source of truth)
│   └── README.md             ← catalog structure + how to add cases
├── _template/
│   └── checklist.html        ← generic runner (loads a report.json; no cases baked in)
└── reports/
    └── <YYYY-MM-DD>_<slug>/   ← one folder per release (committed = the archive)
        ├── checklist.html     ← runner copy, stamped with name + date
        └── report.json        ← { release, date, features, checklist, results } — the record
```

## The flow (every release)

1. **Start a report**
   ```bash
   pnpm qa:new "v1.3 Hotfix"                                  # empty checklist
   pnpm qa:new "v1.3 Hotfix" --features email-channel,github  # pre-seed specific features
   pnpm qa:new "v1.0 Pilot"  --features all                   # pre-seed the whole catalog
   ```
   Creates `reports/<today>_v1-3-hotfix/` with `checklist.html` + `report.json`. With `--features`,
   the named feature blocks are copied from the catalog in journey order, deterministically — no AI
   needed. (Run `jq -r '.features[].key' tests/manual/_catalog/catalog.json` to list feature keys.)

2. **Compose the checklist** (only if you didn't use `--features`, or you need more):
   Ask Claude — *"generate the QA checklist for this release (it touches Email sync + GitHub)."*
   Claude reads `_catalog/catalog.json`, selects the relevant feature blocks, and writes them into
   that report's `report.json` `checklist`. If a needed scenario is missing, Claude **adds it to the
   catalog first**, then includes it (so it's reusable next time).

3. **Run it** — open the folder's `checklist.html` in **Chrome or Edge**:
   - Click **🔗 Connect report folder** and pick **this report's folder** — the page finds `report.json`
     inside it, remembers the location, and **auto-reconnects** next time you open this checklist
     (browsers require that first click for security; it can't auto-connect on first open).
   - Work top-to-bottom — it's ordered by the **user journey** (Phase 1 Setup → 2 Customer →
     3 Agent → 4 Email → 5 Bot → 6 Analytics), so prerequisites come before what needs them.
     Set each row's status with the dropdown (**☐ Pending / ✅ Pass / ❌ Fail / ⏭️ N/A**) and add notes.
   - Results **autosave into `report.json` on disk** — close/reopen anytime; it reconnects.
   - **🧾 Export standalone report** gives a frozen single-file HTML (good for sharing / save-as-PDF).

4. **Archive** — commit the whole `reports/<date>_<slug>/` folder. The committed `report.json` is the
   permanent delivery-quality record for the release.

## report.json shape

```json
{
  "release": "v1.3 Hotfix",
  "date": "2026-06-10",
  "features": ["email-setup", "email-channel", "github"],
  "checklist": [
    { "key": "email-channel", "title": "Email in & out", "phase": 4,
      "cases": [ { "id": "email-channel.inbound", "type": "DO", "action": "…", "see": "…" } ] }
  ],
  "results": { "email-channel.inbound": { "status": "pass", "notes": "…" } }
}
```
`results` is keyed by case `id`. The generator writes `checklist`/`results` empty (unless `--features`);
the runner fills `results`; Claude (or `--features`) fills `checklist`. Compose `checklist` in
**phase order** (the runner groups by phase). Tip: `pnpm qa:new "name" --features all` seeds every feature.

## For Claude — authoring a release checklist (repeatable procedure)

1. Determine the release's feature(s) — from this session's context or an explicit prompt.
2. Read `tests/manual/_catalog/catalog.json`; for each feature take its `cases`. Include any
   prerequisite features the flow depends on (e.g. `email-setup` before `email-channel`).
3. If a needed scenario isn't in the catalog → **add a new case to that feature's `cases` first**
   (unique `id` = `<feature>.<kebab-slug>`, with `action` + `see`), then include it.
4. Write the selected feature blocks into the target `reports/<…>/report.json` `checklist` **in phase
   order**, and set `features` to the keys used. Leave `results` as-is (`{}` for a new report).

## Browser support / why a file, not localStorage

Persistence uses the **File System Access API** so results live in a committable file — not
localStorage (which can be wiped; it's only a session backup here).
- **Chrome / Edge:** full support — pick the report folder once; it finds `report.json`, autosaves to
  disk, and auto-reconnects on reopen (the picker defaults to your last-used folder).
- **Firefox / Safari:** no API — use **⬇ Download report.json** / **⤴ Load report.json** (manual save/load).

> The catalog's `security-regressions` feature (Tier D) + the `T1.x`/`T2.x` tags double as
> verification that the remediation fixes still hold in the running app.
