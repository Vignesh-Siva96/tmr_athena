#!/usr/bin/env node
/**
 * new-delivery-report.mjs — start a new release QA report.
 *
 * Usage:
 *   pnpm qa:new "v1.2-pilot"                      # empty checklist (Claude fills it later)
 *   pnpm qa:new "v1.2-pilot" --features auth,github   # pre-seed from the catalog
 *
 * Scaffolds tests/manual/reports/<YYYY-MM-DD>_<slug>/ with:
 *   - checklist.html  : generic runner (copied from _template, stamped with name + date)
 *   - report.json     : { release, date, features, checklist, results }
 *
 * The per-release checklist is COMPOSED from tests/manual/_catalog/catalog.json:
 *   - with --features, the named feature blocks are copied in deterministically (no AI needed).
 *   - without it, `checklist` is empty for Claude to fill on demand.
 * The tester opens checklist.html, connects report.json (File System Access API), and the filled
 * report.json (committed in the folder) becomes the archived delivery-quality report.
 *
 * No dependencies — plain Node (>=20).
 */
import { mkdir, copyFile, readFile, writeFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const MANUAL_DIR = path.join(REPO_ROOT, 'tests', 'manual')
const TEMPLATE = path.join(MANUAL_DIR, '_template', 'checklist.html')
const CATALOG = path.join(MANUAL_DIR, '_catalog', 'catalog.json')
const REPORTS_DIR = path.join(MANUAL_DIR, 'reports')

function parseArgs(argv) {
  const positional = []
  let features = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--features') {
      features = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    } else if (a.startsWith('--features=')) {
      features = a.slice('--features='.length).split(',').map((s) => s.trim()).filter(Boolean)
    } else {
      positional.push(a)
    }
  }
  return { name: positional.join(' ').trim(), features }
}

const slugify = (s) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function exists(p) { try { await access(p); return true } catch { return false } }

async function main() {
  const { name, features } = parseArgs(process.argv.slice(2))
  if (!name) {
    console.error('✗ Release name required.\n  Usage: pnpm qa:new "v1.2-pilot" [--features auth,github]')
    process.exit(1)
  }
  const slug = slugify(name)
  if (!slug) { console.error(`✗ "${name}" produced an empty slug — use letters/numbers.`); process.exit(1) }
  if (!(await exists(TEMPLATE))) { console.error(`✗ Template not found at ${path.relative(REPO_ROOT, TEMPLATE)}`); process.exit(1) }

  const date = today()
  const outDir = path.join(REPORTS_DIR, `${date}_${slug}`)
  if (await exists(outDir)) {
    console.error(`✗ Report folder already exists: ${path.relative(REPO_ROOT, outDir)}\n  Refusing to clobber. Use a different name or delete the folder.`)
    process.exit(1)
  }

  // Compose the checklist: empty, or seeded from the catalog when --features is given.
  let checklist = []
  let requested = features ?? []
  if (requested.length) {
    if (!(await exists(CATALOG))) { console.error(`✗ Catalog not found at ${path.relative(REPO_ROOT, CATALOG)}`); process.exit(1) }
    let catalog
    try { catalog = JSON.parse(await readFile(CATALOG, 'utf8')) } catch (e) { console.error(`✗ Catalog is not valid JSON: ${e.message}`); process.exit(1) }
    const feats = catalog.features ?? []
    const allKeys = feats.map((f) => f.key)
    const wanted = requested.includes('all') ? allKeys : requested
    const known = new Set(allKeys)
    const missing = wanted.filter((k) => !known.has(k))
    if (missing.length) {
      console.error(`✗ Unknown feature key(s): ${missing.join(', ')}`)
      console.error(`  Available: ${allKeys.join(', ')}\n  (or use --features all)`)
      process.exit(1)
    }
    // Compose in catalog (journey/phase) order, not the order the keys were typed.
    const wantedSet = new Set(wanted)
    checklist = feats.filter((f) => wantedSet.has(f.key)).map((f) => ({ key: f.key, title: f.title, phase: f.phase, cases: f.cases }))
    requested = checklist.map((s) => s.key)
  }

  await mkdir(outDir, { recursive: true })

  // checklist.html — stamped copy of the runner.
  const html = (await readFile(TEMPLATE, 'utf8')).replaceAll('{{RELEASE}}', name.replace(/</g, '&lt;')).replaceAll('{{DATE}}', date)
  await writeFile(path.join(outDir, 'checklist.html'), html, 'utf8')

  // report.json — the durable record (Claude fills `checklist` if left empty here).
  const report = { release: name, date, features: requested, checklist, results: {} }
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')

  const rel = path.relative(REPO_ROOT, outDir)
  const caseCount = checklist.reduce((n, s) => n + s.cases.length, 0)
  console.log(`✓ Created delivery QA report for "${name}"`)
  console.log(`  → ${rel}/`)
  console.log(`    checklist.html  (runner)`)
  console.log(`    report.json     (${requested.length ? `${requested.length} feature(s), ${caseCount} cases seeded from catalog` : 'empty checklist — generate it next'})`)
  console.log('')
  console.log('Next:')
  if (!requested.length) {
    console.log('  • Ask Claude to generate this release\'s checklist (fills report.json from _catalog/catalog.json),')
    console.log('    or re-run with --features <keys> to pre-seed deterministically.')
  }
  console.log(`  • Open ${rel}/checklist.html in Chrome/Edge → "Connect report.json" (pick the one in that folder).`)
  console.log('  • Work through it (autosaves to report.json) → commit the folder as the archived report.')
}

main().catch((err) => { console.error('✗ Failed to create report:', err?.message ?? err); process.exit(1) })
