/**
 * The atlas-gen ts-morph script omits @Sse-decorated handlers. This test makes
 * the omission explicit until the generator is taught about @Sse, so a future
 * SSE route addition isn't silently invisible.
 *
 * Part B of the testing-framework plan flags this gap.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../..')

describe('SSE controller coverage', () => {
  it('EventsController exists at the expected path', () => {
    const path = resolve(REPO_ROOT, 'apps/api/src/modules/events/sse.controller.ts')
    expect(existsSync(path)).toBe(true)
  })

  it('exposes GET /events with an @Sse decorator and a token query param', () => {
    const path = resolve(REPO_ROOT, 'apps/api/src/modules/events/sse.controller.ts')
    const src = readFileSync(path, 'utf8')
    expect(src).toMatch(/@Sse\(/)
    expect(src).toMatch(/['"]events['"]/)
    expect(src).toMatch(/token/i)
  })
})
