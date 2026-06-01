/**
 * routes-snapshot — fails if a controller change isn't accompanied by `pnpm atlas:gen`.
 *
 * The auto-generated docs/atlas/_generated/api-routes.md is the binding contract.
 * If a route was added/removed/renamed without regenerating, this test fails and
 * the PR is blocked. Forces docs to evolve with code.
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../..')
const ROUTES_FILE = 'docs/atlas/_generated/api-routes.md'
const ERD_FILE = 'docs/atlas/_generated/erd.md'
const MODULE_GRAPH_FILE = 'docs/atlas/_generated/module-graph.md'

describe('atlas auto-generated artifacts are up-to-date', () => {
  it('api-routes.md matches the result of pnpm atlas:gen', () => {
    const before = readFileSync(resolve(REPO_ROOT, ROUTES_FILE), 'utf8')
    execSync('pnpm atlas:gen', { cwd: REPO_ROOT, stdio: 'pipe' })
    const after = readFileSync(resolve(REPO_ROOT, ROUTES_FILE), 'utf8')
    expect(stripTimestamp(after)).toBe(stripTimestamp(before))
  })

  it('erd.md matches the result of pnpm atlas:gen', () => {
    const before = readFileSync(resolve(REPO_ROOT, ERD_FILE), 'utf8')
    execSync('pnpm atlas:gen', { cwd: REPO_ROOT, stdio: 'pipe' })
    const after = readFileSync(resolve(REPO_ROOT, ERD_FILE), 'utf8')
    expect(stripTimestamp(after)).toBe(stripTimestamp(before))
  })

  it('module-graph.md matches the result of pnpm atlas:gen', () => {
    const before = readFileSync(resolve(REPO_ROOT, MODULE_GRAPH_FILE), 'utf8')
    execSync('pnpm atlas:gen', { cwd: REPO_ROOT, stdio: 'pipe' })
    const after = readFileSync(resolve(REPO_ROOT, MODULE_GRAPH_FILE), 'utf8')
    expect(stripTimestamp(after)).toBe(stripTimestamp(before))
  })
})

// The generator stamps a "_Last generated: <ISO>_" line. Tests must ignore it.
function stripTimestamp(s: string): string {
  return s.replace(/_Last generated:[^_]+_/g, '_Last generated: <stripped>_')
}
