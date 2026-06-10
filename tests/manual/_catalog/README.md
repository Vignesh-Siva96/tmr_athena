# Manual-QA Catalog

`catalog.json` is the **canonical library** of manual test scenarios for Athena. Per-release
checklists are *composed from this file* — see [`../README.md`](../README.md) for the delivery flow.

> Single source of truth. **User-facing only** — every case is something a real user does in the UI
> and observes. No dev/infra steps, no forced API calls, no DB/log assertions. When a release needs a
> scenario that isn't here yet, **add it to the right feature's `cases` first**, then include it.

## Structure (`catalog.json`, v2)

```json
{
  "version": 2,
  "phases": { "1": "Setup & configuration", "2": "Customer · Portal", "3": "Agent · Dashboard",
              "4": "Email channel", "5": "Bot & automation", "6": "Analytics & insights" },
  "features": [
    {
      "key": "portal-submit",            // unique feature key
      "title": "Submit a ticket (portal)",
      "phase": 2,                         // journey phase 1-6 (ordering + filter)
      "cases": [
        {
          "id": "portal-submit.create",  // stable, unique: "<feature>.<kebab-slug>"
          "type": "DO",                  // DO (should work) | DONT (should fail gracefully)
          "action": "Fill in title, category, description and submit",   // what the USER does
          "see": "Confirmation screen; ticket appears in 'My tickets'; confirmation email arrives", // what the USER observes
          "tags": ["portal", "email"]
        }
      ]
    }
  ]
}
```

- **Order = journey.** Features are listed in the real sequence a product is exercised, by `phase`:
  1 Setup/config (admin) → 2 Customer (portal) → 3 Agent (dashboard) → 4 Email channel → 5 Bot →
  6 Analytics. **Dependencies come before what needs them** (e.g. connect the inbox in phase 1 before
  the email-channel tests in phase 4).
- **`action` / `see`** — the only content fields. `action` = the user's step; `see` = the visible
  result (a screen, a badge, an email that arrives). Never reference DB tables or log contexts.
- **`id` is stable** — `<feature>.<kebab-slug>`, unique across the file. Report results key off it.
- **`type`** — `DO` or `DONT` (a failure case the tester should confirm fails gracefully).

## Navigating it (one file, use jq)

```bash
# Overview: phase, feature, case count (journey order)
jq -r '.features[] | "P\(.phase)  \(.key)  (\(.cases|length))"' catalog.json

# All cases for a feature
jq '.features[] | select(.key=="email-channel").cases' catalog.json

# Everything in a phase
jq '[.features[] | select(.phase==3)]' catalog.json
```

## Adding / changing cases (for whoever composes a report)

1. Identify the release's feature(s) — from session context or an explicit prompt.
2. For each, take its `cases` from `catalog.json`.
3. If a needed scenario is missing → **add a new case to that feature's `cases`** (unique `id`,
   `action` + `see`, `DO`/`DONT`). If it's a whole new area, add a new feature with the right `phase`.
4. Write the selected feature blocks into the report's `report.json` `checklist` (in phase order) and
   set `features`. See [`../README.md`](../README.md) for the report.json shape.

Keep ids unique: `jq -r '.features[].cases[].id' catalog.json | sort | uniq -d` should print nothing.
