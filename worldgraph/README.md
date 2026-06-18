# Worldgraph

`atlas.world.json` is a single-file, AI-maintained map of the TMR Support Platform. It is a
**pre-computed context cache** (read by an AI agent at session start instead of scanning the whole
codebase) and a **human-facing zoomable map + animated storyboard** (read by `viewer/`, a standalone
Next.js + React Flow app on `:3003`).

This folder is **fully decoupled** from the production apps: its own `package.json`/install, not in
`pnpm-workspace.yaml`, not in turbo, not in CI. Nothing here is a build dependency of `apps/*` or
`packages/*`.

## File shape

```jsonc
{
  "version": 1,
  "updated": "YYYY-MM-DD",   // stamp this on every edit

  "index": {                  // cheap adjacency lookup — read this first
    "feature:email": {
      "summary": "...",
      "connects": ["entity:Ticket", "module:EmailModule", "ext:Gmail", ...]
    }
  },

  "nodes": {                   // one full dossier per label
    "feature:email": { "kind": "feature", "title": "...", ... }
  },

  "journeys": {                // 3-5 headline storyboards
    "journey:inbound-email": { "title": "...", "beats": [{ "node": "...", "say": "..." }] }
  }
}
```

## Label grammar (`kind:name`)

| Prefix | Meaning | Example |
|---|---|---|
| `feature:*` | A product feature/capability area | `feature:email` |
| `module:*` | A NestJS module | `module:EmailModule` |
| `entity:*` | A Prisma model/table | `entity:Ticket` |
| `route:METHOD /api/v1/path` | An HTTP endpoint | `route:POST /api/v1/tickets` |
| `ext:*` | An external system/integration | `ext:Gmail` |
| `queue:*` | A pg-boss queue/worker | `queue:email-send-reply` |
| `journey:*` | A storyboard (not addressable from `index`/`connects`) | `journey:inbound-email` |

A node's key is its label. `kind` inside the node body must match the label's prefix
(`feature:x` → `"kind": "feature"`, etc.).

## `connects` — how adjacency is derived

Every node (except `journey:*`, which lives outside `index`/`nodes`) has a top-level `"connects"`
array: every other node label it directly references, anywhere in its body (typed arrays like
`modules`/`entities`/`routes`/`externals`/`queues`/`imports`/`usedBy`/`writtenBy`, or
`relations[].to`). `index.<label>.connects` is a **duplicate** of `nodes[label].connects` — the
duplication is intentional (the index is the cheap-to-scan adjacency list); `validate.ts` enforces
the two stay identical.

Practically: when you add a reference to another node anywhere in a node's body, add that label to
the node's own `connects` array AND to `index.<label>.connects`.

## How an AI agent should read this file

1. Read `index` (small) to get every node's one-line `summary` + its `connects` adjacency.
2. To go deeper on a node, jump to `nodes["<label>"]` for the full dossier (stack, key files, why,
   gaps, DB columns/relations, etc).
3. To understand a cross-cutting flow, read `journeys["journey:<name>"].beats` — an ordered list of
   `{ node, say }` steps.

## How an AI agent should update this file (definition-of-done)

Per `CLAUDE.md`'s documentation rule: if you touched a feature's behavior, flow, module, table,
route, queue, or external integration —

1. Update the node's dossier in `nodes` (add/edit fields — `keyFiles`, `gaps`, `why`, `stack`,
   typed reference arrays, etc).
2. Update that node's `connects` array (and any node it now references/no-longer-references must
   have its own `connects` updated too, since edges are recorded on both ends via `usedBy` /
   `writtenBy` / `imports` / etc — whichever typed array is appropriate for that node's kind).
3. Mirror the new `connects` into `index.<label>.connects`.
4. Bump `"updated"` to today's date.
5. Run `tsx worldgraph/validate.ts` (or `pnpm worldgraph:check` from repo root) — it must pass.

If you add a brand-new node, add both a `nodes` entry and an `index` entry (with `summary` +
`connects`), and make sure every node that now points at it lists it in their `connects` too.

## Validator

`validate.ts` is **read-only** — it never writes. Run via `pnpm validate` (from `worldgraph/`) or
`pnpm worldgraph:check` (from repo root). It checks:

1. The file parses as JSON and conforms to `atlas.world.schema.json`.
2. No dangling labels — every label referenced anywhere (typed arrays, `relations[].to`,
   `journeys[].beats[].node`, `connects`) exists as a key in `nodes`.
3. `index` and `nodes` have exactly the same keys, and `index.<label>.connects` deep-equals
   `nodes[label].connects`.
4. Every label matches `kind:name` grammar and `nodes[label].kind` matches the prefix.

It deliberately does **not** check that `route:*`/`module:*`/`entity:*` labels still exist in code
— that would re-couple this folder to the build. Freshness rests on AI discipline (the
definition-of-done above) + this validator's internal-consistency seatbelt.

## Viewer

`viewer/` is a standalone Next.js + React Flow app, dark-themed (mirrors `apps/bridge`'s `--d-*`
tokens). It reads `../atlas.world.json` at request time.

- **Map** — `nodes` rendered as flow nodes, `index.*.connects` as edges, dagre auto-layout.
- **Detail panel** — click a node to see its full dossier.
- **Storyboard** — pick a `journey:*`, play/pause/step through its `beats` with camera pans and
  captions.

Run with `pnpm worldgraph:view` from the repo root (or `pnpm dev` from `worldgraph/`), serves on
`http://localhost:3003`.
