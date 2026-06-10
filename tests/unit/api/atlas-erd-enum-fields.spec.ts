/**
 * atlas-erd-enum-fields.spec — guards the atlas generator against re-dropping
 * enum-typed columns from the generated ERD.
 *
 * Regression catalogue rows:
 *   R202 — atlas-gen classified enum-typed Prisma fields as relations and the
 *          ERD emitter skipped them, so columns like Ticket.status and
 *          CustomerSignal.type were silently missing from _generated/erd.md.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '../../..')

describe('R202 — generated ERD includes enum-typed columns', () => {
  const schema = readFileSync(join(REPO_ROOT, 'packages/db/prisma/schema.prisma'), 'utf8')
  const erd = readFileSync(join(REPO_ROOT, 'docs/atlas/_generated/erd.md'), 'utf8')

  const enumNames = new Set([...schema.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]))

  it('schema defines enums (sanity)', () => {
    expect(enumNames.size).toBeGreaterThan(0)
  })

  it('every enum-typed model field appears in erd.md', () => {
    const missing: string[] = []
    for (const modelMatch of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const [, modelName, body] = modelMatch
      for (const line of body.split('\n')) {
        const fieldMatch = /^\s*(\w+)\s+(\w+)(\??)\s/.exec(line)
        if (!fieldMatch) continue
        const [, fieldName, baseType, optional] = fieldMatch
        if (!enumNames.has(baseType)) continue
        const expected = `${baseType}${optional} ${fieldName}`
        const modelBlock = new RegExp(`  ${modelName} \\{[\\s\\S]*?\\}`).exec(erd)?.[0] ?? ''
        if (!modelBlock.includes(expected)) missing.push(`${modelName}.${fieldName} (${expected})`)
      }
    }
    expect(missing, `enum columns missing from erd.md — run pnpm atlas:gen with the enum fix: ${missing.join(', ')}`).toEqual([])
  })
})
